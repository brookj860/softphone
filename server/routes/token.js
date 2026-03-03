'use strict';
const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const { v4: uuidv4 } = require('uuid');

const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

/**
 * GET /api/token
 * Returns a Twilio Access Token for the browser Voice SDK.
 * Call this on page load and refresh before expiry (default 1hr).
 */
router.get('/', (req, res) => {
  try {
    const identity = req.query.identity || `agent-${uuidv4().slice(0, 8)}`;

    const token = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY,
      process.env.TWILIO_API_SECRET,
      { identity, ttl: 3600 }
    );

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID,
      incomingAllow: true,
    });

    token.addGrant(voiceGrant);

    res.json({
      token: token.toJwt(),
      identity,
      expiresIn: 3600,
    });
  } catch (err) {
    console.error('[Token] Error generating token:', err);
    res.status(500).json({ error: 'Could not generate access token' });
  }
});

module.exports = router;
