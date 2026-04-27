'use strict';
const Database = require('better-sqlite3');
const path = require('path');

// Vercel's filesystem is read-only except /tmp. WAL mode needs shared memory
// that serverless environments don't provide, so we skip it there.
const IS_VERCEL = !!process.env.VERCEL;
const DB_PATH = IS_VERCEL
  ? '/tmp/cache.db'
  : path.join(__dirname, 'cache.db');

let _db = null;

function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    if (!IS_VERCEL) _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

function initDb() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS players (
      player_id  TEXT PRIMARY KEY,
      first_name TEXT,
      last_name  TEXT,
      full_name  TEXT,
      position   TEXT,
      nfl_team   TEXT,
      age        INTEGER,
      data       TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_players_name ON players(full_name);
    CREATE INDEX IF NOT EXISTS idx_players_pos  ON players(position);

    CREATE TABLE IF NOT EXISTS ktc_values (
      player_id   TEXT PRIMARY KEY,
      player_name TEXT,
      position    TEXT,
      sf_value    INTEGER,
      value       INTEGER,
      updated_at  INTEGER
    );

    CREATE TABLE IF NOT EXISTS ktc_picks (
      pick_key   TEXT PRIMARY KEY,
      sf_value   INTEGER,
      value      INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS trade_scenarios (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT,
      data       TEXT,
      created_at INTEGER
    );
  `);
  return db;
}

module.exports = { getDb, initDb };
