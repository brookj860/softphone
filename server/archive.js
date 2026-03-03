'use strict';
const nodemailer = require('nodemailer');

let transporter = null;

function isConfigured() {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.ARCHIVE_TO
  );
}

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

/**
 * Archive an SMS message via email.
 *
 * @param {object} msg
 * @param {string} msg.direction  'in' | 'out'
 * @param {string} msg.from
 * @param {string} msg.to
 * @param {string} msg.body
 * @param {string} msg.sid        Twilio message SID
 * @param {string} [msg.channel]  'sms' | 'whatsapp'
 * @param {Date}   [msg.ts]
 */
async function archiveSMS(msg) {
  if (!isConfigured()) return; // silently skip if not configured

  const ts        = msg.ts ? new Date(msg.ts) : new Date();
  const channel   = (msg.channel || 'sms').toUpperCase();
  const direction = msg.direction === 'in' ? 'INBOUND' : 'OUTBOUND';
  const arrow     = msg.direction === 'in' ? '←' : '→';

  const subject = `[${channel} ${direction}] ${arrow} ${msg.direction === 'in' ? msg.from : msg.to}`;

  const text = [
    `${channel} Message Archive`,
    '─'.repeat(40),
    `Direction : ${direction}`,
    `From      : ${msg.from}`,
    `To        : ${msg.to}`,
    `Time      : ${ts.toISOString()}`,
    `SID       : ${msg.sid || 'n/a'}`,
    '',
    'Message:',
    msg.body,
    '',
    '─'.repeat(40),
    `Archived by Softphone at ${new Date().toISOString()}`,
  ].join('\n');

  const html = `
    <div style="font-family:monospace;max-width:600px;margin:0 auto;color:#1a1a1a">
      <div style="background:#f22f46;color:#fff;padding:12px 20px;border-radius:8px 8px 0 0">
        <strong>${channel} ${direction}</strong> &nbsp;${arrow}&nbsp; ${msg.direction === 'in' ? msg.from : msg.to}
      </div>
      <div style="border:1px solid #e0e0e0;border-top:none;padding:20px;border-radius:0 0 8px 8px">
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">
          <tr><td style="color:#888;padding:4px 12px 4px 0;white-space:nowrap">Direction</td><td><strong>${direction}</strong></td></tr>
          <tr><td style="color:#888;padding:4px 12px 4px 0">From</td><td>${msg.from}</td></tr>
          <tr><td style="color:#888;padding:4px 12px 4px 0">To</td><td>${msg.to}</td></tr>
          <tr><td style="color:#888;padding:4px 12px 4px 0">Time</td><td>${ts.toLocaleString()}</td></tr>
          <tr><td style="color:#888;padding:4px 12px 4px 0">SID</td><td style="font-size:11px;color:#aaa">${msg.sid || 'n/a'}</td></tr>
        </table>
        <div style="background:#f9f9f9;border-left:3px solid #f22f46;padding:12px 16px;border-radius:0 6px 6px 0;font-size:15px;line-height:1.6;white-space:pre-wrap">${escapeHtml(msg.body)}</div>
        <p style="font-size:11px;color:#bbb;margin-top:16px">Archived by Softphone · ${new Date().toISOString()}</p>
      </div>
    </div>
  `;

  try {
    await getTransporter().sendMail({
      from:    process.env.SMTP_FROM || process.env.SMTP_USER,
      to:      process.env.ARCHIVE_TO,
      subject,
      text,
      html,
    });
    console.log(`[Archive] Emailed ${direction} ${channel} from ${msg.from}`);
  } catch (err) {
    // Never throw — archive failure must not break message flow
    console.error('[Archive] Email failed:', err.message);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { archiveSMS, isConfigured };
