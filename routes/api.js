'use strict';
const express = require('express');
const multer  = require('multer');
const { getDb } = require('../data/db');
const {
  getLeague, getPlayers, getFullRosters, getLeagueStandings,
  getTradedPicks, searchPlayers,
} = require('../data/sleeper');
const { getKtcValues, getPickValue, matchPlayerKtc, loadFromCsvBuffer } = require('../data/ktc');
const {
  buildRosterDf, powerRankings, buildPicksTable,
  analyzeTrade, getAgeData, AGING_THRESHOLDS,
} = require('../data/analysis');

const router  = express.Router();
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// --- helpers ----------------------------------------------------------

let _cache = null;
async function getAppData() {
  if (_cache) return _cache;
  const [players, ktc, rosters, standings, traded] = await Promise.all([
    getPlayers(),
    getKtcValues(),
    getFullRosters(),
    getLeagueStandings(),
    getTradedPicks(),
  ]);
  const picksTable = buildPicksTable(traded, rosters);
  _cache = { players, ktc, rosters, standings, traded, picksTable };
  return _cache;
}

function invalidateCache() { _cache = null; }

// --- routes -----------------------------------------------------------

router.get('/league', async (req, res) => {
  try {
    res.json(await getLeague());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/rosters', async (req, res) => {
  try {
    const { players, ktc, rosters } = await getAppData();
    const result = rosters.map(roster => ({
      roster_id:    roster.roster_id,
      team_name:    roster.team_name,
      display_name: roster.display_name,
      players:      buildRosterDf(roster, players, ktc),
    }));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/standings', async (req, res) => {
  try {
    const { players, ktc, rosters, standings } = await getAppData();
    res.json(powerRankings(rosters, players, ktc, standings));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/picks', async (req, res) => {
  try {
    const { rosters, traded, picksTable } = await getAppData();
    const tier = req.query.tier || 'mid';

    // Re-price picks for requested tier
    const priced = {};
    for (const [rid, picks] of Object.entries(picksTable)) {
      priced[rid] = picks.map(p => ({
        ...p,
        ktc_value: getPickValue(p.year, p.round, tier),
      }));
    }

    const rosterMeta = rosters.map(r => {
      const picks = priced[r.roster_id] || [];
      return {
        roster_id: r.roster_id,
        team_name: r.team_name,
        picks,
        total_ktc: picks.reduce((s, p) => s + p.ktc_value, 0),
        num_picks: picks.length,
      };
    });

    res.json({ rosterMeta, picks: priced });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/age', async (req, res) => {
  try {
    const { players, ktc, rosters } = await getAppData();
    res.json(getAgeData(rosters, players, ktc));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/players/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  try {
    const { ktc } = await getAppData();
    const rows = await searchPlayers(q);
    const results = rows.map(p => {
      const ktcRec = matchPlayerKtc(p.full_name, p.position, ktc);
      return { ...p, ktc_sf_value: ktcRec ? ktcRec.sf_value : 0 };
    });
    results.sort((a, b) => b.ktc_sf_value - a.ktc_sf_value);
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/trade/analyze', express.json(), async (req, res) => {
  try {
    const { sideA = [], sideB = [] } = req.body;
    const { players, ktc } = await getAppData();
    res.json(analyzeTrade(sideA, sideB, players, ktc));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/trade/scenarios', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      'SELECT id, name, created_at FROM trade_scenarios ORDER BY created_at DESC LIMIT 30'
    ).all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/trade/scenarios', express.json(), (req, res) => {
  try {
    const { name, sideA, sideB } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const db = getDb();
    const result = db.prepare(
      'INSERT INTO trade_scenarios(name, data, created_at) VALUES(?, ?, ?)'
    ).run(name, JSON.stringify({ sideA, sideB }), Math.floor(Date.now() / 1000));
    res.json({ id: result.lastInsertRowid, name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/trade/scenarios/:id', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM trade_scenarios WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json({ ...row, data: JSON.parse(row.data) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/trade/scenarios/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM trade_scenarios WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/refresh', async (req, res) => {
  try {
    invalidateCache();
    const [players, ktc] = await Promise.all([
      getPlayers(true),
      getKtcValues(true),
    ]);
    const [rosters, standings, traded] = await Promise.all([
      getFullRosters(),
      getLeagueStandings(),
      getTradedPicks(),
    ]);
    const picksTable = buildPicksTable(traded, rosters);
    _cache = { players, ktc, rosters, standings, traded, picksTable };
    res.json({ ok: true, players: Object.keys(players).length, ktc: Object.keys(ktc).length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/ktc/csv', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const ktc = loadFromCsvBuffer(req.file.buffer);
    invalidateCache();
    res.json({ ok: true, count: Object.keys(ktc).length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
