'use strict';

// Archive SMS messages via Resend (https://resend.com)
// Resend uses HTTPS — no SMTP ports, works on all cloud platforms.
// Required Railway variables:
//   RESEND_API_KEY   — from resend.com dashboard
//   ARCHIVE_TO       — email address to send archives to
//   ARCHIVE_FROM     — e.g. "Softphone <archive@yourdomain.com>"
//                      Without a domain, use: "Softphone <onboarding@resend.dev>" for testing

const RESEND_API = 'https://api.resend.com/emails';

function isConfigured() {
  return !!(process.env.RESEND_API_KEY && process.env.ARCHIVE_TO);
}

(function checkConfig() {
  if (!process.env.RESEND_API_KEY) {
    console.log('[Archive] Not configured — set RESEND_API_KEY and ARCHIVE_TO in Railway variables');
  } else if (!process.env.ARCHIVE_TO) {
    console.log('[Archive] Not configured — set ARCHIVE_TO in Railway variables');
  } else {
    console.log(`[Archive] Ready — archiving to ${process.env.ARCHIVE_TO} via Resend`);
  }
})();

async function archiveSMS(msg) {
  if (!isConfigured()) return;

  const ts        = msg.ts ? new Date(msg.ts) : new Date();
  const channel   = (msg.channel || 'sms').toUpperCase();
  const direction = msg.direction === 'in' ? 'INBOUND' : 'OUTBOUND';
  const arrow     = msg.direction === 'in' ? '←' : '→';
  const contact   = msg.direction === 'in' ? msg.from : msg.to;
  const subject   = `[${channel} ${direction}] ${arrow} ${contact}`;
  const from      = process.env.ARCHIVE_FROM || 'Softphone Archive <onboarding@resend.dev>';

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:20px;background:#f4f4f4;font-family:Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <div style="background:#f22f46;color:#fff;padding:14px 20px;font-size:15px;font-weight:bold">
      ${channel} ${direction} &nbsp;${arrow}&nbsp; ${escHtml(contact)}
    </div>
    <div style="padding:20px">
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px">
        <tr><td style="padding:5px 16px 5px 0;color:#999;white-space:nowrap">Direction</td><td style="font-weight:bold">${direction}</td></tr>
        <tr><td style="padding:5px 16px 5px 0;color:#999">From</td><td>${escHtml(msg.from)}</td></tr>
        <tr><td style="padding:5px 16px 5px 0;color:#999">To</td><td>${escHtml(msg.to)}</td></tr>
        <tr><td style="padding:5px 16px 5px 0;color:#999">Time</td><td>${ts.toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })}</td></tr>
        <tr><td style="padding:5px 16px 5px 0;color:#999">Channel</td><td>${channel}</td></tr>
        <tr><td style="padding:5px 16px 5px 0;color:#999">SID</td><td style="color:#aaa;font-size:11px;font-family:monospace">${msg.sid || 'n/a'}</td></tr>
      </table>
      <div style="background:#fafafa;border-left:4px solid #f22f46;padding:14px 16px;border-radius:0 6px 6px 0;font-size:15px;line-height:1.7;white-space:pre-wrap">${escHtml(msg.body)}</div>
      <p style="margin-top:20px;font-size:11px;color:#ccc;text-align:right">Archived by Softphone · ${new Date().toISOString()}</p>
    </div>
  </div>
</body></html>`;

  const text = [
    `${channel} ${direction} ${arrow} ${contact}`,
    '-'.repeat(40),
    `From   : ${msg.from}`,
    `To     : ${msg.to}`,
    `Time   : ${ts.toISOString()}`,
    `SID    : ${msg.sid || 'n/a'}`,
    '',
    msg.body,
  ].join('\n');

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [process.env.ARCHIVE_TO], subject, html, text }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error(`[Archive] Resend error ${res.status}:`, data?.message || JSON.stringify(data));
    } else {
      console.log(`[Archive] ✓ ${direction} ${channel} archived — id: ${data.id}`);
    }
  } catch (err) {
    console.error('[Archive] Failed:', err.message);
  }
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

module.exports = { archiveSMS, isConfigured };
