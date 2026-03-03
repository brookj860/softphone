'use strict';
const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const { broadcast } = require('../websocket');
const db = require('../db');
const { archiveSMS } = require('../archive');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const MessagingResponse = twilio.twiml.MessagingResponse;

function normalizePhone(phone) {
  if (!phone) return phone;
  let p = phone.trim().replace(/[\s\-().]/g, '');
  if (/^07\d{9}$/.test(p)) return '+44' + p.slice(1);
  if (/^447\d{9}$/.test(p)) return '+' + p;
  if (/^0\d{9,}$/.test(p)) return '+44' + p.slice(1);
  return p;
}

// POST /webhook/twilio/sms
router.post('/', async (req, res) => {
  const { To, Body, MessageSid } = req.body;
  const From = normalizePhone(req.body.From);
  console.log(`[SMS] Inbound from ${From}: "${(Body||'').substring(0, 80)}"`);

  const contact = await db.lookupContact(From);
  const name = contact?.name || From;

  const msg = { id: MessageSid, body: Body, direction: 'in', channel: 'sms', status: 'received', ts: new Date().toISOString() };

  if (db.isAvailable()) {
    await db.upsertConversation(From, name, 'sms', Body);
    await db.saveMessage(From, msg);
    await db.incrementUnread(From);
  }

  broadcast({ type: 'inbound_sms', sid: MessageSid, from: From, to: To, body: Body, profileName: name, channel: 'sms', timestamp: new Date().toISOString() });

  // Archive — fire and forget, never blocks the response
  archiveSMS({ direction: 'in', from: From, to: To, body: Body, sid: MessageSid, channel: 'sms', ts: new Date() });

  const twiml = new MessagingResponse();
  res.type('text/xml');
  res.send(twiml.toString());
});

// POST /api/sms/send
router.post('/send', async (req, res) => {
  const { to, body } = req.body;
  if (!to || !body) return res.status(400).json({ error: 'Missing to or body' });

  try {
    const message = await client.messages.create({ from: process.env.TWILIO_PHONE_NUMBER, to, body });
    const msg = { id: message.sid, body, direction: 'out', channel: 'sms', status: message.status, ts: new Date().toISOString() };

    if (db.isAvailable()) {
      await db.upsertConversation(to, '', 'sms', body);
      await db.saveMessage(to, msg);
    }

    archiveSMS({ direction: 'out', from: process.env.TWILIO_PHONE_NUMBER, to, body, sid: message.sid, channel: 'sms', ts: new Date() });

    res.json({ sid: message.sid, status: message.status });
  } catch (err) {
    console.error('[SMS] Send error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sms/history?phone=+441234567890
router.get('/history', async (req, res) => {
  const phone = req.query.phone;
  if (!phone) return res.status(400).json({ error: 'phone param required' });

  if (db.isAvailable()) {
    const messages = await db.getMessages(phone);
    return res.json(messages.map(m => ({ id: m.msg_id, body: m.body, direction: m.direction, channel: m.channel, ts: m.ts })));
  }
  res.json([]);
});

module.exports = router;
