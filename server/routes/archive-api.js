'use strict';
const express = require('express');
const router  = express.Router();
const twilio  = require('twilio');
const db      = require('../db');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

/**
 * GET /api/archive/messages
 * Full SMS/WA message log, paginated, with contact name resolved.
 */
router.get('/messages', async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  || '100'), 500);
  const offset = parseInt(req.query.offset || '0');
  const search = req.query.q || '';
  const ch     = req.query.channel || '';

  try {
    const pool = require('../db');
    let query = `
      SELECT m.*, c.name AS contact_name
      FROM messages m
      LEFT JOIN contacts c ON c.phone = m.phone
    `;
    const params = [];
    const where  = [];

    if (search) {
      params.push(`%${search}%`);
      where.push(`(m.body ILIKE $${params.length} OR m.phone ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
    }
    if (ch) {
      params.push(ch);
      where.push(`m.channel = $${params.length}`);
    }

    if (where.length) query += ' WHERE ' + where.join(' AND ');
    query += ` ORDER BY m.ts DESC LIMIT ${limit} OFFSET ${offset}`;

    const { Pool } = require('pg');
    const connStr = process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_PUBLIC_URL;
    if (!connStr) return res.json({ messages: [], total: 0 });

    const p = new (require('pg').Pool)({
      connectionString: connStr,
      ssl: { rejectUnauthorized: false },
    });
    const { rows } = await p.query(query, params);
    const { rows: countRows } = await p.query(
      `SELECT COUNT(*) FROM messages m LEFT JOIN contacts c ON c.phone = m.phone` +
      (where.length ? ' WHERE ' + where.join(' AND ') : ''),
      params
    );
    await p.end();

    res.json({ messages: rows, total: parseInt(countRows[0].count) });
  } catch (err) {
    console.error('[Archive API] messages error:', err.message);
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
