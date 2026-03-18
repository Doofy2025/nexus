'use strict';

require('dotenv').config();

const express     = require('express');
const http        = require('http');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const { closePool } = require('./db/pool');
const logger      = require('./utils/logger');

const app    = express();
const server = http.createServer(app);

/* ── Security headers ───────────────────────────────────────────── */
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

/* ── CORS ───────────────────────────────────────────────────────── */
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',').map(s => s.trim());

app.use(cors({
  origin: (origin, cb) =>
    (!origin || allowedOrigins.includes(origin)) ? cb(null, true) : cb(new Error('CORS blocked')),
  credentials:    true,
  methods:        ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Agent-Token'],
}));
app.options('*', cors());

/* ── Body / compression ─────────────────────────────────────────── */
app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

/* ── Request logger ─────────────────────────────────────────────── */
app.use((req, _res, next) => {
  logger.info(`-> ${req.method} ${req.path}`, { ip: req.ip });
  next();
});

/* ── Rate limiters ──────────────────────────────────────────────── */
app.use('/api/', rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.API_RATE_MAX) || 500,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Rate limit exceeded.' },
}));

app.use('/api/auth/login', rateLimit({
  windowMs: parseInt(process.env.LOGIN_RATE_WINDOW_MS) || 900_000,
  max:      parseInt(process.env.LOGIN_RATE_MAX)        || 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
}));

/* ════════════════════════════════════════════════════════════════
   PHASE 1 — Core
   ════════════════════════════════════════════════════════════════ */
app.use('/api/auth',    require('./routes/auth'));
app.use('/api/users',   require('./routes/users'));
app.use('/api/tenants', require('./routes/tenants'));
app.use('/api/sites',   require('./routes/sites'));
app.use('/api/audit',   require('./routes/audit'));
app.use('/api/agent',   require('./routes/agent'));

/* ════════════════════════════════════════════════════════════════
   PHASE 2A — Assets, Metrics, Logs
   ════════════════════════════════════════════════════════════════ */
app.use('/api/assets',  require('./routes/assets'));
app.use('/api/metrics', require('./routes/metrics'));   /* also serves /api/logs/* */

/* ════════════════════════════════════════════════════════════════
   PHASE 2B — Alerts, Incidents
   ════════════════════════════════════════════════════════════════ */
app.use('/api/alerts',    require('./routes/alerts'));
app.use('/api/incidents', require('./routes/incidents'));

/* ════════════════════════════════════════════════════════════════
   PHASE 3 — Automation, Compliance, Certificates
   ════════════════════════════════════════════════════════════════ */
app.use('/api/automation',   require('./routes/automation'));
app.use('/api/compliance',   require('./routes/compliance'));
app.use('/api/certificates', require('./routes/certificates'));

/* ════════════════════════════════════════════════════════════════
   PHASE 4 — Cloud, Mobile, Integrations, Dashboards, Reports
   ════════════════════════════════════════════════════════════════ */
app.use('/api/cloud',        require('./routes/cloud'));
app.use('/api/mobile',       require('./routes/mobile'));
app.use('/api/integrations', require('./routes/integrations'));
app.use('/api/dashboards',   require('./routes/dashboards'));   /* also serves /api/dashboards/reports/* */

/* ── Health ─────────────────────────────────────────────────────── */
app.get('/api/health', (_req, res) => res.json({
  status:    'ok',
  version:   '4.0.0',
  phase:     'complete',
  timestamp: new Date().toISOString(),
  routes: [
    '/api/auth','/api/users','/api/tenants','/api/sites','/api/audit','/api/agent',
    '/api/assets','/api/metrics','/api/logs',
    '/api/alerts','/api/incidents',
    '/api/automation','/api/compliance','/api/certificates',
    '/api/cloud','/api/mobile','/api/integrations',
    '/api/dashboards','/api/dashboards/reports',
    '/ws',
  ],
}));

/* ── 404 ────────────────────────────────────────────────────────── */
app.use((_req, res) => res.status(404).json({ error: 'Route not found.' }));

/* ── Global error handler ───────────────────────────────────────── */
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error('Unhandled', { message: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error.' });
});

/* ── Start ──────────────────────────────────────────────────────── */
const PORT = parseInt(process.env.PORT) || 3001;

server.listen(PORT, () => {
  logger.info(`Vanguard OS API  |  COMPLETE  |  port ${PORT}`);
  logger.info(`  ENV  : ${process.env.NODE_ENV || 'development'}`);
  logger.info(`  CORS : ${allowedOrigins.join(', ')}`);

  /* WebSocket server — attaches to same HTTP server on /ws */
  require('./websocket/ws').startWebSocketServer(server);
  logger.info('  WS   : /ws ready');

  /* Background services */
  require('./services/metricsRetention').startRetentionJob();
  logger.info('  CRON : metrics retention job scheduled');
});

/* ── Graceful shutdown ──────────────────────────────────────────── */
const shutdown = async (sig) => {
  logger.info(`${sig} -- shutting down`);
  server.close(async () => { await closePool(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = { app, server };
