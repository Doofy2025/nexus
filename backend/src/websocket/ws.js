'use strict';

/**
 * Vanguard OS — WebSocket Server
 *
 * Provides real-time push to connected frontend clients.
 * Clients authenticate with the same JWT used for the REST API.
 *
 * Message types broadcast:
 *   alert:new          — new alert fired
 *   alert:updated      — alert ack / resolve / suppress
 *   asset:status       — asset status changed
 *   asset:heartbeat    — agent heartbeat received
 *   incident:new       — new incident created
 *   incident:updated   — incident status changed
 *   metric:snapshot    — live metric snapshot (throttled)
 *   system:ping        — keepalive
 *
 * Client sends:
 *   { type: 'auth', token: '<jwt>' }   — must be first message
 *   { type: 'subscribe', topics: [] }  — optional topic filter
 *   { type: 'ping' }                   — keepalive
 */

const WebSocket = require('ws');
const jwt       = require('jsonwebtoken');
const crypto    = require('crypto');
const logger    = require('../utils/logger');
const { getPool, sql } = require('../db/pool');

/* ── module-level broadcast function ─────────────────────────────
   Set during startWebSocketServer() so other modules can call
   broadcast() without circular-require issues.                   */
let _broadcast = () => {};

function broadcast(type, payload, tenantId) {
  _broadcast(type, payload, tenantId);
}

/* ── server factory ──────────────────────────────────────────── */
function startWebSocketServer(httpServer) {
  const wss = new WebSocket.Server({ server: httpServer, path: '/ws' });
  logger.info('WebSocket server attached to /ws');

  /* connected client registry: Map<ws, { userId, tenantId, topics }> */
  const clients = new Map();

  /* ── connection handler ────────────────────────────────────── */
  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    logger.info('WS: new connection', { ip });

    let authTimeout = setTimeout(() => {
      if (!clients.has(ws)) {
        logger.warn('WS: auth timeout — closing');
        ws.terminate();
      }
    }, 10_000);

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      /* ── auth ──────────────────────────────────────────────── */
      if (msg.type === 'auth') {
        clearTimeout(authTimeout);
        if (!msg.token) { ws.send(JSON.stringify({ type: 'auth:error', error: 'Token required.' })); return ws.terminate(); }
        try {
          const decoded = jwt.verify(msg.token, process.env.JWT_SECRET);

          /* Verify session not revoked */
          const pool      = await getPool();
          const tokenHash = crypto.createHash('sha256').update(msg.token).digest('hex');
          const sess = await pool.request()
            .input('uid',  sql.UniqueIdentifier, decoded.userId)
            .input('hash', sql.NVarChar,         tokenHash)
            .query(`SELECT 1 FROM sessions WHERE user_id=@uid AND token_hash=@hash AND is_revoked=0 AND expires_at>GETUTCDATE()`);

          if (!sess.recordset.length) {
            ws.send(JSON.stringify({ type: 'auth:error', error: 'Session expired.' }));
            return ws.terminate();
          }

          clients.set(ws, {
            userId:   decoded.userId,
            tenantId: decoded.tenantId,
            role:     decoded.role,
            topics:   new Set(['alert:new','alert:updated','asset:status','incident:new','incident:updated','system:ping']),
            ip,
          });

          ws.send(JSON.stringify({ type: 'auth:ok', userId: decoded.userId, tenantId: decoded.tenantId }));
          logger.info('WS: authenticated', { userId: decoded.userId, tenantId: decoded.tenantId });
        } catch (err) {
          ws.send(JSON.stringify({ type: 'auth:error', error: 'Invalid token.' }));
          ws.terminate();
        }
        return;
      }

      /* All other messages require auth */
      const client = clients.get(ws);
      if (!client) return;

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', ts: new Date().toISOString() }));
        return;
      }

      if (msg.type === 'subscribe' && Array.isArray(msg.topics)) {
        const allowed = new Set([
          'alert:new','alert:updated','asset:status','asset:heartbeat',
          'incident:new','incident:updated','metric:snapshot','system:ping',
        ]);
        msg.topics.filter(t => allowed.has(t)).forEach(t => client.topics.add(t));
        ws.send(JSON.stringify({ type: 'subscribed', topics: [...client.topics] }));
        return;
      }

      if (msg.type === 'unsubscribe' && Array.isArray(msg.topics)) {
        msg.topics.forEach(t => client.topics.delete(t));
        ws.send(JSON.stringify({ type: 'unsubscribed', topics: msg.topics }));
        return;
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      logger.info('WS: client disconnected', { ip });
    });

    ws.on('error', (err) => {
      logger.warn('WS: socket error', { err: err.message });
      clients.delete(ws);
    });
  });

  /* ── keepalive ping every 30s ──────────────────────────────── */
  const pingInterval = setInterval(() => {
    wss.clients.forEach(ws => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.ping();
      ws.send(JSON.stringify({ type: 'system:ping', ts: new Date().toISOString() }));
    });
  }, 30_000);

  wss.on('close', () => clearInterval(pingInterval));

  /* ── internal broadcast implementation ─────────────────────── */
  _broadcast = (type, payload, tenantId) => {
    const msg = JSON.stringify({ type, payload, ts: new Date().toISOString() });
    let sent  = 0;

    for (const [ws, client] of clients.entries()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      /* Tenant isolation — super_admin sees all */
      if (tenantId && client.tenantId !== tenantId && client.role !== 'super_admin') continue;
      if (!client.topics.has(type)) continue;
      try { ws.send(msg); sent++; } catch {}
    }

    if (sent > 0) logger.info(`WS broadcast: ${type} → ${sent} client(s)`, { tenantId });
  };

  logger.info(`WebSocket server ready — ${wss.clients.size} clients`);
  return wss;
}

/* ══════════════════════════════════════════════════════════════════
   Convenience emitters — called from routes / services
   ══════════════════════════════════════════════════════════════════ */

function emitAlert(tenantId, alert) {
  broadcast('alert:new', alert, tenantId);
}

function emitAlertUpdated(tenantId, alertId, status, updatedBy) {
  broadcast('alert:updated', { alertId, status, updatedBy }, tenantId);
}

function emitAssetStatus(tenantId, assetId, status, name) {
  broadcast('asset:status', { assetId, status, name }, tenantId);
}

function emitHeartbeat(tenantId, assetId, snapshot) {
  broadcast('asset:heartbeat', { assetId, ...snapshot }, tenantId);
}

function emitIncident(tenantId, incident) {
  broadcast('incident:new', incident, tenantId);
}

function emitIncidentUpdated(tenantId, incidentId, status) {
  broadcast('incident:updated', { incidentId, status }, tenantId);
}

function emitMetricSnapshot(tenantId, assetId, snapshot) {
  broadcast('metric:snapshot', { assetId, ...snapshot }, tenantId);
}

module.exports = {
  startWebSocketServer,
  broadcast,
  emitAlert,
  emitAlertUpdated,
  emitAssetStatus,
  emitHeartbeat,
  emitIncident,
  emitIncidentUpdated,
  emitMetricSnapshot,
};
