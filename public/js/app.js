/* ============================================================
   UNIFIED SOFTPHONE — FRONTEND APPLICATION
   ============================================================ */
'use strict';

// ── State ───────────────────────────────────────────────────
const state = {
  conversations: {},   // phone → { phone, name, channel, messages[], unread, lastTs }
  contacts: [],
  activePhone: null,
  activeChannel: 'whatsapp',
  twilioDevice: null,
  activeCall: null,
  callTimer: null,
  callSeconds: 0,
  ws: null,
  wsReconnectTimer: null,
  filter: 'all',
};

// ── DOM ─────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const els = {
  convList:         $('convList'),
  convSearch:       $('convSearch'),
  messages:         $('messages'),
  chatView:         $('chatView'),
  noChat:           $('noChat'),
  chatName:         $('chatName'),
  chatStatus:       $('chatStatus'),
  chatAvatar:       $('chatAvatar'),
  channelSelector:  $('channelSelector'),
  composeInput:     $('composeInput'),
  sendBtn:          $('sendBtn'),
  btnCall:          $('btnCall'),

  // Dialpad
  dialInput:        $('dialInput'),
  btnDialCall:      $('btnDialCall'),
  btnDelDigit:      $('btnDelDigit'),

  // Active call
  activeCallSection:$('activeCallSection'),
  callName:         $('callName'),
  callNumber:       $('callNumber'),
  callDuration:     $('callDuration'),
  btnMute:          $('btnMute'),
  btnHold:          $('btnHold'),
  btnEndCall:       $('btnEndCall'),

  // Modals
  incomingModal:    $('incomingModal'),
  incomingFrom:     $('incomingFrom'),
  btnAccept:        $('btnAccept'),
  btnReject:        $('btnReject'),
  newConvModal:     $('newConvModal'),
  newConvPhone:     $('newConvPhone'),
  newConvName:      $('newConvName'),
  newConvCancel:    $('newConvCancel'),
  newConvConfirm:   $('newConvConfirm'),
  addContactModal:  $('addContactModal'),
  contactNameInput: $('contactNameInput'),
  contactPhoneInput:$('contactPhoneInput'),
  contactNotesInput:$('contactNotesInput'),
  addContactCancel: $('addContactCancel'),
  addContactConfirm:$('addContactConfirm'),
  addContactBtn:    $('addContactBtn'),

  // Status
  sTwilio:          $('sTwilio'),
  sWA:              $('sWA'),
  sServer:          $('sServer'),
  connStatus:       $('connStatus'),
  pilTwilio:        $('pilTwilio'),
  pilWS:            $('pilWS'),
  contactList:      $('contactList'),
  contactSearch:    $('contactSearch'),
  newConvBtn:       $('newConvBtn'),
  unreadBadge:      $('unreadBadge'),
};

// ── Colour palette for avatars ───────────────────────────────
const AVATAR_COLORS = [
  '#2d6a4f','#7b2d8b','#3a4a6b','#6b3a1a',
  '#1a4a6b','#4a2d6b','#2d4a6b','#6b2d3a',
];
function avatarColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function initials(name) {
  const parts = name.trim().split(' ');
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

// ── WebSocket ─────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${location.host}/ws`;
  const ws = new WebSocket(wsUrl);
  state.ws = ws;

  ws.onopen = () => {
    console.log('[WS] Connected');
    setStatus('server', 'online');
    if (state.wsReconnectTimer) { clearTimeout(state.wsReconnectTimer); state.wsReconnectTimer = null; }
  };

  ws.onmessage = ({ data }) => {
    try {
      const msg = JSON.parse(data);
      handleServerEvent(msg);
    } catch (e) { console.error('[WS] Parse error', e); }
  };

  ws.onclose = () => {
    console.log('[WS] Disconnected — reconnecting in 3s');
    setStatus('server', 'offline');
    state.wsReconnectTimer = setTimeout(connectWS, 3000);
  };

  ws.onerror = (e) => console.error('[WS] Error', e);
}

function handleServerEvent(event) {
  switch (event.type) {
    case 'inbound_sms':
      receiveMessage(event.from, {
        id: event.sid,
        body: event.body,
        direction: 'in',
        channel: 'sms',
        ts: event.timestamp,
      }, event.from);
      showToast(`📱 SMS from ${event.from}`, 'info');
      break;

    case 'inbound_whatsapp':
      receiveMessage(event.from, {
        id: event.waId,
        body: event.body,
        direction: 'in',
        channel: 'whatsapp',
        ts: event.timestamp,
      }, event.profileName || event.from);
      showToast(`💬 WhatsApp from ${event.profileName || event.from}`, 'info');
      break;

    case 'outbound_sms':
    case 'outbound_whatsapp':
      // Sync to other open tabs
      receiveMessage(event.to, {
        id: event.sid || event.waId,
        body: event.body,
        direction: 'out',
        channel: event.channel,
        ts: event.timestamp,
      }, null, true);
      break;

    case 'inbound_call':
      showIncomingCall(event.from, event.callSid);
      break;

    case 'call_status':
      handleCallStatus(event);
      break;

    case 'whatsapp_status':
      // Could update message ticks (sent/delivered/read) here
      break;
  }
}

// ── Twilio Device ─────────────────────────────────────────────
async function initTwilio() {
  try {
    setStatus('twilio', 'connecting');
    const res = await fetch('/api/token?identity=softphone-agent');
    if (!res.ok) throw new Error('Token fetch failed');
    const { token } = await res.json();

    const device = new Twilio.Device(token, {
      codecPreferences: ['opus', 'pcmu'],
      fakeLocalDTMF: true,
      enableRingingState: true,
    });

    device.on('ready', () => {
      console.log('[Twilio] Device ready');
      setStatus('twilio', 'online');
    });

    device.on('error', (err) => {
      console.error('[Twilio] Device error', err);
      setStatus('twilio', 'offline');
      showToast(`Twilio error: ${err.message}`, 'error');
    });

    device.on('incoming', (conn) => {
      const from = conn.parameters.From || 'Unknown';
      showIncomingCall(from, null, conn);
    });

    device.on('disconnect', () => {
      endCallUI();
    });

    device.on('offline', () => setStatus('twilio', 'offline'));
    device.on('cancel', () => {
      els.incomingModal.classList.add('hidden');
    });

    // Refresh token before it expires (55 minutes)
    setTimeout(initTwilio, 55 * 60 * 1000);

    state.twilioDevice = device;
  } catch (err) {
    console.error('[Twilio] Init error:', err);
    setStatus('twilio', 'offline');
    showToast('Could not connect Twilio Voice. Check your config.', 'error');
    setTimeout(initTwilio, 10_000);
  }
}

// ── Calling ───────────────────────────────────────────────────
let pendingIncomingConn = null;

function showIncomingCall(from, callSid, conn) {
  pendingIncomingConn = conn || null;
  els.incomingFrom.textContent = lookupName(from) || from;
  els.incomingModal.classList.remove('hidden');

  // Auto-reject after 30s
  const timer = setTimeout(() => {
    els.incomingModal.classList.add('hidden');
    if (pendingIncomingConn) pendingIncomingConn.reject();
  }, 30_000);
  els.btnAccept._timer = timer;
}

els.btnAccept.addEventListener('click', () => {
  clearTimeout(els.btnAccept._timer);
  els.incomingModal.classList.add('hidden');
  if (pendingIncomingConn) {
    pendingIncomingConn.accept();
    state.activeCall = pendingIncomingConn;
    startCallUI(els.incomingFrom.textContent);
    setupCallEvents(pendingIncomingConn);
  }
  pendingIncomingConn = null;
});

els.btnReject.addEventListener('click', () => {
  clearTimeout(els.btnAccept._timer);
  els.incomingModal.classList.add('hidden');
  if (pendingIncomingConn) pendingIncomingConn.reject();
  pendingIncomingConn = null;
});

els.btnDialCall.addEventListener('click', () => {
  const to = els.dialInput.value.trim();
  if (!to) return;
  if (!state.twilioDevice) return showToast('Twilio not connected', 'error');
  makeCall(to);
});

function makeCall(to) {
  if (!state.twilioDevice) return showToast('Twilio Voice not ready', 'error');
  try {
    const conn = state.twilioDevice.connect({ To: to });
    state.activeCall = conn;
    const name = lookupName(to) || to;
    startCallUI(name, to);
    setupCallEvents(conn);

    // Add to conversation list as a voice event
    ensureConversation(to, name, 'voice');
    addMessageToConv(to, {
      body: `📞 Outbound call`,
      direction: 'out',
      channel: 'voice',
      ts: new Date().toISOString(),
    });
  } catch (err) {
    showToast(`Call failed: ${err.message}`, 'error');
  }
}

function setupCallEvents(conn) {
  conn.on('disconnect', endCallUI);
  conn.on('cancel', endCallUI);
  conn.on('error', (err) => showToast(`Call error: ${err.message}`, 'error'));
}

function startCallUI(name, number) {
  els.callName.textContent = name;
  els.callNumber.textContent = number || '';
  els.activeCallSection.style.display = 'block';
  state.callSeconds = 0;
  state.callTimer = setInterval(() => {
    state.callSeconds++;
    const m = Math.floor(state.callSeconds / 60).toString().padStart(2, '0');
    const s = (state.callSeconds % 60).toString().padStart(2, '0');
    els.callDuration.textContent = `${m}:${s}`;
  }, 1000);
}

function endCallUI() {
  clearInterval(state.callTimer);
  state.callTimer = null;
  state.activeCall = null;
  els.activeCallSection.style.display = 'none';
  els.callDuration.textContent = '00:00';
}

function handleCallStatus(event) {
  if (['completed', 'failed', 'busy', 'no-answer'].includes(event.status)) {
    endCallUI();
    const phone = event.to || event.from;
    if (phone) {
      addMessageToConv(phone, {
        body: `📞 Call ${event.status}${event.duration ? ` · ${formatDuration(event.duration)}` : ''}`,
        direction: event.direction === 'inbound' ? 'in' : 'out',
        channel: 'voice',
        ts: event.timestamp,
      });
    }
  }
}

els.btnMute.addEventListener('click', () => {
  if (!state.activeCall) return;
  const muted = !state.activeCall.isMuted();
  state.activeCall.mute(muted);
  els.btnMute.classList.toggle('active', muted);
  els.btnMute.textContent = muted ? '🔇' : '🎤';
});

els.btnHold.addEventListener('click', () => {
  showToast('Hold requires server-side Twilio REST call — see docs', 'info');
});

els.btnEndCall.addEventListener('click', () => {
  if (state.activeCall) state.activeCall.disconnect();
  endCallUI();
});

// ── Dialpad ───────────────────────────────────────────────────
document.querySelectorAll('.key[data-digit]').forEach(btn => {
  btn.addEventListener('click', () => {
    els.dialInput.value += btn.dataset.digit;
    if (state.activeCall) state.activeCall.sendDigits(btn.dataset.digit);
  });
});
els.btnDelDigit.addEventListener('click', () => {
  els.dialInput.value = els.dialInput.value.slice(0, -1);
});

// ── Messaging ─────────────────────────────────────────────────
els.sendBtn.addEventListener('click', sendMessage);
els.composeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// Auto-resize textarea
els.composeInput.addEventListener('input', () => {
  els.composeInput.style.height = 'auto';
  els.composeInput.style.height = els.composeInput.scrollHeight + 'px';
});

async function sendMessage() {
  const body = els.composeInput.value.trim();
  const phone = state.activePhone;
  if (!body || !phone) return;

  els.composeInput.value = '';
  els.composeInput.style.height = 'auto';
  els.sendBtn.disabled = true;

  const channel = state.activeChannel;
  const msg = { body, direction: 'out', channel, ts: new Date().toISOString(), pending: true };
  const msgId = addMessageToConv(phone, msg);

  try {
    let res;
    if (channel === 'whatsapp') {
      res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: phone, body }),
      });
    } else {
      res = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: phone, body }),
      });
    }

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    // Mark delivered
    markMsgSent(phone, msgId);
  } catch (err) {
    showToast(`Send failed: ${err.message}`, 'error');
    markMsgFailed(phone, msgId);
  } finally {
    els.sendBtn.disabled = false;
    els.composeInput.focus();
  }
}

// ── Conversation Management ────────────────────────────────────
function ensureConversation(phone, name, channel = 'whatsapp') {
  if (!state.conversations[phone]) {
    state.conversations[phone] = {
      phone,
      name: name || lookupName(phone) || phone,
      channel,
      messages: [],
      unread: 0,
      lastTs: new Date().toISOString(),
      lastBody: '',
    };
  } else {
    if (name && name !== phone) state.conversations[phone].name = name;
    if (channel !== 'voice') state.conversations[phone].channel = channel;
  }
  return state.conversations[phone];
}

let _msgCounter = 0;
function addMessageToConv(phone, msg) {
  const conv = ensureConversation(phone, null, msg.channel);
  msg._id = msg._id || `m_${++_msgCounter}`;
  conv.messages.push(msg);
  conv.lastTs = msg.ts;
  conv.lastBody = msg.body;

  if (msg.direction === 'in' && phone !== state.activePhone) {
    conv.unread++;
    updateUnreadBadge();
  }

  renderConvList();

  if (phone === state.activePhone) {
    appendMessageBubble(msg);
    scrollToBottom();
  }

  return msg._id;
}

function markMsgSent(phone, msgId) {
  const conv = state.conversations[phone];
  if (!conv) return;
  const msg = conv.messages.find(m => m._id === msgId);
  if (msg) { delete msg.pending; }
  // Could update bubble tick here
}

function markMsgFailed(phone, msgId) {
  const conv = state.conversations[phone];
  if (!conv) return;
  const msg = conv.messages.find(m => m._id === msgId);
  if (msg) { msg.failed = true; }
}

function receiveMessage(phone, msg, profileName, isSync = false) {
  ensureConversation(phone, profileName, msg.channel);
  addMessageToConv(phone, msg);
}

// ── Render ─────────────────────────────────────────────────────
function renderConvList() {
  const q = els.convSearch.value.toLowerCase();
  const filter = state.filter;

  let convs = Object.values(state.conversations)
    .filter(c => {
      if (q && !c.name.toLowerCase().includes(q) && !c.phone.includes(q)) return false;
      if (filter !== 'all' && c.channel !== filter) return false;
      return true;
    })
    .sort((a, b) => new Date(b.lastTs) - new Date(a.lastTs));

  if (!convs.length) {
    els.convList.innerHTML = '<div class="empty-state">No conversations match your filter.</div>';
    return;
  }

  els.convList.innerHTML = '';
  convs.forEach(conv => {
    const div = document.createElement('div');
    div.className = 'conv-item' + (conv.phone === state.activePhone ? ' active' : '');
    div.dataset.phone = conv.phone;

    const dotClass = { whatsapp: 'dot-wa', sms: 'dot-sms', voice: 'dot-voice' }[conv.channel] || 'dot-wa';
    const dotLabel = { whatsapp: 'W', sms: 'S', voice: 'C' }[conv.channel] || '?';
    const color = avatarColor(conv.name);
    const ini = initials(conv.name);
    const timeStr = formatTime(conv.lastTs);

    div.innerHTML = `
      <div class="avatar" style="background:${color}">
        ${ini}<div class="ch-dot ${dotClass}">${dotLabel}</div>
      </div>
      <div class="conv-info">
        <div class="conv-name">${esc(conv.name)}</div>
        <div class="conv-preview">${esc(conv.lastBody || '—')}</div>
      </div>
      <div class="conv-meta">
        <div class="conv-time">${timeStr}</div>
        ${conv.unread ? `<div class="unread-pill">${conv.unread}</div>` : ''}
      </div>
    `;
    div.addEventListener('click', () => openConversation(conv.phone));
    els.convList.appendChild(div);
  });
}

function openConversation(phone) {
  state.activePhone = phone;
  const conv = state.conversations[phone];
  if (!conv) return;

  conv.unread = 0;
  updateUnreadBadge();

  // Update header
  const color = avatarColor(conv.name);
  const ini = initials(conv.name);
  els.chatAvatar.style.background = color;
  els.chatAvatar.textContent = ini;
  els.chatName.textContent = conv.name;
  els.chatStatus.textContent = `${phone} · ${conv.channel}`;
  els.btnCall.dataset.phone = phone;

  // Update channel selector
  state.activeChannel = conv.channel === 'voice' ? 'whatsapp' : conv.channel;
  updateChannelPills();
  updateComposePlaceholder();

  // Render messages
  els.messages.innerHTML = '';
  let lastDay = '';
  conv.messages.forEach(msg => {
    const day = new Date(msg.ts).toDateString();
    if (day !== lastDay) {
      lastDay = day;
      const div = document.createElement('div');
      div.className = 'day-divider';
      div.innerHTML = `<div class="day-line"></div><div class="day-text">${day.toUpperCase()}</div><div class="day-line"></div>`;
      els.messages.appendChild(div);
    }
    appendMessageBubble(msg);
  });

  els.noChat.classList.add('hidden');
  els.chatView.classList.remove('hidden');

  renderConvList();
  scrollToBottom();
  els.composeInput.focus();
}

function appendMessageBubble(msg) {
  if (msg.channel === 'voice') {
    const div = document.createElement('div');
    div.className = 'call-event';
    div.innerHTML = `<span>📞</span><span>${esc(msg.body)}</span>`;
    els.messages.appendChild(div);
    return;
  }

  const row = document.createElement('div');
  row.className = `msg-row ${msg.direction === 'out' ? 'out' : ''}`;
  row.dataset.msgId = msg._id;

  const tagClass = msg.channel === 'whatsapp' ? 'tag-wa' : 'tag-sms';
  const tagLabel = msg.channel === 'whatsapp' ? 'WhatsApp' : 'SMS';
  const bubbleClass = msg.direction === 'out' ? 'out' : 'in';
  const timeStr = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  row.innerHTML = `
    <div>
      ${msg.direction === 'in' ? `<div style="margin-left:4px;margin-bottom:3px"><span class="ch-tag ${tagClass}">${tagLabel}</span></div>` : ''}
      ${msg.direction === 'out' ? `<div style="text-align:right;margin-right:4px;margin-bottom:3px"><span class="ch-tag ${tagClass}">${tagLabel}</span></div>` : ''}
      <div class="msg-bubble ${bubbleClass}">${esc(msg.body)}</div>
    </div>
    <div class="msg-time">${timeStr}</div>
  `;

  els.messages.appendChild(row);
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    els.messages.scrollTop = els.messages.scrollHeight;
  });
}

// ── Channel Selector ──────────────────────────────────────────
document.querySelectorAll('.ch-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    state.activeChannel = btn.dataset.channel;
    updateChannelPills();
    updateComposePlaceholder();
    if (state.activePhone && state.conversations[state.activePhone]) {
      state.conversations[state.activePhone].channel = state.activeChannel;
      els.chatStatus.textContent = `${state.activePhone} · ${state.activeChannel}`;
    }
  });
});

function updateChannelPills() {
  document.querySelectorAll('.ch-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.channel === state.activeChannel);
  });
}

function updateComposePlaceholder() {
  const ch = state.activeChannel === 'whatsapp' ? 'WhatsApp' : 'SMS';
  const name = state.activePhone ? (state.conversations[state.activePhone]?.name || state.activePhone) : '…';
  els.composeInput.placeholder = `Message ${name} via ${ch}…`;
}

// ── Filter tabs ───────────────────────────────────────────────
document.querySelectorAll('.filter-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.filter = btn.dataset.filter;
    renderConvList();
  });
});

// ── Search ────────────────────────────────────────────────────
els.convSearch.addEventListener('input', renderConvList);

// ── New Conversation ──────────────────────────────────────────
els.newConvBtn.addEventListener('click', () => {
  els.newConvModal.classList.remove('hidden');
  els.newConvPhone.focus();
});
els.newConvCancel.addEventListener('click', () => els.newConvModal.classList.add('hidden'));
els.newConvConfirm.addEventListener('click', () => {
  const phone = els.newConvPhone.value.trim();
  const name  = els.newConvName.value.trim() || phone;
  if (!phone) return showToast('Enter a phone number', 'error');
  els.newConvModal.classList.add('hidden');
  els.newConvPhone.value = '';
  els.newConvName.value = '';
  ensureConversation(phone, name, 'whatsapp');
  renderConvList();
  openConversation(phone);
});

// ── Call from chat header ─────────────────────────────────────
els.btnCall.addEventListener('click', () => {
  const phone = state.activePhone;
  if (!phone) return;
  makeCall(phone);
});

// ── Sidebar view switching ─────────────────────────────────────
document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    document.getElementById('convPanel').classList.toggle('hidden', view !== 'conversations');
    document.getElementById('contactsPanel').classList.toggle('hidden', view !== 'contacts');
    if (view === 'contacts') loadContacts();
  });
});

// ── Contacts ──────────────────────────────────────────────────
async function loadContacts() {
  try {
    const res = await fetch('/api/contacts');
    state.contacts = await res.json();
    renderContacts();
  } catch (e) {
    console.error('[Contacts] Load error', e);
  }
}

function renderContacts() {
  const q = els.contactSearch.value.toLowerCase();
  const contacts = state.contacts.filter(c =>
    !q || c.name.toLowerCase().includes(q) || c.phone.includes(q)
  );
  els.contactList.innerHTML = '';
  if (!contacts.length) {
    els.contactList.innerHTML = '<div class="empty-state">No contacts yet.</div>';
    return;
  }
  contacts.forEach(c => {
    const div = document.createElement('div');
    div.className = 'conv-item';
    const color = avatarColor(c.name);
    div.innerHTML = `
      <div class="avatar" style="background:${color}">${initials(c.name)}</div>
      <div class="conv-info">
        <div class="conv-name">${esc(c.name)}</div>
        <div class="conv-preview">${esc(c.phone)}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="key" style="width:30px;height:30px;font-size:13px" title="Message" data-action="msg" data-phone="${c.phone}" data-name="${esc(c.name)}">💬</button>
        <button class="key" style="width:30px;height:30px;font-size:13px" title="Call" data-action="call" data-phone="${c.phone}" data-name="${esc(c.name)}">📞</button>
      </div>
    `;
    div.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.dataset.action === 'call') {
          makeCall(btn.dataset.phone);
        } else {
          ensureConversation(btn.dataset.phone, btn.dataset.name, 'whatsapp');
          renderConvList();
          document.querySelector('.nav-btn[data-view="conversations"]').click();
          openConversation(btn.dataset.phone);
        }
      });
    });
    els.contactList.appendChild(div);
  });
}

els.contactSearch.addEventListener('input', renderContacts);

els.addContactBtn.addEventListener('click', () => {
  els.addContactModal.classList.remove('hidden');
  els.contactNameInput.focus();
});
els.addContactCancel.addEventListener('click', () => els.addContactModal.classList.add('hidden'));
els.addContactConfirm.addEventListener('click', async () => {
  const name = els.contactNameInput.value.trim();
  const phone = els.contactPhoneInput.value.trim();
  const notes = els.contactNotesInput.value.trim();
  if (!name || !phone) return showToast('Name and phone required', 'error');
  try {
    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, notes }),
    });
    if (!res.ok) throw new Error();
    els.addContactModal.classList.add('hidden');
    els.contactNameInput.value = '';
    els.contactPhoneInput.value = '';
    els.contactNotesInput.value = '';
    showToast('Contact saved ✓', 'success');
    await loadContacts();
  } catch {
    showToast('Could not save contact', 'error');
  }
});

// ── Status helpers ────────────────────────────────────────────
function setStatus(service, state) {
  const map = { online: '🟢 Connected', offline: '🔴 Offline', connecting: '🟡 Connecting' };
  if (service === 'twilio') {
    els.sTwilio.textContent = map[state] || state;
    if (els.pilTwilio) els.pilTwilio.textContent = `${state === 'online' ? '🟢' : state === 'connecting' ? '🟡' : '🔴'} Twilio ${state}`;
  }
  if (service === 'server') {
    els.sServer.textContent = map[state] || state;
    const dot = els.connStatus.querySelector('.conn-dot');
    dot.className = 'conn-dot ' + state;
    if (els.pilWS) els.pilWS.textContent = `${state === 'online' ? '🟢' : '🔴'} Server ${state}`;
  }
}

// WhatsApp is always "ready" as it's server-side
els.sWA.textContent = '🟢 Ready';

// ── Unread badge ──────────────────────────────────────────────
function updateUnreadBadge() {
  const total = Object.values(state.conversations).reduce((s, c) => s + c.unread, 0);
  els.unreadBadge.classList.toggle('hidden', !total);
  els.unreadBadge.textContent = total > 9 ? '9+' : String(total);
}

// ── Lookup contact name ───────────────────────────────────────
function lookupName(phone) {
  const c = state.contacts.find(c => c.phone === phone);
  return c?.name || null;
}

// ── Utility ───────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const diff = now - d;
  if (diff < 7 * 86400_000) {
    return d.toLocaleDateString([], { weekday: 'short' });
  }
  return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

let _toastTimer;
function showToast(msg, type = 'info') {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.textContent = msg;
  document.body.appendChild(div);
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => div.remove(), 4000);
}

// ── Browser notifications ─────────────────────────────────────
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}

function notify(title, body) {
  if (Notification.permission === 'granted' && document.hidden) {
    new Notification(title, { body, icon: '/favicon.ico' });
  }
}

// ── Boot ──────────────────────────────────────────────────────
(async () => {
  connectWS();
  await initTwilio();
  await loadContacts();
  renderConvList();
  console.log('[App] Ready');
})();

// ── bootApp (called by setup.js after config confirmed) ───────
let _appBooted = false;
window.bootApp = async function bootApp() {
  if (_appBooted) return;
  _appBooted = true;
  // Override the auto-boot above if it already ran — idempotent
};

// Mobile: hook settings panel load
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll?.('.nav-btn[data-view]')?.forEach(btn => {
    if (btn.dataset.view === 'settings') {
      btn.addEventListener('click', () => {
        if (typeof loadSettingsPanel === 'function') loadSettingsPanel();
      });
    }
  });
});
