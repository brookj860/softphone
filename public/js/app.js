'use strict';

/* ============================================================
   STATE
============================================================ */
const state = {
  conversations: {},   // phone -> { phone, name, channel, messages, unread, lastBody, lastTs }
  activePhone: null,
  activeChannel: 'sms',
  twilioDevice: null,
  activeCall: null,
  callTimer: null,
  callSeconds: 0,
  wsReconnectTimer: null,
  ws: null,
  contacts: {},        // phone -> name
  filter: 'all',
};

/* ============================================================
   PHONE NORMALISATION
   Always store as +44... format; merge 07... and +447... as same
============================================================ */
function normalizePhone(phone) {
  if (!phone) return phone;
  let p = phone.trim().replace(/[\s\-().]/g, '');
  // UK: 07xxx -> +447xxx
  if (/^07\d{9}$/.test(p)) return '+44' + p.slice(1);
  // UK: 447xxx (missing +) -> +447xxx
  if (/^447\d{9}$/.test(p)) return '+' + p;
  // Already +44
  if (/^\+44\d{10}$/.test(p)) return p;
  // Generic: if starts with 0 and 10+ digits, assume UK
  if (/^0\d{9,}$/.test(p)) return '+44' + p.slice(1);
  return p;
}

/* ============================================================
   DOM SHORTCUTS
============================================================ */
const $ = id => document.getElementById(id);

const els = {
  appRoot:       $('appRoot'),
  convList:      $('convList'),
  convSearch:    $('convSearch'),
  messages:      $('messages'),
  composeInput:  $('composeInput'),
  sendBtn:       $('sendBtn'),
  dialInput:     $('dialInput'),
  btnDialCall:   $('btnDialCall'),
  btnDelDigit:   $('btnDelDigit'),
  btnCall:       $('btnCall'),
  btnMute:       $('btnMute'),
  btnEndCall:    $('btnEndCall'),
  activeCallBar: $('activeCallBar'),
  callName:      $('callName'),
  callDuration:  $('callDuration'),
  chatName:      $('chatName'),
  chatStatus:    $('chatStatus'),
  chatAvatar:    $('chatAvatar'),
  incomingModal: $('incomingModal'),
  incomingFrom:  $('incomingFrom'),
  btnAccept:     $('btnAccept'),
  btnReject:     $('btnReject'),
  newConvModal:  $('newConvModal'),
  newConvPhone:  $('newConvPhone'),
  newConvName:   $('newConvName'),
  newConvCancel: $('newConvCancel'),
  newConvConfirm:$('newConvConfirm'),
  addContactModal:   $('addContactModal'),
  contactNameInput:  $('contactNameInput'),
  contactPhoneInput: $('contactPhoneInput'),
  addContactCancel:  $('addContactCancel'),
  addContactConfirm: $('addContactConfirm'),
  addContactBtn:     $('addContactBtn'),
  newConvBtn:        $('newConvBtn'),
  contactList:       $('contactList'),
  contactSearch:     $('contactSearch'),
  connDot:           $('connDot'),
  unreadBadge:       $('unreadBadge'),
  sTwilio:           $('sTwilio'),
  sWA:               $('sWA'),
  sServer:           $('sServer'),
  settingsStatus:    $('settingsStatus'),
  settingsWebhooks:  $('settingsWebhooks'),
  backBtn:           $('backBtn'),
};

/* ============================================================
   MOBILE NAVIGATION
============================================================ */
const screens = {
  conv:     $('convScreen'),
  chat:     $('chatScreen'),
  dial:     $('dialScreen'),
  contacts: $('contactsScreen'),
  settings: $('settingsScreen'),
};

const navBtns = {
  conv:     $('navConv'),
  dial:     $('navDial'),
  contacts: $('navContacts'),
  settings: $('navSettings'),
};

let currentScreen = 'conv';
const isMobile = () => window.innerWidth < 768;

function showScreen(name) {
  if (!isMobile()) {
    // Desktop: toggle side panels, chat always visible
    Object.entries(screens).forEach(([k, el]) => {
      if (!el) return;
      if (k === 'chat') return; // always visible
      if (k === name || k === 'conv') {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });
    Object.values(navBtns).forEach(b => b && b.classList.remove('active'));
    if (navBtns[name]) navBtns[name].classList.add('active');
    return;
  }

  // Mobile: show only one screen
  Object.values(screens).forEach(s => s && s.classList.remove('active'));
  if (screens[name]) screens[name].classList.add('active');

  Object.values(navBtns).forEach(b => b && b.classList.remove('active'));
  if (navBtns[name]) navBtns[name].classList.add('active');
  // Conv and chat both light up the conv nav btn
  if (name === 'chat' && navBtns.conv) navBtns.conv.classList.add('active');

  currentScreen = name;
}

function openChat(phone) {
  showScreen('chat');
}

function goBack() {
  showScreen('conv');
  state.activePhone = null;
}

// Nav button handlers
$('navConv')     && $('navConv').addEventListener('click',     () => showScreen('conv'));
$('navDial')     && $('navDial').addEventListener('click',     () => showScreen('dial'));
$('navContacts') && $('navContacts').addEventListener('click', () => { showScreen('contacts'); loadContacts(); });
$('navSettings') && $('navSettings').addEventListener('click', () => { showScreen('settings'); loadSettingsPanel(); });
$('navArchive')  && $('navArchive').addEventListener('click',  () => { showScreen('archive');  loadArchive(); });
els.backBtn && els.backBtn.addEventListener('click', goBack);

/* ============================================================
   WEBSOCKET
============================================================ */
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  state.ws = ws;

  ws.onopen = () => {
    setStatus('server', 'online');
    if (state.wsReconnectTimer) { clearTimeout(state.wsReconnectTimer); state.wsReconnectTimer = null; }
  };

  ws.onclose = () => {
    setStatus('server', 'offline');
    state.wsReconnectTimer = setTimeout(connectWS, 3000);
  };

  ws.onerror = () => ws.close();

  ws.onmessage = (e) => {
    try { handleWsEvent(JSON.parse(e.data)); } catch (_) {}
  };
}

function handleWsEvent(event) {
  switch (event.type) {
    case 'inbound_sms':
    case 'inbound_whatsapp':
      receiveMessage(event.from, {
        id: event.sid || event.waId,
        body: event.body,
        direction: 'in',
        channel: event.channel,
        ts: event.timestamp,
      }, event.profileName);
      notify(`📩 ${event.profileName || event.from}`, event.body);
      break;

    case 'outbound_sms':
    case 'outbound_whatsapp':
      // Ignore — already shown locally when sent
      break;

    case 'inbound_call':
      showIncomingCall(event.from, event.callSid);
      break;

    case 'call_status':
      if (['completed','failed','busy','no-answer'].includes(event.status)) endCallUI();
      break;
  }
}

/* ============================================================
   STATUS
============================================================ */
function setStatus(key, status) {
  const labels = { online: '🟢 Connected', offline: '⚫ Offline', connecting: '🟡 Connecting…' };
  const label = labels[status] || status;
  if (key === 'twilio' && els.sTwilio) els.sTwilio.textContent = label;
  if (key === 'server' && els.sServer) {
    els.sServer.textContent = label;
    if (els.connDot) els.connDot.className = `conn-dot ${status}`;
  }
}

/* ============================================================
   CONVERSATION HELPERS
============================================================ */
function ensureConversation(phone, name, channel) {
  phone = normalizePhone(phone);
  if (!state.conversations[phone]) {
    state.conversations[phone] = { phone, name: name || phone, channel: channel || 'sms', messages: [], unread: 0, lastBody: '', lastTs: new Date().toISOString() };
  } else {
    if (name && state.conversations[phone].name === phone) state.conversations[phone].name = name;
    if (channel) state.conversations[phone].channel = channel;
  }
  return state.conversations[phone];
}

function lookupName(phone) {
  return state.contacts[phone] || (state.conversations[phone]?.name !== phone ? state.conversations[phone]?.name : null);
}

/* ============================================================
   LOAD HISTORY FROM SERVER
============================================================ */
async function loadHistory() {
  try {
    const res = await fetch('/api/conversations');
    if (!res.ok) return;
    const convs = await res.json();
    if (!convs.length) return;

    // First pass: populate conversation list so UI shows immediately
    for (const conv of convs) {
      const phone = normalizePhone(conv.phone);
      ensureConversation(phone, conv.name, conv.channel);
      const c = state.conversations[phone];
      c.lastBody = conv.lastBody || '';
      c.lastTs   = conv.lastTs || new Date().toISOString();
      c.unread   = conv.unread || 0;
    }
    renderConvList();
    updateUnreadBadge();

    // Second pass: load all messages in parallel
    await Promise.all(
      convs.map(conv => loadMessagesForConversation(normalizePhone(conv.phone)))
    );
    console.log(`[History] Loaded ${convs.length} conversations with messages`);

    // Auto-open the most recent conversation on desktop,
    // or on mobile only if no conversation is already open
    const sorted = convs.slice().sort((a, b) => new Date(b.lastTs) - new Date(a.lastTs));
    if (sorted.length && !state.activePhone) {
      const mostRecent = normalizePhone(sorted[0].phone);
      // On desktop: open fully. On mobile: load the chat silently so it's ready when tapped
      state._silentOpen = isMobile();
      await openConversation(mostRecent);
      // On mobile, just highlight it in the list but don't navigate away
    }
  } catch (e) {
    console.warn('[History] Load failed:', e.message);
  }
}

async function loadMessagesForConversation(phone) {
  try {
    phone = normalizePhone(phone);
    const res = await fetch('/api/conversations/' + encodeURIComponent(phone) + '/messages');
    if (!res.ok) return;
    const messages = await res.json();
    const conv = state.conversations[phone];
    if (conv && messages.length > 0) {
      // Merge: keep any locally-added messages not yet in server, prepend server history
      const localNew = conv.messages.filter(m => m.pending);
      conv.messages = [...messages, ...localNew];
      // Update preview from most recent message
      const last = messages[messages.length - 1];
      if (last && !conv.lastBody) conv.lastBody = last.body;
    }
  } catch (e) {
    // silently ignore per-conversation failures
  }
}



/* ============================================================
   TWILIO DEVICE
============================================================ */
async function initTwilio() {
  try {
    setStatus('twilio', 'connecting');

    if (typeof Twilio === 'undefined' || !Twilio.Device) {
      throw new Error('Twilio SDK not loaded — check /js/twilio.min.js is being served');
    }

    const res = await fetch('/api/token?identity=softphone-agent');
    if (!res.ok) throw new Error('Token fetch failed — check TWILIO_API_KEY and TWILIO_API_SECRET in Railway');
    const { token } = await res.json();

    // Tear down previous device cleanly
    if (state.twilioDevice && state.twilioDevice._device) {
      try {
        state.twilioDevice._device.removeAllListeners();
        await state.twilioDevice._device.unregister();
        state.twilioDevice._device.destroy();
      } catch (_) {}
      state.twilioDevice = null;
    }

    // v2.x API
    const device = new Twilio.Device(token, {
      logLevel: 'error',
      codecPreferences: ['opus', 'pcmu'],
    });

    device.on('registered', () => {
      console.log('[Twilio] registered and ready');
      setStatus('twilio', 'online');
      state.twilioDevice = {
        _device: device,
        connect: (params) => device.connect(params),
        disconnectAll: () => device.disconnectAll(),
      };
    });

    device.on('unregistered', () => {
      setStatus('twilio', 'offline');
      state.twilioDevice = null;
    });

    device.on('error', (twilioError) => {
      console.error('[Twilio] error:', twilioError);
      // Don't show toast for expected re-init errors
      if (twilioError.code !== 31005) {
        showToast('Twilio: ' + (twilioError.message || twilioError), 'error');
      }
      setStatus('twilio', 'offline');
    });

    device.on('incoming', (call) => {
      const from = call.parameters?.From || 'Unknown';
      showIncomingCall(from, null, call);
    });

    device.on('tokenWillExpire', () => {
      console.log('[Twilio] token expiring, refreshing...');
      initTwilio();
    });

    await device.register();
    console.log('[Twilio] register() called');

  } catch (err) {
    console.error('[Twilio] init error:', err);
    setStatus('twilio', 'offline');
    showToast('Twilio: ' + err.message, 'error');
    setTimeout(initTwilio, 15_000);
  }
}

/* ============================================================
   CALLING
============================================================ */
let pendingIncomingConn = null;

function showIncomingCall(from, callSid, conn) {
  pendingIncomingConn = conn || null;
  els.incomingFrom.textContent = lookupName(from) || from;
  els.incomingModal.classList.remove('hidden');

  // Auto reject after 30s
  els.btnAccept._timer = setTimeout(() => {
    els.incomingModal.classList.add('hidden');
    if (pendingIncomingConn?.reject) pendingIncomingConn.reject();
  }, 30_000);
}

els.btnAccept && els.btnAccept.addEventListener('click', () => {
  clearTimeout(els.btnAccept._timer);
  els.incomingModal.classList.add('hidden');
  if (pendingIncomingConn?.accept) {
    pendingIncomingConn.accept();
    const from = pendingIncomingConn.parameters?.From || 'Unknown';
    startCallUI(lookupName(from) || from, from);
    setupCallEvents(pendingIncomingConn);
    // Switch to dialpad to show active call
    showScreen('dial');
  }
});

els.btnReject && els.btnReject.addEventListener('click', () => {
  clearTimeout(els.btnAccept._timer);
  els.incomingModal.classList.add('hidden');
  if (pendingIncomingConn?.reject) pendingIncomingConn.reject();
  pendingIncomingConn = null;
});

async function makeCall(to) {
  to = normalizePhone(to);
  if (!state.twilioDevice) return showToast('Twilio Voice not ready', 'error');
  try {
    const conn = await state.twilioDevice.connect({ params: { To: to } });
    state.activeCall = conn;
    startCallUI(lookupName(to) || to, to);
    setupCallEvents(conn);
    ensureConversation(to, lookupName(to), 'voice');
    addMessageToConv(to, { body: '📞 Outbound call', direction: 'out', channel: 'voice', ts: new Date().toISOString() });
  } catch (err) {
    showToast('Call failed: ' + err.message, 'error');
  }
}

function setupCallEvents(conn) {
  state.activeCall = conn;
  conn.on('disconnect', () => endCallUI());
  conn.on('error', (err) => { showToast('Call error: ' + err.message, 'error'); endCallUI(); });
}

function startCallUI(name, number) {
  els.callName.textContent = name || number;
  els.activeCallBar.classList.add('visible');
  state.callSeconds = 0;
  state.callTimer = setInterval(() => {
    state.callSeconds++;
    const m = String(Math.floor(state.callSeconds / 60)).padStart(2, '0');
    const s = String(state.callSeconds % 60).padStart(2, '0');
    els.callDuration.textContent = `${m}:${s}`;
  }, 1000);
}

function endCallUI() {
  if (state.callTimer) { clearInterval(state.callTimer); state.callTimer = null; }
  els.activeCallBar.classList.remove('visible');
  state.activeCall = null;
  pendingIncomingConn = null;
}

els.btnEndCall && els.btnEndCall.addEventListener('click', () => {
  if (state.activeCall) {
    try { state.activeCall.disconnect(); } catch(_) {}
  }
  if (state.twilioDevice) {
    try { state.twilioDevice.disconnectAll(); } catch(_) {}
  }
  endCallUI();
});

let muted = false;
els.btnMute && els.btnMute.addEventListener('click', () => {
  muted = !muted;
  if (state.activeCall?.mute) state.activeCall.mute(muted);
  els.btnMute.textContent = muted ? '🔇 Unmute' : '🎤 Mute';
  els.btnMute.classList.toggle('active-btn', muted);
});

/* ============================================================
   DIALPAD
============================================================ */
document.querySelectorAll('.key[data-digit]').forEach(btn => {
  btn.addEventListener('click', () => {
    els.dialInput.value += btn.dataset.digit;
    if (state.activeCall?.sendDigits) state.activeCall.sendDigits(btn.dataset.digit);
  });
});

els.btnDelDigit && els.btnDelDigit.addEventListener('click', () => {
  els.dialInput.value = els.dialInput.value.slice(0, -1);
});

els.btnDialCall && els.btnDialCall.addEventListener('click', () => {
  const to = els.dialInput.value.trim();
  if (!to) return showToast('Enter a number first', 'info');
  if (!state.twilioDevice) return showToast('Twilio Voice not ready', 'error');
  makeCall(to);
});

/* ============================================================
   OPEN CONVERSATION
============================================================ */
async function openConversation(phone) {
  phone = normalizePhone(phone);
  const conv = state.conversations[phone];
  if (!conv) return;

  state.activePhone = phone;
  state.activeChannel = conv.channel !== 'voice' ? conv.channel : 'sms';

  // Update header
  const name = lookupName(phone) || conv.name || phone;
  const initial = (name[0] || '?').toUpperCase();
  els.chatName.textContent = name;
  els.chatAvatar.textContent = initial;
  els.chatAvatar.style.background = phoneColor(phone);
  els.chatStatus.textContent = phone;
  els.btnCall.dataset.phone = phone;

  // Update channel pills
  updateChannelPills();

  // Load messages from server if needed
  if (conv.messages.length === 0) await loadMessagesForConversation(phone);

  // Mark as read
  conv.unread = 0;
  fetch(`/api/conversations/${encodeURIComponent(phone)}/read`, { method: 'POST' }).catch(() => {});
  updateUnreadBadge();
  renderConvList();

  // Render messages
  renderMessages(phone);

  // On mobile only navigate if explicitly triggered by user tap
  if (!state._silentOpen) openChat(phone);
  state._silentOpen = false;

  els.composeInput.focus();
}

function renderMessages(phone) {
  const conv = state.conversations[phone];
  if (!conv) return;
  els.messages.innerHTML = '';
  let lastDate = null;

  conv.messages.forEach(msg => {
    const d = new Date(msg.ts);
    const dateStr = d.toLocaleDateString();
    if (dateStr !== lastDate) {
      lastDate = dateStr;
      const div = document.createElement('div');
      div.className = 'day-divider';
      div.innerHTML = `<div class="day-line"></div><div class="day-text">${formatDate(d)}</div><div class="day-line"></div>`;
      els.messages.appendChild(div);
    }

    if (msg.channel === 'voice') {
      const div = document.createElement('div');
      div.className = 'call-event';
      div.textContent = msg.body;
      els.messages.appendChild(div);
      return;
    }

    const row = document.createElement('div');
    row.className = `msg-row ${msg.direction}`;
    row.dataset.msgId = msg.id || '';

    const bubble = document.createElement('div');
    bubble.className = `msg-bubble ${msg.direction}`;

    // Sender label — contact name/number for inbound, "You" for outbound
    const conv = state.conversations[phone];
    const sender = document.createElement('div');
    sender.className = 'msg-sender';
    if (msg.direction === 'in') {
      const inName = lookupName(phone) || conv?.name || phone;
      sender.textContent = inName;
      sender.classList.add('msg-sender-in');
    } else {
      const myName = (window._profileName) || 'You';
      sender.textContent = myName;
      sender.classList.add('msg-sender-out');
    }
    bubble.appendChild(sender);

    const text = document.createElement('div');
    text.className = 'msg-body';
    text.textContent = msg.body;
    bubble.appendChild(text);

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const chLabel = msg.channel === 'whatsapp' ? 'WA' : 'SMS';
    let statusIcon = '';
    if (msg.direction === 'out' && msg.status === 'pending') statusIcon = ' ⏳';
    if (msg.direction === 'out' && msg.status === 'failed')  statusIcon = ' ❌';
    meta.innerHTML = `<span class="msg-ch-tag tag-${msg.channel || 'sms'}">${chLabel}</span><span class="msg-time">${timeStr}${statusIcon}</span>`;

    row.appendChild(bubble);
    row.appendChild(meta);
    els.messages.appendChild(row);
  });

  els.messages.scrollTop = els.messages.scrollHeight;
}

/* ============================================================
   CONVERSATION LIST
============================================================ */
function renderConvList() {
  const search = (els.convSearch?.value || '').toLowerCase();
  const filter = state.filter;

  let items = Object.values(state.conversations);
  if (filter !== 'all') {
    items = items.filter(c => {
      const ch = (c.channel || 'sms').toLowerCase();
      if (filter === 'sms') return ch === 'sms' || ch === '' || !ch;
      if (filter === 'voice') return ch === 'voice';
      if (filter === 'whatsapp') return ch === 'whatsapp';
      return ch === filter;
    });
  }
  if (search) items = items.filter(c => (c.name || '').toLowerCase().includes(search) || c.phone.includes(search));
  items.sort((a, b) => new Date(b.lastTs) - new Date(a.lastTs));

  if (!items.length) {
    els.convList.innerHTML = '<div class="empty-state">No conversations yet.<br>Tap + to start one.</div>';
    return;
  }

  els.convList.innerHTML = '';
  items.forEach(conv => {
    const name = lookupName(conv.phone) || conv.name || conv.phone;
    const initial = (name[0] || '?').toUpperCase();
    const div = document.createElement('div');
    div.className = 'conv-item';
    div.style.borderLeftColor = state.activePhone === conv.phone ? 'var(--accent)' : 'transparent';

    const chColor = conv.channel === 'whatsapp' ? 'var(--wa)' : conv.channel === 'sms' ? 'var(--sms)' : 'var(--accent)';
    const chLabel = conv.channel === 'whatsapp' ? 'W' : conv.channel === 'sms' ? 'S' : '📞';

    div.innerHTML = `
      <div class="avatar" style="background:${phoneColor(conv.phone)}">
        ${initial}
        <div class="ch-dot dot-${conv.channel}">${chLabel}</div>
      </div>
      <div class="conv-info">
        <div class="conv-name">${escHtml(name)}</div>
        <div class="conv-preview">${escHtml(conv.lastBody || '…')}</div>
      </div>
      <div class="conv-meta">
        <div class="conv-time">${timeAgo(conv.lastTs)}</div>
        ${conv.unread ? `<div class="unread-pill">${conv.unread}</div>` : ''}
      </div>
    `;
    div.addEventListener('click', () => openConversation(conv.phone));
    els.convList.appendChild(div);
  });
}

function updateUnreadBadge() {
  const total = Object.values(state.conversations).reduce((sum, c) => sum + (c.unread || 0), 0);
  if (total > 0) {
    els.unreadBadge.textContent = total > 99 ? '99+' : total;
    els.unreadBadge.classList.remove('hidden');
  } else {
    els.unreadBadge.classList.add('hidden');
  }
}

/* ============================================================
   RECEIVE / ADD MESSAGES
============================================================ */
function receiveMessage(phone, msg, profileName, isSync = false) {
  phone = normalizePhone(phone);
  const conv = ensureConversation(phone, profileName, msg.channel);
  conv.messages.push(msg);
  conv.lastBody = msg.body;
  conv.lastTs = msg.ts || new Date().toISOString();
  if (!isSync && msg.direction === 'in') conv.unread = (conv.unread || 0) + 1;

  renderConvList();
  updateUnreadBadge();

  if (state.activePhone === phone) {
    renderMessages(phone);
    if (msg.direction === 'in') {
      conv.unread = 0;
      fetch(`/api/conversations/${encodeURIComponent(phone)}/read`, { method: 'POST' }).catch(() => {});
    }
  }
}

function addMessageToConv(phone, msg) {
  const conv = ensureConversation(phone, null, msg.channel);
  const id = `msg-${Date.now()}-${Math.random()}`;
  msg.id = msg.id || id;
  conv.messages.push(msg);
  conv.lastBody = msg.body;
  conv.lastTs = msg.ts || new Date().toISOString();
  renderConvList();
  if (state.activePhone === phone) renderMessages(phone);
  return msg.id;
}

function markMsgSent(phone, msgId) {
  const conv = state.conversations[phone];
  if (!conv) return;
  const msg = conv.messages.find(m => m.id === msgId);
  if (msg) { msg.pending = false; msg.status = 'sent'; }
  if (state.activePhone === phone) renderMessages(phone);
}

function markMsgFailed(phone, msgId) {
  const conv = state.conversations[phone];
  if (!conv) return;
  const msg = conv.messages.find(m => m.id === msgId);
  if (msg) { msg.status = 'failed'; }
  if (state.activePhone === phone) renderMessages(phone);
}

/* ============================================================
   SEND MESSAGE
============================================================ */
els.sendBtn && els.sendBtn.addEventListener('click', sendMessage);
els.composeInput && els.composeInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
els.composeInput && els.composeInput.addEventListener('input', () => {
  els.composeInput.style.height = 'auto';
  els.composeInput.style.height = Math.min(els.composeInput.scrollHeight, 120) + 'px';
});

async function sendMessage() {
  const body = els.composeInput.value.trim();
  const phone = state.activePhone;
  if (!body || !phone) return;

  els.composeInput.value = '';
  els.composeInput.style.height = 'auto';
  els.sendBtn.disabled = true;

  const channel = state.activeChannel;
  const msgId = addMessageToConv(phone, { body, direction: 'out', channel, ts: new Date().toISOString(), status: 'pending' });

  try {
    const endpoint = channel === 'whatsapp' ? '/api/whatsapp/send' : '/api/sms/send';
    const res = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: phone, body }),
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error || `HTTP ${res.status}`); }
    markMsgSent(phone, msgId);
  } catch (err) {
    showToast('Send failed: ' + err.message, 'error');
    markMsgFailed(phone, msgId);
  } finally {
    els.sendBtn.disabled = false;
    els.composeInput.focus();
  }
}

/* ============================================================
   CHANNEL SELECTOR
============================================================ */
document.querySelectorAll('.ch-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    state.activeChannel = pill.dataset.channel;
    updateChannelPills();
  });
});

function updateChannelPills() {
  document.querySelectorAll('.ch-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.channel === state.activeChannel);
  });
}

/* ============================================================
   CALL BUTTON IN CHAT HEADER
============================================================ */
els.btnCall && els.btnCall.addEventListener('click', () => {
  const phone = els.btnCall.dataset.phone || state.activePhone;
  if (!phone) return;
  makeCall(phone);
  showScreen('dial');
});

/* ============================================================
   FILTER TABS
============================================================ */
document.querySelectorAll('.filter-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    state.filter = tab.dataset.filter;
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    renderConvList();
  });
});

/* ============================================================
   SEARCH
============================================================ */
// ── Smart Search ──────────────────────────────────────────────
const smartSuggestions = $('smartSuggestions');
const smartSearchGo    = $('smartSearchGo');

function isPhoneNumber(str) {
  // Looks like a phone number if it contains mostly digits, +, spaces, dashes
  return /^[+0-9][0-9 +\-().]{3,}$/.test(str.trim());
}

function renderSuggestions(query) {
  if (!query) {
    smartSuggestions.classList.add('hidden');
    smartSearchGo.classList.add('hidden');
    renderConvList();
    return;
  }

  const q = query.toLowerCase();
  const results = [];

  // Search existing conversations
  Object.values(state.conversations).forEach(conv => {
    const name = (lookupName(conv.phone) || conv.name || '').toLowerCase();
    const phone = conv.phone.toLowerCase();
    if (name.includes(q) || phone.includes(q)) {
      results.push({ type: 'conversation', conv });
    }
  });

  // Search contacts not already in conversations
  Object.entries(state.contacts).forEach(([phone, name]) => {
    if (!state.conversations[phone]) {
      if (name.toLowerCase().includes(q) || phone.includes(q)) {
        results.push({ type: 'contact', phone, name });
      }
    }
  });

  // If it looks like a phone number, offer to start new conversation
  const looksLikePhone = isPhoneNumber(query);

  // Show/hide go button
  if (looksLikePhone) {
    smartSearchGo.classList.remove('hidden');
  } else {
    smartSearchGo.classList.add('hidden');
  }

  // If no results and not a phone number, just filter list
  if (!results.length && !looksLikePhone) {
    smartSuggestions.classList.add('hidden');
    renderConvList();
    return;
  }

  // Build suggestions dropdown
  smartSuggestions.innerHTML = '';
  smartSuggestions.classList.remove('hidden');

  results.slice(0, 5).forEach(item => {
    const div = document.createElement('div');
    div.className = 'suggestion-item';

    if (item.type === 'conversation' || item.type === 'contact') {
      const phone = item.type === 'conversation' ? item.conv.phone : item.phone;
      const name  = item.type === 'conversation' ? (lookupName(phone) || item.conv.name || phone) : item.name;
      const initial = (name[0] || '?').toUpperCase();
      div.innerHTML = `
        <div class="suggestion-avatar" style="background:${phoneColor(phone)}">${initial}</div>
        <div class="suggestion-info">
          <div class="suggestion-name">${escHtml(name)}</div>
          <div class="suggestion-sub">${escHtml(phone)}</div>
        </div>
        <div class="suggestion-action">Open</div>
      `;
      div.addEventListener('click', () => {
        clearSearch();
        if (item.type === 'contact') ensureConversation(phone, name, 'sms');
        openConversation(phone);
      });
    }
    smartSuggestions.appendChild(div);
  });

  // "Start conversation with [number]" option if looks like a phone number
  if (looksLikePhone) {
    const phone = query.trim().replace(/\s/g, '');
    const existing = state.conversations[phone];
    if (!existing) {
      const div = document.createElement('div');
      div.className = 'suggestion-item suggestion-new';
      div.innerHTML = `
        <div class="suggestion-avatar">+</div>
        <div class="suggestion-info">
          <div class="suggestion-name">New conversation</div>
          <div class="suggestion-sub">${escHtml(phone)}</div>
        </div>
        <div class="suggestion-action" style="color:var(--accent)">Start</div>
      `;
      div.addEventListener('click', () => {
        clearSearch();
        ensureConversation(phone, '', 'sms');
        openConversation(phone);
      });
      smartSuggestions.appendChild(div);
    }
  }

  // Also filter the list underneath
  renderConvList();
}

function clearSearch() {
  if (els.convSearch) els.convSearch.value = '';
  smartSuggestions.classList.add('hidden');
  smartSearchGo.classList.add('hidden');
  renderConvList();
}

els.convSearch && els.convSearch.addEventListener('input', (e) => renderSuggestions(e.target.value));
els.convSearch && els.convSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') clearSearch();
  if (e.key === 'Enter') {
    const val = els.convSearch.value.trim();
    if (isPhoneNumber(val)) {
      const phone = val.replace(/\s/g, '');
      clearSearch();
      ensureConversation(phone, '', 'sms');
      openConversation(phone);
    }
  }
});

smartSearchGo && smartSearchGo.addEventListener('click', () => {
  const val = els.convSearch.value.trim().replace(/\s/g, '');
  if (val) {
    clearSearch();
    ensureConversation(val, '', 'sms');
    openConversation(val);
  }
});

// Close suggestions when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.smart-search-wrap') && !e.target.closest('.smart-suggestions')) {
    smartSuggestions?.classList.add('hidden');
  }
});
els.contactSearch && els.contactSearch.addEventListener('input', () => loadContacts(els.contactSearch.value));

/* ============================================================
   NEW CONVERSATION MODAL
============================================================ */
els.newConvBtn && els.newConvBtn.addEventListener('click', () => els.newConvModal.classList.remove('hidden'));
els.newConvCancel && els.newConvCancel.addEventListener('click', () => els.newConvModal.classList.add('hidden'));
els.newConvConfirm && els.newConvConfirm.addEventListener('click', () => {
  const phone = els.newConvPhone.value.trim();
  const name  = els.newConvName.value.trim();
  if (!phone) return;
  ensureConversation(phone, name, 'sms');
  els.newConvModal.classList.add('hidden');
  els.newConvPhone.value = '';
  els.newConvName.value  = '';
  openConversation(phone);
});

/* ============================================================
   CONTACTS
============================================================ */
async function loadContacts(search = '') {
  try {
    const res = await fetch(`/api/contacts${search ? '?q=' + encodeURIComponent(search) : ''}`);
    const contacts = await res.json();
    state.contacts = {};
    contacts.forEach(c => { state.contacts[c.phone] = c.name; });
    renderContactList(contacts);
  } catch (e) { console.warn('[Contacts]', e.message); }
}

function renderContactList(contacts) {
  if (!els.contactList) return;
  if (!contacts.length) {
    els.contactList.innerHTML = '<div class="empty-state">No contacts yet.</div>';
    return;
  }
  els.contactList.innerHTML = '';
  contacts.forEach(c => {
    const div = document.createElement('div');
    div.className = 'conv-item';
    div.innerHTML = `
      <div class="avatar" style="background:${phoneColor(c.phone)}">${(c.name[0]||'?').toUpperCase()}</div>
      <div class="conv-info">
        <div class="conv-name">${escHtml(c.name)}</div>
        <div class="conv-preview">${escHtml(c.phone)}</div>
      </div>
    `;
    div.addEventListener('click', () => {
      ensureConversation(c.phone, c.name, 'sms');
      openConversation(c.phone);
    });
    els.contactList.appendChild(div);
  });
}

els.addContactBtn && els.addContactBtn.addEventListener('click', () => els.addContactModal.classList.remove('hidden'));
els.addContactCancel && els.addContactCancel.addEventListener('click', () => els.addContactModal.classList.add('hidden'));
els.addContactConfirm && els.addContactConfirm.addEventListener('click', async () => {
  const name  = els.contactNameInput.value.trim();
  const phone = els.contactPhoneInput.value.trim();
  if (!name || !phone) return;
  try {
    const res = await fetch('/api/contacts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone }),
    });
    if (!res.ok) throw new Error('Save failed');
    els.addContactModal.classList.add('hidden');
    els.contactNameInput.value  = '';
    els.contactPhoneInput.value = '';
    await loadContacts();
    showToast(`${name} saved ✓`, 'success');
  } catch (e) { showToast('Failed: ' + e.message, 'error'); }
});

/* ============================================================
   SETTINGS PANEL
============================================================ */
// ── Theme ────────────────────────────────────────────────────
function applyTheme(light) {
  document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
  try { localStorage.setItem('sp-theme', light ? 'light' : 'dark'); } catch(_) {}
  // Sync hidden checkbox in settings if present
  const toggle = $('themeToggle');
  if (toggle) toggle.checked = light;
  // Swap sun/moon icon in nav
  const moon = document.querySelector('.icon-moon');
  const sun  = document.querySelector('.icon-sun');
  if (moon) moon.classList.toggle('hidden', light);
  if (sun)  sun.classList.toggle('hidden', !light);
}

// Apply saved theme immediately (before settings panel opens)
(function() {
  try {
    const saved = localStorage.getItem('sp-theme');
    if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
  } catch(_) {}
})();

// ── Profile ──────────────────────────────────────────────────
async function loadProfile() {
  try {
    const res = await fetch('/api/profile');
    if (!res.ok) return;
    const p = await res.json();
    const name = p.username || 'Agent';
    const num  = p.phoneNumber || '—';
    const av = $('profileAvatar'), nm = $('profileName'), nb = $('profileNumber');
    if (av) { av.textContent = name[0].toUpperCase(); av.style.background = `hsl(${name.charCodeAt(0) * 7 % 360},45%,40%)`; }
    if (nm) nm.textContent = name;
    if (nb) nb.textContent = num;
    window._profileName = name; // used by message bubbles
  } catch(_) {}
}

$('profileLogout') && $('profileLogout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/login';
});

window.loadSettingsPanel = async function() {
  // Profile
  await loadProfile();

  // Theme toggle
  const toggle = $('themeToggle');
  if (toggle) {
    try { toggle.checked = localStorage.getItem('sp-theme') === 'light'; } catch(_) {}
    toggle.onchange = () => applyTheme(toggle.checked);
  }

  try {
    const res = await fetch('/api/features');
    const f = await res.json();

    if (els.settingsStatus) {
      els.settingsStatus.innerHTML = `
        <div class="settings-row"><span class="settings-row-label">Voice calls</span><span class="settings-row-val" style="color:${f.voice?'var(--green)':'var(--red)'}">${f.voice?'✓ Enabled':'✗ Not configured'}</span></div>
        <div class="settings-row"><span class="settings-row-label">SMS</span><span class="settings-row-val" style="color:${f.sms?'var(--green)':'var(--red)'}">${f.sms?'✓ Enabled':'✗ Not configured'}</span></div>
        <div class="settings-row"><span class="settings-row-label">WhatsApp</span><span class="settings-row-val" style="color:${f.whatsapp?'var(--green)':'var(--text-dim)'}">${f.whatsapp?'✓ Enabled':'— Not configured'}</span></div>
        <div class="settings-row"><span class="settings-row-label">Database</span><span class="settings-row-val" style="color:${f.db?'var(--green)':'var(--text-dim)'}">${f.db?'✓ Postgres':'— Memory only'}</span></div>
      `;
    }

    if (els.settingsWebhooks) {
      const base = location.origin;
      els.settingsWebhooks.innerHTML = `Twilio Voice: ${base}/webhook/twilio/voice\nTwilio SMS: ${base}/webhook/twilio/sms${f.whatsapp ? '\nWhatsApp: ' + base + '/webhook/whatsapp' : ''}`;
    }
  } catch(e) {}
};

window.saveSettings = function() {
  showToast('Edit variables in Railway dashboard, then redeploy', 'info');
};

/* ============================================================
   TOAST
============================================================ */
function showToast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
window.showToast = showToast;

/* ============================================================
   NOTIFICATIONS
============================================================ */
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}
function notify(title, body) {
  if (Notification.permission === 'granted' && document.hidden) {
    new Notification(title, { body, icon: '/icons/icon-192.png' });
  }
}

/* ============================================================
   UTILS
============================================================ */
function phoneColor(phone) {
  let h = 0;
  for (let i = 0; i < phone.length; i++) h = phone.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360},45%,35%)`;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function timeAgo(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'now';
  if (diff < 3600) return Math.floor(diff/60) + 'm';
  if (diff < 86400) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function formatDate(d) {
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now); yesterday.setDate(now.getDate()-1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

/* ============================================================
   CHECK FEATURES
============================================================ */
async function checkFeatures() {
  try {
    const res = await fetch('/api/features');
    const features = await res.json();
    if (!features.whatsapp) {
      document.querySelectorAll('.ch-pill[data-channel="whatsapp"]').forEach(p => p.style.display = 'none');
      state.activeChannel = 'sms';
      updateChannelPills();
      if (els.sWA) els.sWA.textContent = '⚫ Not configured';
    }
  } catch(e) {}
}


/* ============================================================
   IMAGE RESIZE (client-side before upload)
============================================================ */
function resizeImage(file, maxPx) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width  * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.88);
    };
    img.src = url;
  });
}

/* ============================================================
   ARCHIVE
============================================================ */
const archState = {
  tab:      'messages',
  msgPage:  0,
  msgTotal: 0,
  query:    '',
  channel:  '',
  playingSid: null,
};
const PAGE_SIZE = 50;

async function loadArchive() {
  // Tab switchers
  document.querySelectorAll('.arch-tab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.arch-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      archState.tab = btn.dataset.arch;
      document.querySelectorAll('.arch-view').forEach(v => v.classList.remove('active'));
      $('arch' + btn.dataset.arch.charAt(0).toUpperCase() + btn.dataset.arch.slice(1) + 'View')?.classList.add('active');
      if (archState.tab === 'messages')   fetchArchiveMessages(0);
      if (archState.tab === 'recordings') fetchArchiveRecordings();
    };
  });

  // Search
  const searchEl = $('archiveSearch');
  if (searchEl) {
    searchEl.oninput = debounce(() => {
      archState.query = searchEl.value;
      if (archState.tab === 'messages')   fetchArchiveMessages(0);
      if (archState.tab === 'recordings') fetchArchiveRecordings();
    }, 350);
  }

  // Initial load
  fetchArchiveMessages(0);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Messages ────────────────────────────────────────────────
async function fetchArchiveMessages(page = 0) {
  const list = $('archMessagesList');
  if (!list) return;
  list.innerHTML = '<div class="arch-empty">Loading…</div>';
  archState.msgPage = page;

  const params = new URLSearchParams({
    limit:  PAGE_SIZE,
    offset: page * PAGE_SIZE,
    q:      archState.query,
  });
  if (archState.channel) params.set('channel', archState.channel);

  try {
    const res = await fetch('/api/archive/messages?' + params);
    const { messages, total } = await res.json();
    archState.msgTotal = total;

    if (!messages.length) {
      list.innerHTML = '<div class="arch-empty">No messages found.</div>';
      $('archMsgPager').innerHTML = '';
      return;
    }

    list.innerHTML = '';
    messages.forEach(m => {
      const name = m.contact_name || m.phone;
      const ts   = new Date(m.ts);
      const row  = document.createElement('div');
      row.className = 'arch-msg-row';
      row.innerHTML = `
        <div class="arch-msg-top">
          <span class="arch-msg-dir arch-dir-${m.direction}">${m.direction === 'in' ? 'IN' : 'OUT'}</span>
          <span class="arch-msg-contact">${escHtml(name)}</span>
          <span class="arch-msg-ch tag-${m.channel}">${m.channel === 'whatsapp' ? 'WA' : 'SMS'}</span>
          <span class="arch-msg-time">${ts.toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'})} ${ts.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
        </div>
        <div class="arch-msg-body">${escHtml(m.body)}</div>
      `;
      list.appendChild(row);
    });

    // Pagination
    renderMsgPager(page, total);
  } catch (e) {
    list.innerHTML = '<div class="arch-empty">Failed to load messages.</div>';
  }
}

function renderMsgPager(page, total) {
  const pager = $('archMsgPager');
  if (!pager) return;
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) { pager.innerHTML = ''; return; }

  pager.innerHTML = '';
  const info = document.createElement('span');
  info.className = 'arch-page-info';
  info.textContent = `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`;
  pager.appendChild(info);

  if (page > 0) {
    const prev = document.createElement('button');
    prev.className = 'arch-page-btn';
    prev.textContent = '← Prev';
    prev.onclick = () => fetchArchiveMessages(page - 1);
    pager.appendChild(prev);
  }
  if (page < pages - 1) {
    const next = document.createElement('button');
    next.className = 'arch-page-btn';
    next.textContent = 'Next →';
    next.onclick = () => fetchArchiveMessages(page + 1);
    pager.appendChild(next);
  }
}

// ── Recordings ──────────────────────────────────────────────
async function fetchArchiveRecordings() {
  const list = $('archRecordingsList');
  if (!list) return;
  list.innerHTML = '<div class="arch-empty">Loading…</div>';

  try {
    const res = await fetch('/api/archive/recordings?limit=100');
    const { recordings } = await res.json();

    if (!recordings.length) {
      list.innerHTML = '<div class="arch-empty">No recordings found.<br><small>Recordings appear here after calls end.</small></div>';
      return;
    }

    // Filter by search query client-side (Twilio doesn't support full text search)
    const q = archState.query.toLowerCase();
    const filtered = q
      ? recordings.filter(r => r.from.includes(q) || r.to.includes(q))
      : recordings;

    list.innerHTML = '';
    filtered.forEach(r => {
      const ts  = new Date(r.startTime);
      const dur = fmtDur(r.duration);
      const row = document.createElement('div');
      row.className = 'arch-rec-row';
      row.dataset.sid = r.sid;
      row.innerHTML = `
        <div class="arch-rec-icon">▶</div>
        <div class="arch-rec-info">
          <div class="arch-rec-parties">${escHtml(r.from)} → ${escHtml(r.to)}</div>
          <div class="arch-rec-meta">${ts.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})} ${ts.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · SID: ${r.sid.slice(0,16)}…</div>
        </div>
        <div class="arch-rec-dur">${dur}</div>
      `;
      row.onclick = () => playRecording(r, row);
      list.appendChild(row);
    });
  } catch (e) {
    list.innerHTML = `<div class="arch-empty">Failed to load recordings.<br><small>${e.message}</small></div>`;
  }
}

function playRecording(r, rowEl) {
  const player  = $('archPlayer');
  const audio   = $('archAudio');
  const label   = $('archPlayerLabel');
  if (!player || !audio) return;

  // Deselect previous
  document.querySelectorAll('.arch-rec-row').forEach(r => r.classList.remove('playing'));
  rowEl.classList.add('playing');

  const ts = new Date(r.startTime);
  label.textContent = `${r.from} → ${r.to}  ·  ${ts.toLocaleDateString('en-GB')}  ·  ${fmtDur(r.duration)}`;

  audio.src = r.audioUrl;
  player.classList.remove('hidden');
  audio.play().catch(() => {}); // autoplay may require user gesture — fine
}

function fmtDur(s) {
  s = parseInt(s || 0);
  const m = Math.floor(s / 60), sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ============================================================
   BOOT
============================================================ */
let _appBooted = false;
window.bootApp = async function() {
  if (_appBooted) return;
  _appBooted = true;

  // Nav theme button
  const themeBtnNav = $('themeBtnNav');
  if (themeBtnNav) {
    themeBtnNav.addEventListener('click', () => {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      applyTheme(!isLight);
    });
  }

  // Nav profile button — toggle dropdown
  const navProfileBtn = $('navProfileBtn');
  const profileDropdown = $('profileDropdown');
  if (navProfileBtn && profileDropdown) {
    navProfileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      profileDropdown.classList.toggle('hidden');
    });
    // Close on outside click
    document.addEventListener('click', () => profileDropdown.classList.add('hidden'));
  }

  // Dropdown logout
  const pdLogout = $('pdLogout');
  pdLogout && pdLogout.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.href = '/login';
  });

  // Load profile into nav dropdown (including avatar photo)
  async function loadProfileIntoNav() {
    try {
      const res = await fetch('/api/profile');
      if (!res.ok) return;
      const p = await res.json();
      const name = p.username || 'Agent';
      const num  = p.phoneNumber || '—';
      window._profileName = name;
      const initials = name[0].toUpperCase();
      const color    = `hsl(${name.charCodeAt(0) * 7 % 360},45%,40%)`;

      // Nav small avatar
      const navAv = $('navProfileAvatar');
      if (navAv) {
        if (p.avatar) {
          navAv.innerHTML = `<img src="${p.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
        } else {
          navAv.textContent = initials;
          navAv.style.background = color;
        }
      }

      // Dropdown big avatar
      const bigAv = $('pdBigAvatar');
      if (bigAv) {
        if (p.avatar) {
          bigAv.innerHTML = `<img src="${p.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
          bigAv.style.background = 'transparent';
        } else {
          bigAv.innerHTML = initials;
          bigAv.style.background = color;
        }
      }

      const pdName = $('pdName'), pdNum = $('pdNumber');
      if (pdName) pdName.textContent = name;
      if (pdNum)  pdNum.textContent  = num;

      // Settings panel avatar if open
      const profileAvatar = $('profileAvatar');
      if (profileAvatar) {
        if (p.avatar) {
          profileAvatar.innerHTML = `<img src="${p.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
        } else {
          profileAvatar.textContent = initials;
          profileAvatar.style.background = color;
        }
      }
      const profileName   = $('profileName');
      const profileNumber = $('profileNumber');
      if (profileName)   profileName.textContent   = name;
      if (profileNumber) profileNumber.textContent = num;
    } catch(_) {}
  }

  await loadProfileIntoNav();

  // Avatar upload — click the big avatar in the dropdown
  const pdAvatarWrap  = $('pdAvatarWrap');
  const avatarFileInput = $('avatarFileInput');
  if (pdAvatarWrap && avatarFileInput) {
    pdAvatarWrap.addEventListener('click', (e) => {
      e.stopPropagation(); // don't close dropdown
      avatarFileInput.click();
    });
    avatarFileInput.addEventListener('change', async () => {
      const file = avatarFileInput.files[0];
      if (!file) return;

      // Resize client-side to max 200x200 before uploading
      const resized = await resizeImage(file, 200);

      const form = new FormData();
      form.append('avatar', resized, 'avatar.jpg');

      showToast('Uploading photo…', 'info');
      try {
        const res = await fetch('/api/profile/avatar', { method: 'POST', body: form });
        if (!res.ok) throw new Error('Upload failed');
        showToast('Profile photo updated ✓', 'success');
        await loadProfileIntoNav();
      } catch (err) {
        showToast('Upload failed: ' + err.message, 'error');
      }
      avatarFileInput.value = ''; // reset so same file can be re-selected
    });
  }

  connectWS();
  await loadHistory();
  await initTwilio();
  await loadContacts();
  await checkFeatures();
  console.log('[App] Ready');
};
