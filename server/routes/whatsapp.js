'use strict';
const express = require('express');
const router = express.Router();
const { broadcast } = require('../websocket');

const WA_API_VERSION = 'v19.0';
const WA_BASE = `https://graph.facebook.com/${WA_API_VERSION}`;

function waHeaders() {
  return {
    'Authorization': `Bearer ${process.env.WA_PERMANENT_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

/**
 * GET /webhook/whatsapp
 * Meta webhook verification — called once when you set up the webhook.
 */
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WA_WEBHOOK_VERIFY_TOKEN) {
    console.log('[WhatsApp] Webhook verified ✓');
    return res.status(200).send(challenge);
  }

  console.warn('[WhatsApp] Webhook verification failed');
  res.sendStatus(403);
});

/**
 * POST /webhook/whatsapp
 * Meta calls this for every inbound WhatsApp message/status update.
 */
router.post('/', express.json(), async (req, res) => {
  // Always acknowledge immediately
  res.sendStatus(200);

  const body = req.body;
  if (body.object !== 'whatsapp_business_account') return;

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;

      // Inbound messages
      for (const msg of value.messages || []) {
        const contact = (value.contacts || []).find(c => c.wa_id === msg.from);
        const profileName = contact?.profile?.name || msg.from;

        let messageBody = '';
        let mediaType = null;
        let mediaId = null;

        if (msg.type === 'text') {
          messageBody = msg.text?.body || '';
        } else if (['image', 'audio', 'video', 'document', 'sticker'].includes(msg.type)) {
          mediaType = msg.type;
          mediaId = msg[msg.type]?.id;
          messageBody = msg[msg.type]?.caption || `[${msg.type}]`;
        } else if (msg.type === 'location') {
          messageBody = `📍 Location: ${msg.location?.latitude}, ${msg.location?.longitude}`;
        } else if (msg.type === 'reaction') {
          messageBody = `${msg.reaction?.emoji} reaction`;
        } else {
          messageBody = `[${msg.type} message]`;
        }

        console.log(`[WhatsApp] Inbound from ${profileName} (${msg.from}): "${messageBody.substring(0,80)}"`);

        // Mark as read
        markRead(msg.id).catch(() => {});

        broadcast({
          type: 'inbound_whatsapp',
          waId: msg.id,
          from: msg.from,
          profileName,
          body: messageBody,
          msgType: msg.type,
          mediaType,
          mediaId,
          channel: 'whatsapp',
          timestamp: new Date(parseInt(msg.timestamp) * 1000).toISOString(),
        });
      }

      // Status updates (sent / delivered / read)
      for (const status of value.statuses || []) {
        broadcast({
          type: 'whatsapp_status',
          waId: status.id,
          status: status.status,
          to: status.recipient_id,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }
});

/**
 * POST /api/whatsapp/send
 * Send an outbound WhatsApp text message.
 * Body: { to, body }
 */
router.post('/send', async (req, res) => {
  const { to, body } = req.body;

  if (!to || !body) {
    return res.status(400).json({ error: 'Missing required fields: to, body' });
  }

  try {
    const response = await fetch(`${WA_BASE}/${process.env.WA_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: waHeaders(),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[WhatsApp] Send error:', data);
      return res.status(response.status).json({ error: data.error?.message || 'WhatsApp API error', details: data });
    }

    const waId = data.messages?.[0]?.id;
    console.log(`[WhatsApp] Sent to ${to} — ID: ${waId}`);

    broadcast({
      type: 'outbound_whatsapp',
      waId,
      to,
      body,
      status: 'sent',
      channel: 'whatsapp',
      timestamp: new Date().toISOString(),
    });

    res.json({ waId, status: 'sent' });
  } catch (err) {
    console.error('[WhatsApp] Send error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/whatsapp/send-template
 * Send a WhatsApp template message (required for first contact / 24hr window expired).
 * Body: { to, templateName, languageCode, components }
 */
router.post('/send-template', async (req, res) => {
  const { to, templateName, languageCode = 'en_US', components = [] } = req.body;

  if (!to || !templateName) {
    return res.status(400).json({ error: 'Missing required fields: to, templateName' });
  }

  try {
    const response = await fetch(`${WA_BASE}/${process.env.WA_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: waHeaders(),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message, details: data });
    }

    res.json({ waId: data.messages?.[0]?.id, status: 'sent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/whatsapp/media/:mediaId
 * Proxy to download WhatsApp media (images, audio etc.) without exposing your token.
 */
router.get('/media/:mediaId', async (req, res) => {
  try {
    // Step 1: get media URL
    const urlRes = await fetch(`${WA_BASE}/${req.params.mediaId}`, {
      headers: waHeaders(),
    });
    const { url, mime_type } = await urlRes.json();

    // Step 2: stream the media
    const mediaRes = await fetch(url, { headers: waHeaders() });
    res.setHeader('Content-Type', mime_type);
    mediaRes.body.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helper ─────────────────────────────────────────────────
async function markRead(messageId) {
  await fetch(`${WA_BASE}/${process.env.WA_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: waHeaders(),
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    }),
  });
}

module.exports = router;
