'use strict';
require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { initWebSocket } = require('./websocket');

const app = express();
const server = http.createServer(app);

// Twilio is required, WhatsApp is optional
const REQUIRED = [
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
  'TWILIO_TWIML_APP_SID', 'TWILIO_API_KEY', 'TWILIO_API_SECRET',
  'PUBLIC_URL',
];

function isConfigured() {
  return REQUIRED.every(k => !!process.env[k]);
}

function hasWhatsApp() {
  return !!(process.env.WA_PHONE_NUMBER_ID && process.env.WA_PERMANENT_TOKEN && process.env.WA_WEBHOOK_VERIFY_TOKEN);
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://sdk.twilio.com", "https://media.twiliocdn.com"],
      connectSrc: ["'self'", "wss:", "ws:", "https://sdk.twilio.com", "https://media.twiliocdn.com", "https://eventgw.twilio.com", "https://graph.facebook.com"],
      mediaSrc: ["'self'", "blob:", "https://media.twiliocdn.com"],
      workerSrc: ["'self'", "blob:"],
      imgSrc: ["'self'", "data:", "blob:"],
    }
  }
}));

app.use(cors());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Health check - Railway uses this
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    configured: isConfigured(),
    whatsapp: hasWhatsApp(),
    uptime: Math.floor(process.uptime()),
  });
});

// Tell the frontend what features are enabled
app.get('/api/features', (req, res) => {
  res.json({
    configured: isConfigured(),
    whatsapp: hasWhatsApp(),
    sms: isConfigured(),
    voice: isConfigured(),
  });
});

const limiter = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false });
app.use('/api/', limiter);

let routesLoaded = false;
function loadRoutes() {
  if (routesLoaded) return;
  routesLoaded = true;

  const voiceRouter    = require('./routes/voice');
  const smsRouter      = require('./routes/sms');
  const contactsRouter = require('./routes/contacts');
  const tokenRouter    = require('./routes/token');

  app.use('/api/token',    tokenRouter);
  app.use('/api/voice',    voiceRouter);
  app.use('/api/sms',      smsRouter);
  app.use('/api/contacts', contactsRouter);
  app.use('/webhook/twilio/voice', voiceRouter);
  app.use('/webhook/twilio/sms',   smsRouter);

  // Only load WhatsApp routes if credentials are present
  if (hasWhatsApp()) {
    const whatsappRouter = require('./routes/whatsapp');
    app.use('/api/whatsapp',         whatsappRouter);
    app.use('/webhook/whatsapp',     whatsappRouter);
    console.log('[Server] WhatsApp enabled ✓');
  } else {
    console.log('[Server] WhatsApp not configured — skipping');
    // Return friendly error if someone hits the WA endpoint anyway
    app.use('/api/whatsapp', (req, res) => {
      res.status(503).json({ error: 'WhatsApp not configured. Add WA_PHONE_NUMBER_ID, WA_PERMANENT_TOKEN and WA_WEBHOOK_VERIFY_TOKEN to enable it.' });
    });
  }

  console.log('[Server] Routes loaded ✓');
}

if (isConfigured()) {
  loadRoutes();
} else {
  console.log('[Server] ⚠️  Missing required Twilio env vars — check Railway Variables');
  console.log('[Server] Required:', REQUIRED.filter(k => !process.env[k]));
}

app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders: (res, fp) => {
    if (fp.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Service-Worker-Allowed', '/');
    }
  }
}));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

app.use((err, req, res, _next) => {
  console.error('[Error]', err.message);
  res.status(err.status || 500).json({ error: err.message });
});

const wss = initWebSocket(server);
app.set('wss', wss);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Softphone running on port ${PORT}`);
  console.log(`   Twilio: ${isConfigured() ? '✓' : '✗ NOT CONFIGURED'}`);
  console.log(`   WhatsApp: ${hasWhatsApp() ? '✓' : 'not configured (optional)'}`);
  if (isConfigured()) {
    console.log(`\n📡 Twilio webhook URLs:`);
    console.log(`   Voice: ${process.env.PUBLIC_URL}/webhook/twilio/voice`);
    console.log(`   SMS:   ${process.env.PUBLIC_URL}/webhook/twilio/sms`);
    if (hasWhatsApp()) {
      console.log(`   WhatsApp: ${process.env.PUBLIC_URL}/webhook/whatsapp`);
    }
  }
});

module.exports = { app, server };
