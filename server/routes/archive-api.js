'use strict';
const express = require('express');
const router  = express.Router();
const twilio  = require('twilio');
const db      = require('../db');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

/**
 * GET /api/archive/conversations
 * Returns all conversations grouped by phone, with message count,
 * last message preview, date range, and channel.
 * Supports ?q= search across contact name, phone, and message bodies.
 */
router.get('/conversations', async (req, res) => {
  const search = req.query.q || '';
  const connStr = process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_PUBLIC_URL;
  if (!connStr) return res.json({ conversations: [] });

  try {
    const { Pool } = require('pg');
    const p = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false } });

    const params = [];
    let searchClause = '';
    if (search) {
      params.push(`%${search}%`);
      searchClause = `WHERE (m.phone ILIKE $1 OR c.name ILIKE $1 OR m.body ILIKE $1)`;
    }

    const { rows } = await p.query(`
      SELECT
        m.phone,
        MAX(c.name)                                      AS contact_name,
        COUNT(*)::int                                    AS message_count,
        SUM(CASE WHEN m.direction = 'in'  THEN 1 ELSE 0 END)::int AS inbound_count,
        SUM(CASE WHEN m.direction = 'out' THEN 1 ELSE 0 END)::int AS outbound_count,
        MIN(m.ts)                                        AS first_ts,
        MAX(m.ts)                                        AS last_ts,
        MAX(m.channel)                                   AS channel,
        (ARRAY_AGG(m.body ORDER BY m.ts DESC))[1]        AS last_body,
        (ARRAY_AGG(m.direction ORDER BY m.ts DESC))[1]   AS last_direction
      FROM messages m
      LEFT JOIN contacts c ON c.phone = m.phone
      ${searchClause}
      GROUP BY m.phone
      ORDER BY MAX(m.ts) DESC
    `, params);

    await p.end();
    res.json({ conversations: rows });
  } catch (err) {
    console.error('[Archive API] conversations error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/archive/conversations/:phone/messages
 * Returns all messages for a single conversation thread.
 */
router.get('/conversations/:phone/messages', async (req, res) => {
  const phone   = decodeURIComponent(req.params.phone);
  const connStr = process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_PUBLIC_URL;
  if (!connStr) return res.json({ messages: [] });

  try {
    const { Pool } = require('pg');
    const p = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false } });

    const { rows } = await p.query(`
      SELECT m.*, c.name AS contact_name
      FROM messages m
      LEFT JOIN contacts c ON c.phone = m.phone
      WHERE m.phone = $1
      ORDER BY m.ts ASC
    `, [phone]);

    await p.end();
    res.json({ messages: rows });
  } catch (err) {
    console.error('[Archive API] thread error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/archive/recordings
 * List of call recordings from Twilio with metadata.
 */
router.get('/recordings', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50'), 100);
    const recs  = await client.recordings.list({ limit });

    const out = recs.map(r => ({
      sid:       r.sid,
      callSid:   r.callSid,
      from:      r.from || '—',
      to:        r.to   || '—',
      duration:  parseInt(r.duration || 0),
      startTime: r.startTime,
      status:    r.status,
      // We proxy the audio through our server to avoid CORS/auth issues
      audioUrl:  `/api/archive/recordings/${r.sid}/audio`,
    }));

    res.json({ recordings: out, total: out.length });
  } catch (err) {
    console.error('[Archive API] recordings error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/archive/recordings/:sid/audio
 * Proxy the MP3 from Twilio so the browser can play it without auth headers.
 */
router.get('/recordings/:sid/audio', async (req, res) => {
  try {
    const { sid } = req.params;
    const mp3Url  = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${sid}.mp3`;
    const auth    = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');

    const upstream = await fetch(mp3Url, { headers: { Authorization: `Basic ${auth}` } });
    if (!upstream.ok) return res.status(404).json({ error: 'Recording not found' });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    // Stream it
    const reader = upstream.body.getReader();
    const pump = async () => {
      const { done, value } = await reader.read();
      if (done) { res.end(); return; }
      res.write(Buffer.from(value));
      await pump();
    };
    await pump();
  } catch (err) {
    console.error('[Archive API] audio proxy error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
