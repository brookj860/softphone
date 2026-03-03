'use strict';
const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const { broadcast } = require('../websocket');
const { archiveCall } = require('../archive');

const VoiceResponse = twilio.twiml.VoiceResponse;
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

/**
 * POST /webhook/twilio/voice
 * Inbound call — rings browser, records the call.
 */
router.post('/', (req, res) => {
  const twiml = new VoiceResponse();
  const from = req.body.From || 'Unknown';
  const callSid = req.body.CallSid;

  console.log(`[Voice] Inbound call from ${from} — SID: ${callSid}`);

  broadcast({ type: 'inbound_call', from, callSid, timestamp: new Date().toISOString() });

  // Record the call; Twilio will POST to /api/voice/recording when ready
  twiml.record({
    recordingStatusCallback: `${process.env.PUBLIC_URL}/api/voice/recording`,
    recordingStatusCallbackMethod: 'POST',
    recordingStatusCallbackEvent: 'completed',
  });

  const dial = twiml.dial({ timeout: 30 });
  dial.client('softphone-agent');

  res.type('text/xml');
  res.send(twiml.toString());
});

/**
 * POST /api/voice/outbound
 * Outbound call from browser SDK — records the call.
 */
router.post('/outbound', (req, res) => {
  const twiml = new VoiceResponse();
  const to = req.body.To || req.body['params[To]'] || req.body.to;

  console.log(`[Voice] Outbound request body:`, JSON.stringify(req.body));

  if (!to) {
    console.error('[Voice] No To number in outbound request');
    twiml.say('Sorry, no destination number was provided.');
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  console.log(`[Voice] Outbound call to ${to}`);

  const dial = twiml.dial({
    callerId: process.env.TWILIO_PHONE_NUMBER,
    record: 'record-from-ringing',
    recordingStatusCallback: `${process.env.PUBLIC_URL}/api/voice/recording`,
    recordingStatusCallbackMethod: 'POST',
  });
  dial.number(to);

  res.type('text/xml');
  res.send(twiml.toString());
});

/**
 * POST /api/voice/status
 * Call status callback.
 */
router.post('/status', (req, res) => {
  const { CallSid, CallStatus, Duration, To, From } = req.body;
  console.log(`[Voice] Call ${CallSid} → ${CallStatus} (${Duration || 0}s)`);
  broadcast({
    type: 'call_status',
    callSid: CallSid,
    status: CallStatus,
    duration: Duration ? parseInt(Duration) : null,
    to: To, from: From,
    timestamp: new Date().toISOString(),
  });
  res.sendStatus(200);
});

/**
 * POST /api/voice/recording
 * Twilio calls this when a recording is ready.
 * Downloads the MP3 and emails it as an attachment.
 */
router.post('/recording', async (req, res) => {
  // Acknowledge immediately so Twilio doesn't retry
  res.sendStatus(200);

  const {
    RecordingSid,
    RecordingUrl,
    RecordingDuration,
    CallSid,
    RecordingStatus,
    To,
    From,
  } = req.body;

  console.log(`[Voice] Recording ${RecordingSid} — status: ${RecordingStatus}, duration: ${RecordingDuration}s`);

  if (RecordingStatus !== 'completed') return;
  if (!RecordingUrl) return;

  // Fire archive — don't await, never block
  archiveCall({
    callSid:   CallSid,
    recordingSid: RecordingSid,
    recordingUrl: RecordingUrl,
    duration:  RecordingDuration ? parseInt(RecordingDuration) : 0,
    from:      From || 'Unknown',
    to:        To   || 'Unknown',
    ts:        new Date(),
  }).catch(err => console.error('[Voice] Archive failed:', err.message));
});

/**
 * GET /api/voice/calls
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
