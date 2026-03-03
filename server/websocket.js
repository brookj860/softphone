'use strict';
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

let wss;
const clients = new Map(); // clientId → ws

function initWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const clientId = uuidv4();
    clients.set(clientId, ws);
    ws.clientId = clientId;
    ws.isAlive = true;

    console.log(`[WS] Client connected: ${clientId} (total: ${clients.size})`);

    // Send connection confirmation
    send(ws, { type: 'connected', clientId });

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleClientMessage(ws, msg);
      } catch (e) {
        console.error('[WS] Bad message:', e.message);
      }
    });

    ws.on('close', () => {
      clients.delete(clientId);
      console.log(`[WS] Client disconnected: ${clientId} (total: ${clients.size})`);
    });

    ws.on('error', (err) => {
      console.error(`[WS] Error on ${clientId}:`, err.message);
    });
  });

  // Heartbeat every 30s
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        clients.delete(ws.clientId);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30_000);

  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}

function handleClientMessage(ws, msg) {
  // Clients can send { type: 'ping' } to keep alive
  if (msg.type === 'ping') {
    send(ws, { type: 'pong' });
  }
}

function send(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// Broadcast an event to ALL connected clients
function broadcast(data) {
  const payload = JSON.stringify(data);
  clients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  });
}

module.exports = { initWebSocket, broadcast, send };
