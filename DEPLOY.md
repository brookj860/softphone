# Softphone — Railway Deployment Guide

## Deploy in 3 steps

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial softphone"
# Create a repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/softphone.git
git push -u origin main
```

### Step 2 — Deploy to Railway

1. Go to **https://railway.app** → New Project → Deploy from GitHub repo
2. Select your repo → Deploy Now
3. Railway will detect Node.js automatically and start the build
4. Once deployed, click your project → **Settings → Domains → Generate Domain**
5. Copy your domain (e.g. `myapp.up.railway.app`)

### Step 3 — Open your app URL

The first time you open your Railway URL, you'll see the **Setup Wizard**.

Fill in your credentials in the form — no code editing required.

---

## Railway environment variables (for persistence)

Railway's filesystem resets on redeploy. To make your config permanent:

1. In Railway → your project → **Variables**
2. Add each of these:

| Variable | Where to get it |
|----------|----------------|
| `PUBLIC_URL` | Your Railway domain e.g. `https://myapp.up.railway.app` |
| `TWILIO_ACCOUNT_SID` | console.twilio.com → Dashboard |
| `TWILIO_AUTH_TOKEN` | console.twilio.com → Dashboard |
| `TWILIO_PHONE_NUMBER` | Phone Numbers → Manage |
| `TWILIO_TWIML_APP_SID` | Voice → TwiML Apps → Create (set URL to `$PUBLIC_URL/webhook/twilio/voice`) |
| `TWILIO_API_KEY` | Account → API Keys → Create |
| `TWILIO_API_SECRET` | Shown once at API key creation |
| `WA_PHONE_NUMBER_ID` | developers.facebook.com → WhatsApp → API Setup |
| `WA_PERMANENT_TOKEN` | Business Settings → System Users → Generate Token |
| `WA_WEBHOOK_VERIFY_TOKEN` | Any string you choose |
| `NODE_ENV` | `production` |

---

## Webhook URLs to configure

After setup, paste these into Twilio and Meta dashboards:

- **Twilio Voice:** `https://YOUR_DOMAIN/webhook/twilio/voice`
- **Twilio SMS:** `https://YOUR_DOMAIN/webhook/twilio/sms`
- **WhatsApp:** `https://YOUR_DOMAIN/webhook/whatsapp`

---

## Install as mobile app (PWA)

Once your Railway URL is live:

- **iPhone/iPad:** Open in Safari → Share button → "Add to Home Screen"
- **Android:** Open in Chrome → menu (⋮) → "Add to Home Screen"

It will appear as a full-screen app with no browser chrome.

---

## Cost

- Railway free tier: **$5 credit/month** (enough for this app)
- Twilio: pay-as-you-go (~£0.01/SMS, ~£0.01/min calls)
- WhatsApp: free for inbound; template messages have small fees
