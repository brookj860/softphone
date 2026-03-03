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
const configRouter = require('./routes/config');

const app = express();
const server = http.createServer(app);

const REQUIRED = [
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
  'TWILIO_TWIML_APP_SID', 'TWILIO_API_KEY', 'TWILIO_API_SECRET',
  'WA_PHONE_NUMBER_ID', 'WA_PERMANENT_TOKEN', 'WA_WEBHOOK_VERIFY_TOKEN', 'PUBLIC_URL',
];

function isConfigured() {
  return REQUIRED.every(k => !!process.env[k]);
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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', configured: isConfigured(), uptime: Math.floor(process.uptime()) });
});

app.use('/api/config', configRouter);

const limiter = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false });
app.use('/api/', limiter);

app.use((req, res, next) => {
  if (!isConfigured() && !req.path.startsWith('/api/config') && req.path.startsWith('/api/')) {
    return res.status(503).json({ error: 'Not configured', message: 'Complete setup at your app URL' });
  }
  next();
});

let routesLoaded = false;
function loadRoutes() {
  if (routesLoaded) return;
  routesLoaded = true;
  const voiceRouter    = require('./routes/voice');
  const smsRouter      = require('./routes/sms');
  const whatsappRouter = require('./routes/whatsapp');
  const contactsRouter = require('./routes/contacts');
  const tokenRouter    = require('./routes/token');
  app.use('/api/token',    tokenRouter);
  app.use('/api/voice',    voiceRouter);
  app.use('/api/sms',      smsRouter);
  app.use('/api/whatsapp', whatsappRouter);
  app.use('/api/contacts', contactsRouter);
  app.use('/webhook/twilio/voice', voiceRouter);
  app.use('/webhook/twilio/sms',   smsRouter);
  app.use('/webhook/whatsapp',     whatsappRouter);
  console.log('[Server] Feature routes loaded');
}

if (isConfigured()) loadRoutes();

app.use('/api/', (req, res, next) => {
  if (isConfigured() && !routesLoaded) loadRoutes();
  next();
});

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
  if (isConfigured()) {
    console.log(`\n📡 Webhooks:\n   Twilio Voice: ${process.env.PUBLIC_URL}/webhook/twilio/voice\n   Twilio SMS:   ${process.env.PUBLIC_URL}/webhook/twilio/sms\n   WhatsApp:     ${process.env.PUBLIC_URL}/webhook/whatsapp`);
  } else {
    console.log('\n⚠️  Open the app URL to complete setup');
  }
});

module.exports = { app, server };
