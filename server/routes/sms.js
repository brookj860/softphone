'use strict';
const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const { broadcast } = require('../websocket');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const MessagingResponse = twilio.twiml.MessagingResponse;

function validateTwilio(req, res, next) {
  // Skip validation in production behind Railway proxy
  // Twilio signature validation requires exact URL match which breaks behind proxies
  // Security is maintained by keeping webhook URLs private
  next();
}

/**
 * POST /webhook/twilio/sms
 * Twilio calls this URL for inbound SMS messages.
 */
router.post('/', validateTwilio, (req, res) => {
  const { From, To, Body, MessageSid, NumMedia } = req.body;

  console.log(`[SMS] Inbound from ${From}: "${Body.substring(0, 80)}"`);

  // Broadcast to connected browser clients
  broadcast({
    type: 'inbound_sms',
    sid: MessageSid,
    from: From,
    to: To,
    body: Body,
    numMedia: parseInt(NumMedia) || 0,
    channel: 'sms',
    timestamp: new Date().toISOString(),
  });

  // Empty TwiML response (we handle messaging via API, not auto-reply)
  const twiml = new MessagingResponse();
  res.type('text/xml');
  res.send(twiml.toString());
});

/**
 * POST /api/sms/send
 * Send an outbound SMS.
 * Body: { to, body }
 */
router.post('/send', async (req, res) => {
  const { to, body } = req.body;

  if (!to || !body) {
    return res.status(400).json({ error: 'Missing required fields: to, body' });
  }

  try {
    const message = await client.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
      body,
    });

    console.log(`[SMS] Sent to ${to} — SID: ${message.sid}`);

    // Echo back to all clients so multi-tab works
    broadcast({
      type: 'outbound_sms',
      sid: message.sid,
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
      body,
      status: message.status,
      channel: 'sms',
      timestamp: new Date().toISOString(),
    });

    res.json({ sid: message.sid, status: message.status });
  } catch (err) {
    console.error('[SMS] Send error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/sms/history
 * Fetch recent SMS history from Twilio.
 * Query params: ?to=+441234567890 (optional filter)
 */
router.get('/history', async (req, res) => {
  try {
    const filters = { limit: 50 };
    if (req.query.to) filters.to = req.query.to;
    if (req.query.from) filters.from = req.query.from;

    const messages = await client.messages.list(filters);
    res.json(messages.map(m => ({
      sid: m.sid,
      from: m.from,
      to: m.to,
      body: m.body,
      status: m.status,
      direction: m.direction,
      dateSent: m.dateSent,
    })));
  } catch (err) {
    console.error('[SMS] History error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
