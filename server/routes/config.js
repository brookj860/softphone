'use strict';
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ENV_PATH = path.join(process.cwd(), '.env');

// Fields exposed to the setup wizard (never expose secrets in GET beyond masking)
const FIELDS = [
  { key: 'PUBLIC_URL',               label: 'Your Public URL',              hint: 'e.g. https://myapp.up.railway.app',  required: true,  secret: false },
  { key: 'TWILIO_ACCOUNT_SID',       label: 'Twilio Account SID',           hint: 'Starts with AC…',                    required: true,  secret: false },
  { key: 'TWILIO_AUTH_TOKEN',        label: 'Twilio Auth Token',            hint: 'From Twilio console',                required: true,  secret: true  },
  { key: 'TWILIO_PHONE_NUMBER',      label: 'Twilio Phone Number',          hint: 'E.164 format, e.g. +441234567890',   required: true,  secret: false },
  { key: 'TWILIO_TWIML_APP_SID',    label: 'Twilio TwiML App SID',        hint: 'Starts with AP…',                    required: true,  secret: false },
  { key: 'TWILIO_API_KEY',          label: 'Twilio API Key SID',           hint: 'Starts with SK…',                    required: true,  secret: false },
  { key: 'TWILIO_API_SECRET',       label: 'Twilio API Secret',            hint: 'From API key creation',              required: true,  secret: true  },
  { key: 'WA_PHONE_NUMBER_ID',      label: 'WhatsApp Phone Number ID',     hint: '15–16 digit number from Meta',       required: true,  secret: false },
  { key: 'WA_PERMANENT_TOKEN',      label: 'WhatsApp Permanent Token',     hint: 'Starts with EAA…',                  required: true,  secret: true  },
  { key: 'WA_BUSINESS_ACCOUNT_ID', label: 'WhatsApp Business Account ID', hint: '15–16 digit number from Meta',       required: false, secret: false },
  { key: 'WA_WEBHOOK_VERIFY_TOKEN',label: 'WhatsApp Webhook Verify Token', hint: 'Any string you choose',             required: true,  secret: false },
];

// Simple setup PIN protection - set SETUP_PIN env var (default: first run only)
function checkPin(req, res, next) {
  const pin = process.env.SETUP_PIN;
  if (!pin) return next(); // No PIN set = allow (first run)
  const provided = req.headers['x-setup-pin'] || req.body?.pin;
  if (provided !== pin) return res.status(401).json({ error: 'Invalid PIN' });
  next();
}

// GET /api/config - return current config (masked secrets) + setup status
router.get('/', (req, res) => {
  const configured = {};
  const missing = [];

  FIELDS.forEach(f => {
    const val = process.env[f.key] || '';
    if (!val && f.required) missing.push(f.key);
    configured[f.key] = f.secret && val ? '••••••••' + val.slice(-4) : val;
  });

  res.json({
    fields: FIELDS,
    values: configured,
    missing,
    isConfigured: missing.length === 0,
    webhooks: process.env.PUBLIC_URL ? {
      twilioVoice: `${process.env.PUBLIC_URL}/webhook/twilio/voice`,
      twilioSms:   `${process.env.PUBLIC_URL}/webhook/twilio/sms`,
      whatsapp:    `${process.env.PUBLIC_URL}/webhook/whatsapp`,
    } : null,
  });
});

// POST /api/config - save config (writes to .env file + updates process.env)
router.post('/', checkPin, (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'Invalid body' });
  }

  // Read existing .env
  let existing = {};
  try {
    const raw = fs.readFileSync(ENV_PATH, 'utf8');
    raw.split('\n').forEach(line => {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) existing[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (_) { /* first run, no .env yet */ }

  // Merge updates (skip masked values - user didn't change them)
  FIELDS.forEach(f => {
    const val = updates[f.key];
    if (val && !val.startsWith('••••')) {
      existing[f.key] = val;
      process.env[f.key] = val; // Update live process
    }
  });

  // Auto-generate session secret if not set
  if (!existing.SESSION_SECRET) {
    existing.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
    process.env.SESSION_SECRET = existing.SESSION_SECRET;
  }

  // Write .env
  const content = Object.entries(existing)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n';

  try {
    fs.writeFileSync(ENV_PATH, content, 'utf8');
  } catch (err) {
    // On Railway, filesystem is ephemeral — env vars must be set in dashboard
    // We still update process.env so it works for this session
    console.warn('[Config] Could not write .env (ephemeral filesystem):', err.message);
    return res.json({
      ok: true,
      ephemeral: true,
      message: 'Settings applied for this session. On Railway, set these as environment variables in your project dashboard for persistence.',
    });
  }

  res.json({ ok: true, ephemeral: false });
});

// GET /api/config/status - quick health check for the frontend
router.get('/status', (req, res) => {
  const missing = FIELDS.filter(f => f.required && !process.env[f.key]).map(f => f.key);
  res.json({ isConfigured: missing.length === 0, missing });
});

module.exports = router;
