'use strict';
const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const { broadcast } = require('../websocket');

const VoiceResponse = twilio.twiml.VoiceResponse;
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// ── Validate Twilio request signature ─────────────────────
function validateTwilio(req, res, next) {
  // Signature validation skipped - breaks behind Railway proxy
  next();
}

/**
 * POST /webhook/twilio/voice
 * Twilio calls this URL for ALL inbound calls.
 * We use <Dial><Client> to ring the browser.
 */
router.post('/', validateTwilio, (req, res) => {
  const twiml = new VoiceResponse();
  const from = req.body.From || 'Unknown';
  const callSid = req.body.CallSid;
  const direction = req.body.Direction;

  console.log(`[Voice] Inbound call from ${from} — SID: ${callSid}`);

  // Notify all browser clients of incoming call
  broadcast({
    type: 'inbound_call',
    from,
    callSid,
    direction,
    timestamp: new Date().toISOString(),
  });

  // Ring the browser client — identity matches what /api/token returns
  const dial = twiml.dial({ timeout: 30, record: 'do-not-record' });
  dial.client('softphone-agent'); // matches identity in token

  res.type('text/xml');
  res.send(twiml.toString());
});

/**
 * POST /api/voice/outbound
 * TwiML App calls this when an outbound call is initiated from the browser.
 * The browser SDK passes `To` in the connection params.
 */
router.post('/outbound', (req, res) => {
  const twiml = new VoiceResponse();
  const to = req.body.To;

  if (!to) {
    twiml.say('No destination number provided.');
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  console.log(`[Voice] Outbound call to ${to}`);

  const dial = twiml.dial({
    callerId: process.env.TWILIO_PHONE_NUMBER,
    record: 'do-not-record',
  });
  dial.number(to);

  res.type('text/xml');
  res.send(twiml.toString());
});

/**
 * POST /api/voice/status
 * Twilio status callbacks — update clients about call state changes.
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
 * GET /api/voice/calls
 * Fetch recent call log from Twilio.
 */
router.get('/calls', async (req, res) => {
  try {
    const calls = await client.calls.list({ limit: 50 });
    res.json(calls.map(c => ({
      sid: c.sid,
      from: c.from,
      to: c.to,
      status: c.status,
      direction: c.direction,
      duration: c.duration,
      startTime: c.startTime,
      endTime: c.endTime,
    })));
  } catch (err) {
    console.error('[Voice] Error fetching calls:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
