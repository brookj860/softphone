'use strict';
const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// Sessions stored in memory (resets on redeploy, that's fine for personal use)
const sessions = new Map();

function makeSession() {
  const id = crypto.randomBytes(32).toString('hex');
  sessions.set(id, { created: Date.now() });
  return id;
}

function validSession(req) {
  const sid = req.cookies?.sid;
  if (!sid) return false;
  const session = sessions.get(sid);
  if (!session) return false;
  // Sessions expire after 30 days
  if (Date.now() - session.created > 30 * 24 * 60 * 60 * 1000) {
    sessions.delete(sid);
    return false;
  }
  return true;
}

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.APP_USERNAME || 'admin';
  const validPass = process.env.APP_PASSWORD;

  if (!validPass) {
    // No password set — allow through (first run)
    const sid = makeSession();
    res.cookie('sid', sid, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 30 * 24 * 60 * 60 * 1000 });
    return res.json({ ok: true });
  }

  if (username === validUser && password === validPass) {
    const sid = makeSession();
    res.cookie('sid', sid, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 30 * 24 * 60 * 60 * 1000 });
    return res.json({ ok: true });
  }

  res.status(401).json({ error: 'Invalid username or password' });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const sid = req.cookies?.sid;
  if (sid) sessions.delete(sid);
  res.clearCookie('sid');
  res.json({ ok: true });
});

// GET /api/auth/check
router.get('/check', (req, res) => {
  res.json({ authenticated: validSession(req) });
});

module.exports = { router, validSession };
