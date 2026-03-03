'use strict';

async function checkSetupNeeded() {
  try {
    // First check if logged in
    const authRes = await fetch('/api/auth/check');
    const auth = await authRes.json();
    if (!auth.authenticated) {
      location.href = '/login';
      return;
    }

    // Then check if configured
    const res = await fetch('/api/features');
    const features = await res.json();
    if (features.configured) {
      showApp();
    } else {
      showNotConfigured();
    }
  } catch (e) {
    setTimeout(checkSetupNeeded, 1500);
  }
}

function showApp() {
  document.getElementById('setupOverlay')?.classList.add('hidden');
  document.getElementById('appRoot')?.classList.remove('hidden');
  if (typeof window.bootApp === 'function') window.bootApp();
}

function showNotConfigured() {
  document.getElementById('setupOverlay')?.classList.remove('hidden');
  document.getElementById('appRoot')?.classList.add('hidden');
  const container = document.querySelector('.setup-container');
  if (container) {
    container.innerHTML = `
      <div class="setup-logo">SP</div>
      <h1 class="setup-title">Almost there!</h1>
      <p class="setup-sub">Your app is deployed but needs API credentials. Add these as Environment Variables in your Railway project dashboard:</p>
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px;margin:20px 0;font-family:var(--mono);font-size:12px;line-height:2.2">
        PUBLIC_URL<br>TWILIO_ACCOUNT_SID<br>TWILIO_AUTH_TOKEN<br>TWILIO_PHONE_NUMBER<br>TWILIO_TWIML_APP_SID<br>TWILIO_API_KEY<br>TWILIO_API_SECRET<br>APP_USERNAME<br>APP_PASSWORD<br>
        <span style="color:var(--text-dim)">WA_PHONE_NUMBER_ID (optional)<br>WA_PERMANENT_TOKEN (optional)<br>WA_WEBHOOK_VERIFY_TOKEN (optional)</span>
      </div>
      <p style="font-size:12px;color:var(--text-dim)">After adding variables in Railway, click Deploy to restart, then refresh.</p>
      <button class="setup-btn" onclick="location.reload()" style="margin-top:8px">↻ Refresh</button>
    `;
  }
}

window.loadSettingsPanel = async function() {
  const container = document.getElementById('settingsFields') || document.getElementById('settingsStatus');
  try {
    const res = await fetch('/api/features');
    const f = await res.json();
    if (container) {
      container.innerHTML = `
        <p style="font-size:12px;color:var(--text-dim);line-height:1.8;padding:12px">
          Settings are managed via <b>Railway → Variables</b>.<br>
          Changes take effect after a redeploy.
        </p>`;
    }
    const wh = document.getElementById('settingsWebhooks');
    if (wh) {
      const base = location.origin;
      wh.innerHTML = `Twilio Voice:\n${base}/webhook/twilio/voice\n\nTwilio SMS:\n${base}/webhook/twilio/sms${f.whatsapp ? '\n\nWhatsApp:\n' + base + '/webhook/whatsapp' : ''}`;
    }
  } catch(e) {}
};

window.saveSettings = function() {
  if (typeof showToast === 'function') showToast('Edit variables in Railway dashboard, then redeploy', 'info');
};

// Service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkSetupNeeded);
} else {
  checkSetupNeeded();
}
