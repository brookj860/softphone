/* ============================================================
   SETUP WIZARD
   Handles first-run configuration and settings screen.
   ============================================================ */
'use strict';

// Fields split by page
const SETUP_PAGES = {
  1: [
    { key: 'PUBLIC_URL',            label: 'Your App URL',          hint: 'e.g. https://myapp.up.railway.app — no trailing slash', type: 'url',      required: true  },
    { key: 'TWILIO_ACCOUNT_SID',    label: 'Twilio Account SID',    hint: 'Starts with AC…',                                       type: 'text',     required: true  },
    { key: 'TWILIO_AUTH_TOKEN',     label: 'Twilio Auth Token',     hint: 'From Twilio console dashboard',                         type: 'password', required: true  },
    { key: 'TWILIO_PHONE_NUMBER',   label: 'Twilio Phone Number',   hint: 'E.164 format e.g. +441234567890',                       type: 'tel',      required: true  },
    { key: 'TWILIO_TWIML_APP_SID', label: 'TwiML App SID',        hint: 'Starts with AP… (create in Voice → TwiML Apps)',         type: 'text',     required: true  },
    { key: 'TWILIO_API_KEY',       label: 'Twilio API Key SID',    hint: 'Starts with SK…',                                       type: 'text',     required: true  },
    { key: 'TWILIO_API_SECRET',    label: 'Twilio API Secret',     hint: 'Shown once when you create the API key',                type: 'password', required: true  },
  ],
  2: [
    { key: 'WA_PHONE_NUMBER_ID',       label: 'WhatsApp Phone Number ID',      hint: '15-16 digit ID from Meta API Setup page (not the phone number)', type: 'text',     required: true  },
    { key: 'WA_PERMANENT_TOKEN',       label: 'WhatsApp Permanent Token',      hint: 'Starts with EAA… from Business Settings → System Users',         type: 'password', required: true  },
    { key: 'WA_BUSINESS_ACCOUNT_ID',  label: 'WhatsApp Business Account ID',  hint: '15-16 digit ID — optional but recommended',                       type: 'text',     required: false },
    { key: 'WA_WEBHOOK_VERIFY_TOKEN', label: 'Webhook Verify Token',           hint: 'Make up any string — you\'ll paste this same value in Meta too', type: 'text',     required: true  },
  ],
};

let configValues = {};
let isEphemeral = false;

// ── Boot: check if configured ──────────────────────────────
async function checkSetupNeeded() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    configValues = data.values || {};

    if (data.isConfigured && location.hash !== '#setup') {
      showApp();
    } else {
      showSetup(data);
    }
  } catch (e) {
    // Server not ready yet — retry
    setTimeout(checkSetupNeeded, 1500);
  }
}

function showSetup(data) {
  document.getElementById('setupOverlay').classList.remove('hidden');
  document.getElementById('appRoot').classList.add('hidden');
  renderSetupFields(1, data?.values || {});
  renderSetupFields(2, data?.values || {});
}

function showApp() {
  document.getElementById('setupOverlay').classList.add('hidden');
  document.getElementById('appRoot').classList.remove('hidden');
  if (typeof window.bootApp === 'function') window.bootApp();
}

// ── Render setup form fields ───────────────────────────────
function renderSetupFields(page, values) {
  const container = document.getElementById(`setupFields${page}`);
  if (!container) return;
  container.innerHTML = '';

  SETUP_PAGES[page].forEach(f => {
    const val = values[f.key] || '';
    const div = document.createElement('div');
    div.className = 'setup-field';
    div.innerHTML = `
      <label class="setup-label">${f.label}${f.required ? ' <span class="req">*</span>' : ''}</label>
      <input class="setup-input" type="${f.type}" id="sf_${f.key}"
        placeholder="${f.hint}"
        value="${val.startsWith('••••') ? '' : escHtml(val)}"
        autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
      <div class="setup-hint">${f.hint}</div>
    `;
    container.appendChild(div);
  });
}

// ── Step navigation ────────────────────────────────────────
function setupNext(fromPage) {
  const errors = validatePage(fromPage);
  if (errors.length) {
    showSetupError(errors[0]);
    return;
  }
  collectPage(fromPage);
  showSetupError('');
  gotoStep(fromPage + 1);
}

function setupPrev(fromPage) {
  gotoStep(fromPage - 1);
}

function gotoStep(step) {
  document.querySelectorAll('.setup-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.step').forEach(s => {
    s.classList.toggle('active', parseInt(s.dataset.step) === step);
    s.classList.toggle('done', parseInt(s.dataset.step) < step);
  });
  document.getElementById(`setupPage${step}`)?.classList.add('active');
}

function validatePage(page) {
  const errors = [];
  SETUP_PAGES[page].forEach(f => {
    if (f.required) {
      const el = document.getElementById(`sf_${f.key}`);
      if (!el || !el.value.trim()) errors.push(`${f.label} is required`);
    }
  });
  return errors;
}

function collectPage(page) {
  SETUP_PAGES[page].forEach(f => {
    const el = document.getElementById(`sf_${f.key}`);
    if (el && el.value.trim()) configValues[f.key] = el.value.trim();
  });
}

// ── Save config ────────────────────────────────────────────
async function setupSave() {
  const errors = validatePage(2);
  if (errors.length) { showSetupError(errors[0]); return; }
  collectPage(2);
  showSetupError('');

  document.getElementById('setupSaving').classList.remove('hidden');

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configValues),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');

    isEphemeral = data.ephemeral;
    document.getElementById('setupSaving').classList.add('hidden');

    // Show webhook URLs
    const publicUrl = configValues['PUBLIC_URL'];
    document.getElementById('webhookList').innerHTML = `
      <div class="webhook-item"><span>Twilio Voice:</span><code>${publicUrl}/webhook/twilio/voice</code></div>
      <div class="webhook-item"><span>Twilio SMS:</span><code>${publicUrl}/webhook/twilio/sms</code></div>
      <div class="webhook-item"><span>WhatsApp:</span><code>${publicUrl}/webhook/whatsapp</code></div>
    `;

    if (isEphemeral) {
      document.getElementById('ephemeralNote').style.display = 'block';
    }

    gotoStep(3);
  } catch (err) {
    document.getElementById('setupSaving').classList.add('hidden');
    showSetupError(`Error: ${err.message}`);
  }
}

function launchApp() {
  location.hash = '';
  showApp();
}

function showSetupError(msg) {
  const el = document.getElementById('setupError');
  if (!msg) { el.classList.add('hidden'); return; }
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ── Settings panel (in-app config editing) ─────────────────
async function loadSettingsPanel() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    const values = data.values || {};

    const allFields = [...SETUP_PAGES[1], ...SETUP_PAGES[2]];
    const container = document.getElementById('settingsFields');
    if (!container) return;
    container.innerHTML = '';

    allFields.forEach(f => {
      const val = values[f.key] || '';
      const div = document.createElement('div');
      div.className = 'setup-field';
      div.innerHTML = `
        <label class="setup-label">${f.label}</label>
        <input class="setup-input" type="${f.type}" id="set_${f.key}"
          value="${val.startsWith('••••') ? '' : escHtml(val)}"
          placeholder="${f.hint}"
          autocomplete="off">
      `;
      container.appendChild(div);
    });

    if (data.webhooks) {
      const wh = document.getElementById('settingsWebhooks');
      if (wh) wh.innerHTML = Object.entries(data.webhooks).map(([k,v]) =>
        `<div><b>${k}:</b><br><span style="word-break:break-all">${v}</span></div>`
      ).join('');
    }
  } catch (e) { console.error(e); }
}

async function saveSettings() {
  const allFields = [...SETUP_PAGES[1], ...SETUP_PAGES[2]];
  const updates = {};
  allFields.forEach(f => {
    const el = document.getElementById(`set_${f.key}`);
    if (el && el.value.trim()) updates[f.key] = el.value.trim();
  });

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (typeof showToast === 'function') {
      showToast(data.ephemeral
        ? 'Saved for this session. Set env vars in Railway for persistence.'
        : 'Settings saved ✓', data.ephemeral ? 'info' : 'success');
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast(`Save failed: ${err.message}`, 'error');
  }
}

// ── Expose globals ─────────────────────────────────────────
window.setupNext   = setupNext;
window.setupPrev   = setupPrev;
window.setupSave   = setupSave;
window.launchApp   = launchApp;
window.saveSettings = saveSettings;
window.loadSettingsPanel = loadSettingsPanel;

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Start ──────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkSetupNeeded);
} else {
  checkSetupNeeded();
}

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(e => console.log('SW:', e));
}
