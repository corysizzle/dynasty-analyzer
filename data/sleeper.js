'use strict';
const { getDb } = require('./db');

const LEAGUE_ID = '1312091499034316800';
const BASE_URL  = 'https://api.sleeper.app/v1';
const PLAYER_TTL = 86400; // 24h

async function sleeperGet(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'User-Agent': 'SleeperDynastyAnalyzer/1.0' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Sleeper API ${path} → ${res.status}`);
  return res.json();
}

async function getLeague()      { return sleeperGet(`/league/${LEAGUE_ID}`); }
async function getUsers()       { return sleeperGet(`/league/${LEAGUE_ID}/users`); }
async function getRosters()     { return sleeperGet(`/league/${LEAGUE_ID}/rosters`); }
async function getTradedPicks() { return sleeperGet(`/league/${LEAGUE_ID}/traded_picks`); }

async function getPlayers(forceRefresh = false) {
  const db = getDb();
  const meta = db.prepare("SELECT value FROM meta WHERE key='players_fetched_at'").get();
  const stale = !meta || (Date.now() / 1000 - parseFloat(meta.value)) > PLAYER_TTL;

  if (!stale && !forceRefresh) {
    const rows = db.prepare('SELECT player_id, data FROM players').all();
    if (rows.length) {
      const map = {};
      for (const r of rows) map[r.player_id] = JSON.parse(r.data);
      return map;
    }
  }

  const players = await sleeperGet('/players/nfl');

  const insert = db.prepare(`
    INSERT OR REPLACE INTO players(player_id, first_name, last_name, full_name, position, nfl_team, age, data)
    VALUES(@player_id, @first_name, @last_name, @full_name, @position, @nfl_team, @age, @data)
  `);
  const upsertMany = db.transaction(entries => {
    db.prepare('DELETE FROM players').run();
    for (const [pid, p] of entries) {
      insert.run({
        player_id:  pid,
        first_name: p.first_name || '',
        last_name:  p.last_name  || '',
        full_name:  `${p.first_name || ''} ${p.last_name || ''}`.trim(),
        position:   p.position || '',
        nfl_team:   p.team || 'FA',
        age:        p.age || 0,
        data:       JSON.stringify(p),
      });
    }
  });
  upsertMany(Object.entries(players));

  db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('players_fetched_at',?)")
    .run(String(Date.now() / 1000));

  return players;
}

async function getLeagueStandings() {
  const [rosters, users] = await Promise.all([getRosters(), getUsers()]);
  const userMap = {};
  for (const u of users) userMap[u.user_id] = u;

  return rosters.map(r => {
    const s = r.settings || {};
    const user = userMap[r.owner_id] || {};
    const meta = user.metadata || {};
    const teamName = meta.team_name || user.display_name || `Team ${r.roster_id}`;
    return {
      roster_id:    r.roster_id,
      owner_id:     r.owner_id,
      display_name: user.display_name || '',
      team_name:    teamName,
      wins:   s.wins   || 0,
      losses: s.losses || 0,
      ties:   s.ties   || 0,
      fpts:   (s.fpts || 0) + (s.fpts_decimal || 0) / 100,
      fpts_against: (s.fpts_against || 0) + (s.fpts_against_decimal || 0) / 100,
    };
  });
}

async function getFullRosters() {
  const [rosters, users] = await Promise.all([getRosters(), getUsers()]);
  const userMap = {};
  for (const u of users) userMap[u.user_id] = u;

  return rosters.map(r => {
    const user = userMap[r.owner_id] || {};
    const meta = user.metadata || {};
    const teamName = meta.team_name || user.display_name || `Team ${r.roster_id}`;
    return {
      roster_id:    r.roster_id,
      owner_id:     r.owner_id,
      display_name: user.display_name || '',
      team_name:    teamName,
      players:  r.players  || [],
      starters: r.starters || [],
      taxi:     r.taxi     || [],
      reserve:  r.reserve  || [],
    };
  });
}

async function searchPlayers(query, limit = 20) {
  const db = getDb();
  const q = `%${query.toLowerCase()}%`;
  return db.prepare(`
    SELECT player_id, first_name, last_name, full_name, position, nfl_team, age
    FROM players
    WHERE lower(full_name) LIKE ? AND position IN ('QB','RB','WR','TE')
    ORDER BY length(full_name)
    LIMIT ?
  `).all(q, limit);
}

module.exports = {
  getLeague, getUsers, getRosters, getTradedPicks,
  getPlayers, getLeagueStandings, getFullRosters, searchPlayers,
};
