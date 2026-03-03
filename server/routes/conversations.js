'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/conversations — load all conversations with last message
router.get('/', async (req, res) => {
  if (!db.isAvailable()) return res.json([]);
  const convs = await db.getConversations();
  res.json(convs.map(c => ({
    phone: c.phone,
    name: c.name || c.phone,
    channel: c.channel,
    lastBody: c.last_body,
    lastTs: c.last_ts,
    unread: c.unread,
  })));
});

// GET /api/conversations/:phone/messages
router.get('/:phone/messages', async (req, res) => {
  if (!db.isAvailable()) return res.json([]);
  const messages = await db.getMessages(decodeURIComponent(req.params.phone));
  res.json(messages.map(m => ({
    id: m.msg_id,
    body: m.body,
    direction: m.direction,
    channel: m.channel,
    ts: m.ts,
  })));
});

// POST /api/conversations/:phone/read — mark as read
router.post('/:phone/read', async (req, res) => {
  if (db.isAvailable()) await db.clearUnread(decodeURIComponent(req.params.phone));
  res.sendStatus(200);
});

module.exports = router;
