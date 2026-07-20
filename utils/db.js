// ─────────────────────────────────────────────────────────────────────────────
//  utils/db.js — PostgreSQL database layer
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ── SCHEMA ────────────────────────────────────────────────────────────────────
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      email       TEXT UNIQUE NOT NULL,
      phone       TEXT DEFAULT '',
      password    TEXT NOT NULL,
      plan        TEXT NOT NULL DEFAULT 'free',
      team_id     TEXT,
      sub_id      TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      order_id    TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      email       TEXT NOT NULL,
      amount      INTEGER NOT NULL,
      currency    TEXT NOT NULL DEFAULT 'INR',
      status      TEXT NOT NULL DEFAULT 'created',
      payment_id  TEXT,
      paid_at     TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      sub_id       TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      email        TEXT NOT NULL,
      plan         TEXT NOT NULL DEFAULT 'pro_monthly',
      status       TEXT NOT NULL DEFAULT 'active',
      start_date   TIMESTAMPTZ NOT NULL,
      next_billing TIMESTAMPTZ NOT NULL,
      order_id     TEXT,
      payment_id   TEXT,
      cancelled_at TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS teams (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      owner_id    TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS team_members (
      team_id     TEXT NOT NULL,
      email       TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'editor',
      joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (team_id, email)
    );

    CREATE TABLE IF NOT EXISTS invites (
      token        TEXT PRIMARY KEY,
      email        TEXT NOT NULL,
      team_id      TEXT NOT NULL,
      invited_by   TEXT NOT NULL,
      inviter_name TEXT NOT NULL,
      expires_at   TIMESTAMPTZ NOT NULL,
      used         BOOLEAN NOT NULL DEFAULT FALSE,
      accepted_at  TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS files (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_name   TEXT NOT NULL,
      mime_type     TEXT NOT NULL,
      size          INTEGER NOT NULL,
      category      TEXT NOT NULL DEFAULT 'other',
      path          TEXT NOT NULL,
      team_id       TEXT,
      deleted       BOOLEAN NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      token       TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      email       TEXT PRIMARY KEY,
      expires_at  TIMESTAMPTZ NOT NULL,
      used        BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_users_email   ON users(email);
    CREATE INDEX IF NOT EXISTS idx_files_user    ON files(user_id);
    CREATE INDEX IF NOT EXISTS idx_files_team    ON files(team_id);
  `);
  console.log('✅ PostgreSQL schema ready');
}

// ── QUERY HELPERS ─────────────────────────────────────────────────────────────
// Converts SQLite-style ? placeholders to PostgreSQL $1, $2, ...
function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Converts SQLite datetime() calls to PostgreSQL NOW()
function convertSql(sql) {
  return convertPlaceholders(sql)
    .replace(/datetime\('now'\)/gi, 'NOW()')
    .replace(/date\('now',\s*([^)]+)\)/gi, (_, interval) => {
      // e.g. date('now', '-7 days') → NOW() - INTERVAL '7 days'
      const clean = interval.replace(/'/g, '').trim();
      return `NOW() + INTERVAL '${clean}'`;
    })
    .replace(/\bINSERT OR IGNORE\b/gi, 'INSERT')
    .replace(/ON CONFLICT\(([^)]+)\) DO UPDATE SET\b/gi, 'ON CONFLICT($1) DO UPDATE SET')
    .replace(/COALESCE\(\?, /gi, 'COALESCE($1, ');
}

// Main query function — used like: await db.query(sql, [params])
async function query(sql, params = []) {
  const converted = convertSql(sql);
  const result = await pool.query(converted, params);
  return result;
}

// Returns first row or undefined (like SQLite's .get())
async function get(sql, params = []) {
  const result = await query(sql, params);
  return result.rows[0];
}

// Returns all rows (like SQLite's .all())
async function all(sql, params = []) {
  const result = await query(sql, params);
  return result.rows;
}

// Run without returning rows (like SQLite's .run())
async function run(sql, params = []) {
  const result = await query(sql, params);
  return result;
}

// Transaction helper
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { query, get, all, run, transaction, initSchema, pool };
