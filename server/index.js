'use strict';
require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cookie = require('cookie');
const db = require('./db');
const { initWebSocket } = require('./websocket');
const { router: authRouter, validSession } = require('./routes/auth');

const app = express();
const server = http.createServer(app);
app.set('trust proxy', 1);

const REQUIRED = [
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
  'TWILIO_TWIML_APP_SID', 'TWILIO_API_KEY', 'TWILIO_API_SECRET', 'PUBLIC_URL',
];

function isConfigured() { return REQUIRED.every(k => !!process.env[k]); }
function hasWhatsApp()  { return !!(process.env.WA_PHONE_NUMBER_ID && process.env.WA_PERMANENT_TOKEN && process.env.WA_WEBHOOK_VERIFY_TOKEN); }

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://unpkg.com https://sdk.twilio.com https://media.twiliocdn.com",
    "script-src-attr 'unsafe-inline'",
    "connect-src 'self' wss: ws: https://unpkg.com https://sdk.twilio.com https://media.twiliocdn.com https://eventgw.twilio.com https://graph.facebook.com",
    "media-src 'self' blob: https://media.twiliocdn.com",
    "worker-src 'self' blob:",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
  ].join('; '));
  next();
});

app.use(cors());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Simple cookie parser (no extra dependency)
app.use((req, res, next) => {
  req.cookies = req.headers.cookie ? cookie.parse(req.headers.cookie) : {};
  next();
});

// Auth routes (public)
app.use('/api/auth', authRouter);

// Health (public)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', configured: isConfigured(), whatsapp: hasWhatsApp(), db: db.isAvailable(), uptime: Math.floor(process.uptime()) });
});

// Features (public - needed by setup.js)
app.get('/api/features', (req, res) => {
  res.json({ configured: isConfigured(), whatsapp: hasWhatsApp(), sms: isConfigured(), voice: isConfigured(), db: db.isAvailable() });
});

// Twilio webhooks (public - Twilio calls these, no cookies)
// These must be registered before the auth middleware
const registerWebhooks = () => {
  if (isConfigured()) {
    const voiceRouter = require('./routes/voice');
    const smsRouter   = require('./routes/sms');
    app.use('/webhook/twilio/voice', voiceRouter);
    app.use('/webhook/twilio/sms',   smsRouter);
    if (hasWhatsApp()) {
      const waRouter = require('./routes/whatsapp');
      app.use('/webhook/whatsapp', waRouter);
    }
    console.log('[Server] Webhooks registered');
  }
};
registerWebhooks();

// Rate limiting on API
const limiter = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false });
app.use('/api/', limiter);

// ── AUTH GATE: all /api/* routes below require login ────────
app.use('/api/', (req, res, next) => {
  if (!validSession(req)) {
    return res.status(401).json({ error: 'Not authenticated', redirect: '/login' });
  }
  next();
});

// Protected API routes
let routesLoaded = false;
function loadRoutes() {
  if (routesLoaded) return;
  routesLoaded = true;
  const voiceRouter         = require('./routes/voice');
  const smsRouter           = require('./routes/sms');
  const contactsRouter      = require('./routes/contacts');
  const tokenRouter         = require('./routes/token');
  const conversationsRouter = require('./routes/conversations');
  app.use('/api/token',         tokenRouter);
  app.use('/api/voice',         voiceRouter);
  app.use('/api/sms',           smsRouter);
  app.use('/api/contacts',      contactsRouter);
  app.use('/api/conversations', conversationsRouter);
  if (hasWhatsApp()) {
    const waRouter = require('./routes/whatsapp');
    app.use('/api/whatsapp', waRouter);
  }
  console.log('[Server] API routes loaded ✓');
}
if (isConfigured()) loadRoutes();

// Serve login page for /login route
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

// Static files
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders: (res, fp) => {
    if (fp.endsWith('sw.js')) { res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Service-Worker-Allowed', '/'); }
  }
}));

// All other routes -> index.html (SPA)
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

app.use((err, req, res, _next) => { console.error('[Error]', err.message); res.status(500).json({ error: err.message }); });

const wss = initWebSocket(server);
app.set('wss', wss);

// Also gate WebSocket connections
const originalUpgrade = server.listeners('upgrade')[0];
if (originalUpgrade) server.removeListener('upgrade', originalUpgrade);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n🚀 Softphone running on port ${PORT}`);
  console.log(`   Twilio:   ${isConfigured() ? '✓' : '✗ NOT CONFIGURED'}`);
  console.log(`   WhatsApp: ${hasWhatsApp() ? '✓' : 'optional, not set'}`);
  console.log(`   Login:    ${process.env.APP_PASSWORD ? '✓ Password protected' : '⚠️  No APP_PASSWORD set — anyone can log in!'}`);
  const dbReady = await db.init();
  console.log(`   Database: ${dbReady ? '✓ Postgres' : '✗ Not connected (set DATABASE_URL)'}`);
});

module.exports = { app, server };
