'use strict';
const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const { broadcast } = require('../websocket');

const VoiceResponse = twilio.twiml.VoiceResponse;
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

/**
 * POST /webhook/twilio/voice  (set this in Twilio phone number config)
 * Handles INBOUND calls to your Twilio number — rings the browser.
 */
router.post('/', (req, res) => {
  const twiml = new VoiceResponse();
  const from = req.body.From || 'Unknown';
  const callSid = req.body.CallSid;

  console.log(`[Voice] Inbound call from ${from} — SID: ${callSid}`);

  broadcast({
    type: 'inbound_call',
    from,
    callSid,
    timestamp: new Date().toISOString(),
  });

  // Ring the browser client
  const dial = twiml.dial({ timeout: 30 });
  dial.client('softphone-agent');

  res.type('text/xml');
  res.send(twiml.toString());
});

/**
 * POST /api/voice/outbound  (set this as the Voice Request URL in your TwiML App)
 * Handles OUTBOUND calls placed from the browser SDK.
 * The SDK sends the destination number as the "To" param.
 */
router.post('/outbound', (req, res) => {
  const twiml = new VoiceResponse();

  // Twilio 2.x SDK sends params prefixed — try both
  const to = req.body.To || req.body['params[To]'] || req.body.to;

  console.log(`[Voice] Outbound request body:`, JSON.stringify(req.body));

  if (!to) {
    console.error('[Voice] No To number in outbound request');
    twiml.say('Sorry, no destination number was provided.');
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  console.log(`[Voice] Outbound call to ${to}`);

  const dial = twiml.dial({ callerId: process.env.TWILIO_PHONE_NUMBER });
  dial.number(to);

  res.type('text/xml');
  res.send(twiml.toString());
});

/**
 * POST /api/voice/status
 * Twilio calls this when a call ends/changes state.
 */
router.post('/status', (req, res) => {
  const { CallSid, CallStatus, Duration, To, From } = req.body;
  console.log(`[Voice] Call ${CallSid} → ${CallStatus}`);
  broadcast({
    type: 'call_status',
    callSid: CallSid,
    status: CallStatus,
    duration: Duration ? parseInt(Duration) : null,
    to: To,
    from: From,
    timestamp: new Date().toISOString(),
  });
  res.sendStatus(200);
});

/**
 * GET /api/voice/calls — recent call log
 */
router.get('/calls', async (req, res) => {
  try {
    const calls = await client.calls.list({ limit: 50 });
    res.json(calls.map(c => ({
      sid: c.sid, from: c.from, to: c.to,
      status: c.status, direction: c.direction,
      duration: c.duration, startTime: c.startTime,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
