'use strict';
const { getDb } = require('./db');
const { parse: csvParse } = require('csv-parse/sync');

const KTC_TTL = 86400;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://keeptradecut.com/dynasty-rankings',
};

const PICK_ESTIMATES = {
  '2026-1-early': 7500, '2026-1-mid': 6200, '2026-1-late': 5000,
  '2026-2-early': 3200, '2026-2-mid': 2600, '2026-2-late': 2000,
  '2026-3-early': 1000, '2026-3-mid':  800, '2026-3-late':  600,
  '2027-1-early': 5500, '2027-1-mid': 4500, '2027-1-late': 3800,
  '2027-2-early': 2500, '2027-2-mid': 2000, '2027-2-late': 1600,
  '2027-3-early':  800, '2027-3-mid':  650, '2027-3-late':  500,
  '2028-1-early': 4500, '2028-1-mid': 3800, '2028-1-late': 3200,
  '2028-2-early': 2000, '2028-2-mid': 1600, '2028-2-late': 1200,
  '2028-3-early':  650, '2028-3-mid':  500, '2028-3-late':  400,
};

function getPickValue(year, round, tier = 'mid') {
  return PICK_ESTIMATES[`${year}-${round}-${tier}`] || 500;
}

function normalizeName(name) {
  let n = (name || '').toLowerCase().trim()
    .replace(/\./g, '').replace(/'/g, '').replace(/-/g, ' ');
  for (const suffix of [' jr', ' sr', ' ii', ' iii', ' iv']) {
    if (n.endsWith(suffix)) n = n.slice(0, -suffix.length).trim();
  }
  return n;
}

function buildLookup(records) {
  const lookup = {};
  for (const r of records) {
    const key = normalizeName(r.player_name);
    if (key) lookup[key] = r;
  }
  return lookup;
}

function matchPlayerKtc(name, position, lookup) {
  const norm = normalizeName(name);
  if (lookup[norm]) return lookup[norm];

  const parts = norm.split(' ');
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    for (const [key, val] of Object.entries(lookup)) {
      if (key.endsWith(last) && val.position === position) return val;
    }
  }
  return null;
}

function isCacheFresh() {
  const db = getDb();
  const row = db.prepare("SELECT value FROM meta WHERE key='ktc_fetched_at'").get();
  if (!row) return false;
  return (Date.now() / 1000 - parseFloat(row.value)) < KTC_TTL;
}

function loadFromDbCache() {
  const db = getDb();
  return db.prepare('SELECT * FROM ktc_values').all();
}

function saveToCache(records) {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const insert = db.prepare(`
    INSERT OR REPLACE INTO ktc_values(player_id, player_name, position, sf_value, value, updated_at)
    VALUES(@player_id, @player_name, @position, @sf_value, @value, @updated_at)
  `);
  const run = db.transaction(recs => {
    db.prepare('DELETE FROM ktc_values').run();
    for (const r of recs) insert.run({ ...r, updated_at: now });
  });
  run(records);
  db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('ktc_fetched_at',?)").run(String(Date.now() / 1000));
}

function normalizeKtcData(data) {
  const records = [];
  const items = Array.isArray(data) ? data : Object.values(data);
  for (const item of items) {
    const sfBlock  = item.superflexValues || {};
    const oneBlock = item.oneQBValues || {};
    const sfVal  = typeof sfBlock === 'object'  ? (sfBlock.value  || item.sfValue  || item.value || 0) : (item.sfValue || item.value || 0);
    const oneVal = typeof oneBlock === 'object' ? (oneBlock.value || item.value || 0) : (item.value || 0);
    const name = item.playerName || item.name || '';
    const pos  = item.position || '';
    records.push({
      player_id:   String(item.playerID || item.id || `${name}_${pos}`),
      player_name: name,
      position:    pos,
      sf_value:    Math.round(sfVal),
      value:       Math.round(oneVal),
    });
  }
  return records.filter(r => r.player_name);
}

async function fetchFromKtc() {
  const urls = [
    'https://keeptradecut.com/api/sf-rankings',
    'https://keeptradecut.com/api/rankings?format=2',
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
      if (res.ok) {
        const data = await res.json();
        const records = normalizeKtcData(data);
        if (records.length > 0) return records;
      }
    } catch (_) {}
  }

  // Try HTML page scraping as last resort
  try {
    const res = await fetch('https://keeptradecut.com/dynasty-rankings?format=2', {
      headers: HEADERS, signal: AbortSignal.timeout(25000),
    });
    if (res.ok) {
      const html = await res.text();
      const match = html.match(/var\s+playersArray\s*=\s*(\[[\s\S]*?\]);/);
      if (match) {
        const data = JSON.parse(match[1]);
        return normalizeKtcData(data);
      }
    }
  } catch (_) {}

  throw new Error('All KTC fetch attempts failed');
}

async function getKtcValues(forceRefresh = false) {
  if (!forceRefresh && isCacheFresh()) {
    const cached = loadFromDbCache();
    if (cached.length) return buildLookup(cached);
  }

  try {
    const records = await fetchFromKtc();
    saveToCache(records);
    return buildLookup(records);
  } catch (err) {
    console.warn('[KTC] Fetch failed:', err.message, '— using cache');
    const cached = loadFromDbCache();
    if (cached.length) return buildLookup(cached);
    return {};
  }
}

function loadFromCsvBuffer(buffer) {
  const content = buffer.toString('utf-8');
  const records = csvParse(content, { columns: true, skip_empty_lines: true, trim: true });
  const headers = Object.keys(records[0] || {});

  function findCol(...candidates) {
    for (const c of candidates) {
      const match = headers.find(h => h.toLowerCase().replace(/[^a-z0-9]/g, '') === c.toLowerCase().replace(/[^a-z0-9]/g, ''));
      if (match) return match;
    }
    return null;
  }

  const nameCol  = findCol('player', 'name', 'playername');
  const posCol   = findCol('position', 'pos');
  const sfCol    = findCol('sfvalue', 'superflexvalue', 'sf value', 'value_sf');
  const valCol   = findCol('value', '1qbvalue', 'oneqb');

  const normalized = records
    .map(row => {
      const name = (row[nameCol] || '').trim();
      const pos  = (row[posCol]  || '').trim();
      const sfVal  = parseInt(String(row[sfCol]  || '0').replace(/,/g, ''), 10) || 0;
      const oneVal = parseInt(String(row[valCol] || '0').replace(/,/g, ''), 10) || 0;
      return {
        player_id:   `${name}_${pos}`,
        player_name: name,
        position:    pos,
        sf_value:    sfVal,
        value:       oneVal,
      };
    })
    .filter(r => r.player_name);

  saveToCache(normalized);
  return buildLookup(normalized);
}

module.exports = { getKtcValues, getPickValue, matchPlayerKtc, loadFromCsvBuffer, normalizeName };
