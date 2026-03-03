'use strict';
const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) {
    const connStr = process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_PUBLIC_URL;
    pool = new Pool({
      connectionString: connStr,
      ssl: connStr?.includes('railway') || connStr?.includes('postgres') ? { rejectUnauthorized: false } : false,
    });
    pool.on('error', (err) => console.error('[DB] Unexpected error:', err.message));
  }
  return pool;
}

// ── Create tables if they don't exist ─────────────────────
async function init() {
  const connStr = process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_PUBLIC_URL;
  if (!connStr) {
    console.log('[DB] No DATABASE_URL — history will not persist');
    return false;
  }

  try {
    const db = getPool();
    await db.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id          SERIAL PRIMARY KEY,
        phone       TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL DEFAULT '',
        channel     TEXT NOT NULL DEFAULT 'sms',
        last_body   TEXT NOT NULL DEFAULT '',
        last_ts     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        unread      INT NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS messages (
        id          SERIAL PRIMARY KEY,
        phone       TEXT NOT NULL,
        msg_id      TEXT,
        body        TEXT NOT NULL,
        direction   TEXT NOT NULL,
        channel     TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'sent',
        ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
      CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts DESC);

      CREATE TABLE IF NOT EXISTS contacts (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        phone       TEXT NOT NULL UNIQUE,
        notes       TEXT NOT NULL DEFAULT '',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // Fix any blank channel values from old data
    await db.query(`UPDATE conversations SET channel = 'sms' WHERE channel IS NULL OR channel = ''`).catch(() => {});
    // Add avatar column if it doesn't exist (safe migration)
    await db.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS avatar TEXT`).catch(() => {});
    // Add app_settings table for profile photo and other prefs
    await db.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    console.log('[DB] Connected and tables ready ✓');
    return true;
  } catch (err) {
    console.error('[DB] Init error:', err.message);
    return false;
  }
}

// ── Conversations ──────────────────────────────────────────
async function getConversations() {
  try {
    const { rows } = await getPool().query(`
      SELECT *,
        COALESCE(NULLIF(channel, ''), 'sms') AS channel
      FROM conversations ORDER BY last_ts DESC
    `);
    return rows;
  } catch (err) {
    console.error('[DB] getConversations:', err.message);
    return [];
  }
}

async function upsertConversation(phone, name, channel, lastBody) {
  try {
    await getPool().query(`
      INSERT INTO conversations (phone, name, channel, last_body, last_ts)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (phone) DO UPDATE SET
        name = CASE WHEN $2 != '' THEN $2 ELSE conversations.name END,
        channel = EXCLUDED.channel,
        last_body = EXCLUDED.last_body,
        last_ts = NOW()
    `, [phone, name || '', channel, lastBody || '']);
  } catch (err) {
    console.error('[DB] upsertConversation:', err.message);
  }
}

async function incrementUnread(phone) {
  try {
    await getPool().query(`
      UPDATE conversations SET unread = unread + 1 WHERE phone = $1
    `, [phone]);
  } catch (err) {
    console.error('[DB] incrementUnread:', err.message);
  }
}

async function clearUnread(phone) {
  try {
    await getPool().query(`UPDATE conversations SET unread = 0 WHERE phone = $1`, [phone]);
  } catch (err) {
    console.error('[DB] clearUnread:', err.message);
  }
}

// ── Messages ───────────────────────────────────────────────
async function saveMessage(phone, msg) {
  try {
    await getPool().query(`
      INSERT INTO messages (phone, msg_id, body, direction, channel, status, ts)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [phone, msg.id || null, msg.body, msg.direction, msg.channel, msg.status || 'sent', msg.ts || new Date()]);
  } catch (err) {
    console.error('[DB] saveMessage:', err.message);
  }
}

async function getMessages(phone, limit = 100) {
  try {
    const { rows } = await getPool().query(`
      SELECT * FROM messages WHERE phone = $1 ORDER BY ts ASC LIMIT $2
    `, [phone, limit]);
    return rows;
  } catch (err) {
    console.error('[DB] getMessages:', err.message);
    return [];
  }
}

// ── Contacts ───────────────────────────────────────────────
async function getContacts(search = '') {
  try {
    if (search) {
      const { rows } = await getPool().query(`
        SELECT * FROM contacts WHERE name ILIKE $1 OR phone ILIKE $1 ORDER BY name
      `, [`%${search}%`]);
      return rows;
    }
    const { rows } = await getPool().query(`SELECT * FROM contacts ORDER BY name`);
    return rows;
  } catch (err) {
    console.error('[DB] getContacts:', err.message);
    return [];
  }
}

async function saveContact(id, name, phone, notes) {
  try {
    await getPool().query(`
      INSERT INTO contacts (id, name, phone, notes)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (phone) DO UPDATE SET name = $2, notes = $4
    `, [id, name, phone, notes || '']);
    return true;
  } catch (err) {
    console.error('[DB] saveContact:', err.message);
    return false;
  }
}

async function deleteContact(id) {
  try {
    await getPool().query(`DELETE FROM contacts WHERE id = $1`, [id]);
    return true;
  } catch (err) {
    console.error('[DB] deleteContact:', err.message);
    return false;
  }
}

async function lookupContact(phone) {
  try {
    const { rows } = await getPool().query(`SELECT * FROM contacts WHERE phone = $1`, [phone]);
    return rows[0] || null;
  } catch (err) {
    return null;
  }
}

async function getSetting(key) {
  try {
    const connStr = process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_PUBLIC_URL;
    if (!connStr) return null;
    const { rows } = await getPool().query(`SELECT value FROM app_settings WHERE key = $1`, [key]);
    return rows[0]?.value || null;
  } catch { return null; }
}

async function setSetting(key, value) {
  try {
    await getPool().query(`
      INSERT INTO app_settings (key, value) VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET value = $2
    `, [key, value]);
    return true;
  } catch { return false; }
}

module.exports = {
  init,
  isAvailable: () => !!(process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_PUBLIC_URL),
  getConversations,
  upsertConversation,
  incrementUnread,
  clearUnread,
  saveMessage,
  getMessages,
  getContacts,
  saveContact,
  deleteContact,
  lookupContact,
  getSetting,
  setSetting,
};
