'use strict';

// ── On load: check if server is configured, skip wizard if so ──
async function checkSetupNeeded() {
  try {
    const res = await fetch('/api/features');
    const features = await res.json();

    if (features.configured) {
      // All good — go straight to the app
      showApp();
    } else {
      // Not configured — show a simple message (Railway vars needed)
      showNotConfigured();
    }
  } catch (e) {
    // Retry if server not ready yet
    setTimeout(checkSetupNeeded, 1500);
  }
}

function showApp() {
  document.getElementById('setupOverlay').classList.add('hidden');
  document.getElementById('appRoot').classList.remove('hidden');
  if (typeof window.bootApp === 'function') window.bootApp();
}

function showNotConfigured() {
  document.getElementById('setupOverlay').classList.remove('hidden');
  document.getElementById('appRoot').classList.add('hidden');

  // Replace wizard content with a simple message
  const container = document.querySelector('.setup-container');
  if (container) {
    container.innerHTML = `
      <div class="setup-logo">SP</div>
      <h1 class="setup-title">Almost there!</h1>
      <p class="setup-sub">Your app is deployed but needs API credentials. Add these as Environment Variables in your Railway project dashboard:</p>
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px;margin:20px 0;font-family:var(--mono);font-size:12px;line-height:2.2">
        PUBLIC_URL<br>
        TWILIO_ACCOUNT_SID<br>
        TWILIO_AUTH_TOKEN<br>
        TWILIO_PHONE_NUMBER<br>
        TWILIO_TWIML_APP_SID<br>
        TWILIO_API_KEY<br>
        TWILIO_API_SECRET<br>
        <span style="color:var(--text-dim)">WA_PHONE_NUMBER_ID (optional)<br>
        WA_PERMANENT_TOKEN (optional)<br>
        WA_WEBHOOK_VERIFY_TOKEN (optional)</span>
      </div>
      <p style="font-size:12px;color:var(--text-dim)">After adding variables in Railway, click <b>Deploy</b> to restart, then refresh this page.</p>
      <button class="setup-btn" onclick="location.reload()" style="margin-top:8px">↻ Refresh</button>
    `;
  }
}

// Expose for settings panel
window.loadSettingsPanel = async function() {
  const container = document.getElementById('settingsFields');
  const webhooks  = document.getElementById('settingsWebhooks');
  if (!container) return;

  try {
    const res = await fetch('/api/features');
    const f = await res.json();
    container.innerHTML = `
      <p style="font-size:12px;color:var(--text-dim);line-height:1.8">
        Settings are managed via <b>Railway → Variables</b>.<br>
        Changes there take effect after a redeploy.
      </p>
      <div style="margin-top:12px;font-size:12px;line-height:2">
        <span style="color:${f.voice ? 'var(--green)' : 'var(--red)'}">● Voice calls: ${f.voice ? 'enabled' : 'not configured'}</span><br>
        <span style="color:${f.sms ? 'var(--green)' : 'var(--red)'}">● SMS: ${f.sms ? 'enabled' : 'not configured'}</span><br>
        <span style="color:${f.whatsapp ? 'var(--green)' : 'var(--text-dim)'}">● WhatsApp: ${f.whatsapp ? 'enabled' : 'not configured (optional)'}</span>
      </div>
    `;
    if (webhooks && f.configured) {
      const base = location.origin;
      webhooks.innerHTML = `
        <div><b>Twilio Voice:</b><br>${base}/webhook/twilio/voice</div><br>
        <div><b>Twilio SMS:</b><br>${base}/webhook/twilio/sms</div><br>
        ${f.whatsapp ? `<div><b>WhatsApp:</b><br>${base}/webhook/whatsapp</div>` : ''}
      `;
    }
  } catch(e) { container.innerHTML = '<p style="color:var(--text-dim);font-size:12px">Could not load status.</p>'; }
};

window.saveSettings = function() {
  if (typeof showToast === 'function') showToast('Edit variables in Railway dashboard, then redeploy', 'info');
};

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Boot
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkSetupNeeded);
} else {
  checkSetupNeeded();
}
