'use strict';

/**
 * Vanguard OS — Metrics & Logs API  (Phase 2A)
 *
 * GET /api/metrics/live            live snapshot for all assets (dashboard)
 * GET /api/metrics/top             top-N assets by a given metric
 * GET /api/metrics/history         multi-asset metric history
 * GET /api/metrics/fleet           fleet-wide averages over time
 *
 * GET /api/logs                    tenant-wide log search
 * GET /api/logs/summary            log counts by severity (last 24h)
 * POST /api/logs/ingest            direct log ingest (non-agent sources)
 */

const router = require('express').Router();
const { getPool, sql }    = require('../db/pool');
const { authenticate, requireRole, tenantScope } = require('../middleware/auth');
const logger              = require('../utils/logger');

router.use(authenticate, tenantScope);

/* ══════════════════════════════════════════════════════════════════
   GET /api/metrics/live
   Latest snapshot for every managed online asset — powers the
   real-time dashboard grid.
   ══════════════════════════════════════════════════════════════════ */
router.get('/live', async (req, res) => {
  try {
    const pool = await getPool();
    const r    = await pool.request()
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`
        SELECT
          a.id, a.name, a.hostname, a.ip_address,
          a.asset_type, a.status, a.criticality, a.environment,
          a.last_seen, a.is_managed,
          s.id   AS site_id,
          s.name AS site_name,
          s.code AS site_code,
          ms.cpu_pct, ms.mem_pct, ms.disk_pct,
          ms.net_in_kbps, ms.net_out_kbps,
          ms.load_avg_1, ms.uptime_seconds, ms.process_count,
          ms.ts  AS snapshot_ts
        FROM assets a
        LEFT JOIN sites s ON a.site_id = s.id
        OUTER APPLY (
          SELECT TOP 1 *
          FROM metric_snapshots
          WHERE asset_id = a.id
          ORDER BY ts DESC
        ) ms
        WHERE a.tenant_id = @tid
          AND a.status != 'decommissioned'
        ORDER BY a.name
      `);
    return res.json(r.recordset);
  } catch (err) {
    logger.error('metrics live', { err: err.message });
    return res.status(500).json({ error: 'Failed to fetch live metrics.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/metrics/top
   Top N assets by a metric (cpu_pct, mem_pct, disk_pct, etc.)
   ?metric=cpu_pct&limit=10
   ══════════════════════════════════════════════════════════════════ */
router.get('/top', async (req, res) => {
  try {
    const ALLOWED_METRICS = new Set([
      'cpu_pct','mem_pct','disk_pct','net_in_kbps','net_out_kbps',
      'load_avg_1','load_avg_5','process_count',
    ]);
    const metric = req.query.metric || 'cpu_pct';
    const limit  = Math.min(50, parseInt(req.query.limit) || 10);

    if (!ALLOWED_METRICS.has(metric)) {
      return res.status(400).json({ error: `Invalid metric. Allowed: ${[...ALLOWED_METRICS].join(', ')}` });
    }

    const pool = await getPool();
    const r    = await pool.request()
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`
        SELECT TOP ${limit}
          a.id, a.name, a.hostname, a.asset_type, a.status, a.criticality,
          ms.${metric} AS value,
          ms.ts AS snapshot_ts
        FROM assets a
        OUTER APPLY (
          SELECT TOP 1 ${metric}, ts
          FROM metric_snapshots
          WHERE asset_id = a.id
          ORDER BY ts DESC
        ) ms
        WHERE a.tenant_id=@tid
          AND a.status != 'decommissioned'
          AND ms.${metric} IS NOT NULL
        ORDER BY ms.${metric} DESC
      `);
    return res.json({ metric, data: r.recordset });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch top metrics.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/metrics/history
   Time-series for one or more assets.
   ?assetIds=id1,id2&metric=cpu_pct&hours=24
   ══════════════════════════════════════════════════════════════════ */
router.get('/history', async (req, res) => {
  try {
    const ALLOWED_METRICS = new Set([
      'cpu_pct','mem_pct','disk_pct','net_in_kbps','net_out_kbps',
      'load_avg_1','load_avg_5','load_avg_15','process_count','uptime_seconds',
    ]);
    const { assetIds, metric = 'cpu_pct' } = req.query;
    const hours = Math.min(168, parseInt(req.query.hours) || 24);
    const limit = Math.min(5000, parseInt(req.query.limit) || 500);

    if (!ALLOWED_METRICS.has(metric)) {
      return res.status(400).json({ error: `Invalid metric.` });
    }
    if (!assetIds) return res.status(400).json({ error: 'assetIds required.' });

    const ids  = assetIds.split(',').slice(0, 20).map(s => s.trim());
    const pool = await getPool();

    const results = {};
    for (const aid of ids) {
      const r = await pool.request()
        .input('aid', sql.UniqueIdentifier, aid)
        .input('tid', sql.UniqueIdentifier, req.tenantId)
        .query(`
          SELECT TOP ${limit} ${metric} AS value, ts
          FROM metric_snapshots
          WHERE asset_id=@aid AND tenant_id=@tid
            AND ts > DATEADD(hour,-${hours},GETUTCDATE())
            AND ${metric} IS NOT NULL
          ORDER BY ts ASC
        `);
      results[aid] = r.recordset;
    }

    return res.json({ metric, hours, data: results });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch metric history.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/metrics/fleet
   Fleet-wide averages aggregated over time buckets.
   ?metric=cpu_pct&hours=24&buckets=24
   ══════════════════════════════════════════════════════════════════ */
router.get('/fleet', async (req, res) => {
  try {
    const ALLOWED_METRICS = new Set(['cpu_pct','mem_pct','disk_pct']);
    const metric  = req.query.metric || 'cpu_pct';
    const hours   = Math.min(168, parseInt(req.query.hours) || 24);

    if (!ALLOWED_METRICS.has(metric)) {
      return res.status(400).json({ error: `Invalid metric for fleet view.` });
    }

    const pool = await getPool();
    const r    = await pool.request()
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`
        SELECT
          DATEADD(hour, DATEDIFF(hour, 0, ts), 0) AS bucket,
          AVG(${metric})  AS avg_val,
          MAX(${metric})  AS max_val,
          MIN(${metric})  AS min_val,
          COUNT(DISTINCT asset_id) AS asset_count
        FROM metric_snapshots
        WHERE tenant_id=@tid
          AND ts > DATEADD(hour,-${hours},GETUTCDATE())
          AND ${metric} IS NOT NULL
        GROUP BY DATEADD(hour, DATEDIFF(hour, 0, ts), 0)
        ORDER BY bucket ASC
      `);
    return res.json({ metric, hours, data: r.recordset });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch fleet metrics.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/logs
   Tenant-wide log search with filters + pagination.
   ?severity=error&search=timeout&assetId=...&hours=24&page=1&limit=100
   ══════════════════════════════════════════════════════════════════ */
router.get('/logs', async (req, res) => {
  try {
    const pool     = await getPool();
    const {
      severity, search, assetId, source,
    } = req.query;
    const hours  = Math.min(168, parseInt(req.query.hours)  || 24);
    const limit  = Math.min(1000, parseInt(req.query.limit) || 100);
    const page   = Math.max(1,    parseInt(req.query.page)  || 1);
    const offset = (page - 1) * limit;

    let where   = `WHERE tenant_id=@tid AND ts > DATEADD(hour,-${hours},GETUTCDATE())`;
    const request = pool.request().input('tid', sql.UniqueIdentifier, req.tenantId);

    if (severity) { where += ` AND severity=@sev`;      request.input('sev',     sql.NVarChar,         severity); }
    if (source)   { where += ` AND source=@source`;     request.input('source',  sql.NVarChar,         source);   }
    if (assetId)  { where += ` AND asset_id=@assetId`;  request.input('assetId', sql.UniqueIdentifier, assetId);  }
    if (search)   {
      where += ` AND message LIKE @srch`;
      request.input('srch', sql.NVarChar, `%${search}%`);
    }

    /* count */
    const cntReq = pool.request().input('tid2', sql.UniqueIdentifier, req.tenantId);
    /* simplified count — same hours window */
    const cntRes = await cntReq.query(
      `SELECT COUNT(*) AS total FROM log_entries WHERE tenant_id=@tid2 AND ts > DATEADD(hour,-${hours},GETUTCDATE())`
    );

    const r = await request.query(`
      SELECT
        l.id, l.severity, l.source, l.message, l.tags, l.ts,
        a.name AS asset_name, a.hostname AS asset_hostname
      FROM log_entries l
      LEFT JOIN assets a ON l.asset_id = a.id
      ${where}
      ORDER BY l.ts DESC
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
    `);

    return res.json({
      data:  r.recordset,
      total: cntRes.recordset[0].total,
      page,
      limit,
    });
  } catch (err) {
    logger.error('logs list', { err: err.message });
    return res.status(500).json({ error: 'Failed to fetch logs.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/logs/summary
   Count by severity for the last 24h — dashboard widget.
   ══════════════════════════════════════════════════════════════════ */
router.get('/logs/summary', async (req, res) => {
  try {
    const pool  = await getPool();
    const hours = Math.min(168, parseInt(req.query.hours) || 24);

    const r = await pool.request()
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN severity='debug'    THEN 1 ELSE 0 END) AS debug,
          SUM(CASE WHEN severity='info'     THEN 1 ELSE 0 END) AS info,
          SUM(CASE WHEN severity='warning'  THEN 1 ELSE 0 END) AS warning,
          SUM(CASE WHEN severity='error'    THEN 1 ELSE 0 END) AS error,
          SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) AS critical,
          COUNT(DISTINCT asset_id) AS assets_with_logs
        FROM log_entries
        WHERE tenant_id=@tid
          AND ts > DATEADD(hour,-${hours},GETUTCDATE())
      `);
    return res.json(r.recordset[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch log summary.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   POST /api/logs/ingest
   Direct log ingest from non-agent sources (syslog forwarder,
   Splunk HEC replacement, webhook, etc.)
   Body: { assetId?, source, severity, message, rawLog?, tags?, ts? }[]
   ══════════════════════════════════════════════════════════════════ */
router.post('/logs/ingest', requireRole('operator','tenant_admin','super_admin'), async (req, res) => {
  try {
    const entries = Array.isArray(req.body) ? req.body : [req.body];
    if (!entries.length) return res.status(400).json({ error: 'No log entries provided.' });

    const pool    = await getPool();
    const VALID_SEV = new Set(['debug','info','warning','error','critical']);
    let ingested  = 0;

    for (const entry of entries.slice(0, 1000)) {
      const severity = VALID_SEV.has(entry.severity) ? entry.severity : 'info';
      const ts       = entry.ts ? new Date(entry.ts) : new Date();

      await pool.request()
        .input('asset_id', sql.UniqueIdentifier, entry.assetId || null)
        .input('tid',      sql.UniqueIdentifier, req.tenantId)
        .input('source',   sql.NVarChar,         entry.source   || null)
        .input('severity', sql.NVarChar,         severity)
        .input('message',  sql.NVarChar,         entry.message  || '')
        .input('raw_log',  sql.NVarChar,         entry.rawLog   || null)
        .input('tags',     sql.NVarChar,         entry.tags     || null)
        .input('ts',       sql.DateTime2,        ts)
        .query(`INSERT INTO log_entries (asset_id,tenant_id,source,severity,message,raw_log,tags,ts)
                VALUES (@asset_id,@tid,@source,@severity,@message,@raw_log,@tags,@ts)`);
      ingested++;
    }

    return res.status(201).json({ ingested, message: `${ingested} log entries ingested.` });
  } catch (err) {
    logger.error('log ingest', { err: err.message });
    return res.status(500).json({ error: 'Log ingest failed.' });
  }
});

module.exports = router;
