'use strict';
const { matchPlayerKtc, getPickValue } = require('./ktc');

const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const AGING_THRESHOLDS = { QB: 35, RB: 28, WR: 30, TE: 32 };
const IDEAL_AGES = { QB: 27, RB: 24, WR: 25, TE: 26 };
const SCORE_WEIGHTS = { record: 0.30, ktc: 0.50, age: 0.20 };

function buildRosterDf(roster, players, ktcLookup) {
  const starterIds = new Set(roster.starters || []);
  const taxiIds    = new Set(roster.taxi    || []);
  const reserveIds = new Set(roster.reserve || []);

  const rows = (roster.players || [])
    .map(pid => {
      const p = players[pid];
      if (!p) return null;
      const name = `${p.first_name || ''} ${p.last_name || ''}`.trim();
      const pos  = p.position || '';
      const age  = p.age || 0;
      const team = p.team || 'FA';

      const ktcRec = matchPlayerKtc(name, pos, ktcLookup);
      const sfVal  = ktcRec ? ktcRec.sf_value : 0;

      const slot = starterIds.has(pid) ? 'Starter'
        : taxiIds.has(pid)   ? 'Taxi'
        : reserveIds.has(pid) ? 'IR'
        : 'Bench';

      const threshold = AGING_THRESHOLDS[pos];
      const agingFlag = !!(threshold && age >= threshold);

      return { player_id: pid, name, position: pos, nfl_team: team, age, ktc_sf_value: sfVal, slot, aging_flag: agingFlag };
    })
    .filter(Boolean);

  rows.sort((a, b) => {
    const slotOrder = { Starter: 0, Taxi: 1, Bench: 2, IR: 3 };
    const sa = slotOrder[a.slot] ?? 9;
    const sb = slotOrder[b.slot] ?? 9;
    if (sa !== sb) return sa - sb;
    return b.ktc_sf_value - a.ktc_sf_value;
  });

  return rows;
}

function weightedAvgAge(playerList) {
  const totalWeight = playerList.reduce((s, p) => s + (p.ktc_sf_value || 0), 0);
  if (totalWeight === 0) {
    const ages = playerList.filter(p => p.age).map(p => p.age);
    return ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : 0;
  }
  const weighted = playerList
    .filter(p => p.ktc_sf_value > 0 && p.age)
    .reduce((s, p) => s + p.age * p.ktc_sf_value, 0);
  return weighted / totalWeight;
}

function ageProfileByPosition(rows) {
  const profile = {};
  for (const pos of POSITIONS) {
    const group = rows.filter(p => p.position === pos && p.age);
    profile[pos] = group.length ? weightedAvgAge(group) : 0;
  }
  return profile;
}

function ageScore(rows) {
  const profile = ageProfileByPosition(rows);
  const scores = [];
  for (const pos of POSITIONS) {
    const avg = profile[pos];
    const threshold = AGING_THRESHOLDS[pos];
    if (!avg) continue;
    scores.push(Math.max(0, Math.min(100, (threshold - avg) / (threshold - 22) * 100)));
  }
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 50;
}

function totalKtc(rows) {
  return rows.reduce((s, r) => s + (r.ktc_sf_value || 0), 0);
}

function powerRankings(rosters, players, ktcLookup, standings) {
  const standingsMap = {};
  for (const s of standings) standingsMap[s.roster_id] = s;

  const maxWins = Math.max(...standings.map(s => s.wins + s.ties * 0.5), 1);

  const enriched = rosters.map(roster => {
    const rows  = buildRosterDf(roster, players, ktcLookup);
    const ktcTt = totalKtc(rows);
    const aScore = ageScore(rows);
    return { roster, rows, ktcTotal: ktcTt, ageScore: aScore };
  });

  const maxKtc = Math.max(...enriched.map(e => e.ktcTotal), 1);

  const results = enriched.map(e => {
    const rid     = e.roster.roster_id;
    const s       = standingsMap[rid] || {};
    const wins    = (s.wins || 0) + (s.ties || 0) * 0.5;
    const recScore = (wins / maxWins) * 100;
    const ktcScore = (e.ktcTotal / maxKtc) * 100;
    const dynScore = SCORE_WEIGHTS.record * recScore
                   + SCORE_WEIGHTS.ktc    * ktcScore
                   + SCORE_WEIGHTS.age    * e.ageScore;

    const label = dynScore >= 65 ? 'Contender' : dynScore >= 45 ? 'Balanced' : 'Rebuilding';

    return {
      roster_id:    rid,
      team_name:    e.roster.team_name,
      display_name: e.roster.display_name,
      wins:         s.wins    || 0,
      losses:       s.losses  || 0,
      ties:         s.ties    || 0,
      fpts:         s.fpts    || 0,
      fpts_against: s.fpts_against || 0,
      ktc_total:    e.ktcTotal,
      age_score:    Math.round(e.ageScore * 10) / 10,
      dynasty_score: Math.round(dynScore * 10) / 10,
      label,
    };
  });

  results.sort((a, b) => b.dynasty_score - a.dynasty_score);
  results.forEach((r, i) => { r.rank = i + 1; });
  return results;
}

function buildPicksTable(tradedPicksRaw, fullRosters, currentYear = 2026) {
  const rosterMap = {};
  for (const r of fullRosters) rosterMap[r.roster_id] = r;

  const years  = [0, 1, 2].map(i => String(currentYear + i));
  const rounds = ['1', '2', '3'];

  const teamPicks = {};
  for (const rid of Object.keys(rosterMap)) {
    teamPicks[rid] = [];
    for (const year of years) {
      for (const round of rounds) {
        teamPicks[rid].push({ year, round, original_owner_id: Number(rid), current_owner_id: Number(rid), tier: 'mid' });
      }
    }
  }

  for (const trade of tradedPicksRaw) {
    const year      = String(trade.season);
    const round     = String(trade.round);
    const original  = trade.roster_id;
    const newOwner  = trade.owner_id;
    const prevOwner = trade.previous_owner_id;

    if (!years.includes(year) || !rounds.includes(round)) continue;
    if (!(original in teamPicks) || !(newOwner in teamPicks)) continue;

    const removeFrom = (prevOwner in teamPicks) ? prevOwner : original;
    teamPicks[removeFrom] = teamPicks[removeFrom].filter(p =>
      !(p.year === year && p.round === round && p.original_owner_id === Number(original))
    );

    teamPicks[newOwner].push({
      year, round,
      original_owner_id: Number(original),
      current_owner_id:  Number(newOwner),
      tier: 'mid',
    });
  }

  for (const [rid, picks] of Object.entries(teamPicks)) {
    for (const p of picks) {
      p.ktc_value   = getPickValue(p.year, p.round, p.tier);
      const orig     = rosterMap[p.original_owner_id];
      p.original_team = orig ? orig.team_name : `Team ${p.original_owner_id}`;
    }
    picks.sort((a, b) => a.year.localeCompare(b.year) || a.round.localeCompare(b.round));
  }

  return teamPicks;
}

function analyzeTrade(sideA, sideB, players, ktcLookup) {
  function analyzeSide(items) {
    let totalValue = 0;
    const positions = {};
    const ages = [];
    const details = [];

    for (const item of items) {
      if (item.type === 'player') {
        const p = players[item.player_id] || {};
        const name = `${p.first_name || ''} ${p.last_name || ''}`.trim() || item.name || '?';
        const pos  = p.position || item.position || '';
        const age  = p.age || 0;
        const ktcRec = matchPlayerKtc(name, pos, ktcLookup);
        const val = ktcRec ? ktcRec.sf_value : (item.override_value || 0);
        totalValue += val;
        positions[pos] = (positions[pos] || 0) + 1;
        if (age) ages.push(age);
        details.push({ label: name, pos, age, value: val });
      } else if (item.type === 'pick') {
        const val = item.override_value || getPickValue(item.year, item.round, item.tier || 'mid');
        totalValue += val;
        details.push({ label: `${item.year} R${item.round} (${item.tier || 'mid'})`, pos: 'PICK', age: null, value: val });
      }
    }

    const avgAge = ages.length ? Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10 : null;
    return { total_value: totalValue, avg_age: avgAge, positions, details };
  }

  const a = analyzeSide(sideA);
  const b = analyzeSide(sideB);
  const diff = a.total_value - b.total_value;
  const maxVal = Math.max(a.total_value, b.total_value, 1);
  const pct = Math.abs(diff) / maxVal * 100;

  let verdict, winner;
  if (pct < 5)    { verdict = 'Fair trade';                 winner = null; }
  else if (diff > 0) { verdict = `Team A wins by ${Math.round(pct)}%`; winner = 'A'; }
  else               { verdict = `Team B wins by ${Math.round(pct)}%`; winner = 'B'; }

  return { side_a: a, side_b: b, verdict, winner, diff, pct: Math.round(pct) };
}

function getAgeData(rosters, players, ktcLookup) {
  return rosters.map(roster => {
    const rows    = buildRosterDf(roster, players, ktcLookup);
    const profile = ageProfileByPosition(rows);
    return { team_name: roster.team_name, roster_id: roster.roster_id, profile };
  });
}

module.exports = {
  buildRosterDf, ageProfileByPosition, ageScore, totalKtc,
  powerRankings, buildPicksTable, analyzeTrade, getAgeData,
  AGING_THRESHOLDS, POSITIONS, IDEAL_AGES,
};
