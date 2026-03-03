# 📞 Unified Softphone

A production-ready softphone that unifies **Twilio Voice**, **Twilio SMS**, and **Meta WhatsApp Business** into one browser-based app.

---

## Features

- 📞 **Browser-based VoIP calls** (WebRTC via Twilio Client JS) — no plugin needed
- 💬 **Send & receive SMS** via Twilio
- 🟢 **Send & receive WhatsApp messages** via Meta Cloud API
- 🔔 **Real-time delivery** of inbound messages via WebSocket
- 📱 **Unified conversation view** — all channels in one inbox
- 📖 **Contacts** — save names to match against incoming numbers
- 🔒 **Twilio signature validation** on webhooks
- 🚀 Production-ready Express server with rate limiting, helmet, logging

---

## Prerequisites

- Node.js 18+
- A **Twilio account** (free trial works for testing)
- A **Meta Developer account** with WhatsApp Business API access

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create your config file
cp .env.example .env

# 3. Fill in your credentials (see below)
nano .env

# 4. Start the server
npm start

# For development with auto-restart:
npm run dev
```

Open http://localhost:3000

---

## Configuration

Edit `.env` — every value is explained inline. Here's a summary:

### Twilio Setup

1. **Sign up** at https://console.twilio.com
2. Note your **Account SID** and **Auth Token** from the dashboard
3. Buy a **phone number** with Voice + SMS capabilities
4. Create a **TwiML App**:
   - Go to Voice → TwiML Apps → Create new TwiML App
   - Set the **Voice Request URL** to: `https://YOUR_DOMAIN/webhook/twilio/voice`
   - Copy the **TwiML App SID** (starts with `AP`)
5. Create an **API Key**:
   - Go to Account → API Keys & Tokens → Create API Key
   - Copy the **SID** (starts with `SK`) and **Secret**
6. Set your Twilio phone number webhooks:
   - Go to Phone Numbers → Manage → Your number
   - **Voice & Fax → A call comes in**: `https://YOUR_DOMAIN/webhook/twilio/voice` (HTTP POST)
   - **Messaging → A message comes in**: `https://YOUR_DOMAIN/webhook/twilio/sms` (HTTP POST)

### Meta WhatsApp Setup

1. Go to https://developers.facebook.com → Create App → Business
2. Add **WhatsApp** product to your app
3. In **API Setup**, note your:
   - **Phone Number ID** (15-16 digit number — NOT the phone number itself)
   - **WhatsApp Business Account ID**
4. Generate a **Permanent Token**:
   - Go to Business Settings → System Users → Add System User (Admin)
   - Generate Token → Select your app → Grant: `whatsapp_business_messaging`, `whatsapp_business_management`
5. Set up **Webhooks**:
   - In your app → WhatsApp → Configuration → Webhooks
   - Callback URL: `https://YOUR_DOMAIN/webhook/whatsapp`
   - Verify Token: (the value you set for `WA_WEBHOOK_VERIFY_TOKEN` in `.env`)
   - Subscribe to: `messages`

---

## Webhook URLs (configure in Twilio + Meta dashboards)

| Service | URL |
|---------|-----|
| Twilio Inbound Voice | `https://YOUR_DOMAIN/webhook/twilio/voice` |
| Twilio Inbound SMS | `https://YOUR_DOMAIN/webhook/twilio/sms` |
| WhatsApp Webhook | `https://YOUR_DOMAIN/webhook/whatsapp` |

---

## Local Development with ngrok

Twilio and Meta need to reach your server from the internet. Use ngrok for local dev:

```bash
# Install ngrok: https://ngrok.com
ngrok http 3000
```

Copy the `https://xxxx.ngrok.io` URL and set it as `PUBLIC_URL` in your `.env`.
Update your webhook URLs in Twilio and Meta dashboards each time ngrok restarts.
(Paid ngrok plans give you a stable domain.)

---

## Deployment

### Option A: Railway / Render / Fly.io (easiest)

```bash
# Railway
npm install -g @railway/cli
railway login && railway init && railway up
# Set env vars in the Railway dashboard
```

### Option B: VPS (Ubuntu)

```bash
# Install Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Clone and install
git clone your-repo && cd unified-softphone
npm install --production

# Install PM2
npm install -g pm2
pm2 start server/index.js --name softphone
pm2 save && pm2 startup

# Nginx reverse proxy (example)
# server {
#   listen 443 ssl;
#   server_name softphone.yourdomain.com;
#   location / { proxy_pass http://localhost:3000; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }
# }
```

### Option C: Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "server/index.js"]
```

```bash
docker build -t softphone .
docker run -p 3000:3000 --env-file .env softphone
```

---

## Adding a Database for Contacts & Message History

The contacts store is currently in-memory (resets on restart). To persist:

**With SQLite (minimal):**
```bash
npm install better-sqlite3
```
Replace the array in `server/routes/contacts.js` with SQLite queries.

**With PostgreSQL:**
```bash
npm install pg
```

**With MongoDB:**
```bash
npm install mongoose
```

Message history currently comes live from Twilio's API (last 50). For full history, add a messages table/collection and write to it in the webhook handlers.

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/token` | Get Twilio access token for browser |
| POST | `/api/sms/send` | Send SMS `{to, body}` |
| GET | `/api/sms/history` | Fetch SMS history |
| POST | `/api/whatsapp/send` | Send WhatsApp message `{to, body}` |
| POST | `/api/whatsapp/send-template` | Send WA template message |
| GET | `/api/whatsapp/media/:id` | Proxy WA media download |
| POST | `/api/voice/outbound` | TwiML for outbound calls |
| POST | `/api/voice/status` | Twilio call status callbacks |
| GET | `/api/voice/calls` | Recent call log |
| GET/POST/PUT/DELETE | `/api/contacts` | Contact management |

---

## WebSocket Events

The server broadcasts these events to all connected browser clients:

| Event type | Payload |
|------------|---------|
| `inbound_sms` | `{sid, from, to, body, timestamp}` |
| `inbound_whatsapp` | `{waId, from, profileName, body, timestamp}` |
| `inbound_call` | `{from, callSid, timestamp}` |
| `call_status` | `{callSid, status, duration, to, from}` |
| `outbound_sms` | `{sid, from, to, body, status, timestamp}` |
| `outbound_whatsapp` | `{waId, to, body, status, timestamp}` |
| `whatsapp_status` | `{waId, status, to}` |

---

## WhatsApp Limitations

- You can only send **free-form messages** within 24 hours of the last user message
- Outside that window, you must send an approved **template message** (`/api/whatsapp/send-template`)
- The phone number must be registered with Meta WhatsApp Business API (not personal WhatsApp)
