'use strict';

/**
 * Vanguard OS — Agent Ingest API
 *
 * All routes authenticated with X-Agent-Token header.
 * Agents call:
 *   POST /api/agent/register   — first-time self-registration
 *   POST /api/agent/heartbeat  — periodic metrics snapshot
 *   POST /api/agent/inventory  — software + port scan results
 *   POST /api/agent/logs       — batch log shipping
 *   GET  /api/agent/commands   — poll for pending commands (optional)
 */

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { getPool, sql }    = require('../db/pool');
const { authenticateAgent } = require('../middleware/auth');
const { logAudit }         = require('../utils/audit');
const logger               = require('../utils/logger');

router.use(authenticateAgent);

/* ══════════════════════════════════════════════════════════════════
   POST /api/agent/register
   Agent sends its inventory; we create or update the asset record
   and return the canonical assetId the agent should use forever.
   ══════════════════════════════════════════════════════════════════ */
router.post('/register', async (req, res) => {
  try {
    const {
      agentId, hostname, fqdn, ipAddress, macAddress,
      osType, osVersion, osBuild,
      cpuCores, ramGb, diskGb,
      manufacturer, model, serialNumber,
      assetType = 'server',
      agentVersion,
    } = req.body;

    if (!agentId) return res.status(400).json({ error: 'agentId is required.' });

    const pool = await getPool();
    const tid  = req.tenantId;

    /* Check if already registered by agentId */
    const existing = await pool.request()
      .input('agentId', sql.NVarChar, agentId)
      .input('tid',     sql.UniqueIdentifier, tid)
      .query(`SELECT id FROM assets WHERE agent_id=@agentId AND tenant_id=@tid`);

    if (existing.recordset.length) {
      /* Update existing — refresh vitals */
      const assetId = existing.recordset[0].id;
      await pool.request()
        .input('id',            sql.UniqueIdentifier, assetId)
        .input('hostname',      sql.NVarChar, hostname      || null)
        .input('fqdn',          sql.NVarChar, fqdn          || null)
        .input('ip_address',    sql.NVarChar, ipAddress     || null)
        .input('mac_address',   sql.NVarChar, macAddress    || null)
        .input('os_version',    sql.NVarChar, osVersion     || null)
        .input('os_build',      sql.NVarChar, osBuild       || null)
        .input('cpu_cores',     sql.Int,      cpuCores      || null)
        .input('ram_gb',        sql.Float,    ramGb         || null)
        .input('disk_gb',       sql.Float,    diskGb        || null)
        .input('agent_version', sql.NVarChar, agentVersion  || null)
        .input('status',        sql.NVarChar, 'online')
        .query(`UPDATE assets SET
                  hostname=@hostname, fqdn=@fqdn, ip_address=@ip_address,
                  mac_address=@mac_address, os_version=@os_version, os_build=@os_build,
                  cpu_cores=@cpu_cores, ram_gb=@ram_gb, disk_gb=@disk_gb,
                  agent_version=@agent_version, status=@status,
                  last_seen=GETUTCDATE(), last_check_in=GETUTCDATE(),
                  is_managed=1, updated_at=GETUTCDATE()
                WHERE id=@id`);

      logger.info('Agent re-registered', { agentId, assetId, tid });
      return res.json({ assetId, status: 'updated' });
    }

    /* New registration */
    const assetId = uuidv4();
    const name    = hostname || agentId;

    await pool.request()
      .input('id',            sql.UniqueIdentifier, assetId)
      .input('tid',           sql.UniqueIdentifier, tid)
      .input('name',          sql.NVarChar, name)
      .input('hostname',      sql.NVarChar, hostname      || null)
      .input('fqdn',          sql.NVarChar, fqdn          || null)
      .input('ip_address',    sql.NVarChar, ipAddress     || null)
      .input('mac_address',   sql.NVarChar, macAddress    || null)
      .input('asset_type',    sql.NVarChar, assetType)
      .input('os_type',       sql.NVarChar, osType        || null)
      .input('os_version',    sql.NVarChar, osVersion     || null)
      .input('os_build',      sql.NVarChar, osBuild       || null)
      .input('cpu_cores',     sql.Int,      cpuCores      || null)
      .input('ram_gb',        sql.Float,    ramGb         || null)
      .input('disk_gb',       sql.Float,    diskGb        || null)
      .input('manufacturer',  sql.NVarChar, manufacturer  || null)
      .input('model',         sql.NVarChar, model         || null)
      .input('serial_number', sql.NVarChar, serialNumber  || null)
      .input('agent_id',      sql.NVarChar, agentId)
      .input('agent_version', sql.NVarChar, agentVersion  || null)
      .query(`INSERT INTO assets
                (id, tenant_id, name, hostname, fqdn, ip_address, mac_address,
                 asset_type, os_type, os_version, os_build,
                 cpu_cores, ram_gb, disk_gb, manufacturer, model, serial_number,
                 agent_id, agent_version, status, is_managed,
                 last_seen, last_check_in)
              VALUES
                (@id, @tid, @name, @hostname, @fqdn, @ip_address, @mac_address,
                 @asset_type, @os_type, @os_version, @os_build,
                 @cpu_cores, @ram_gb, @disk_gb, @manufacturer, @model, @serial_number,
                 @agent_id, @agent_version, 'online', 1,
                 GETUTCDATE(), GETUTCDATE())`);

    /* Link token to this asset */
    await pool.request()
      .input('assetId',    sql.UniqueIdentifier, assetId)
      .input('tokenId',    sql.UniqueIdentifier, req.agentToken.id)
      .query(`UPDATE agent_tokens SET asset_id=@assetId WHERE id=@tokenId`);

    await logAudit({
      tenantId: tid, action: 'AGENT_REGISTERED', resource: 'assets',
      resourceId: assetId, details: { agentId, hostname, osType },
      severity: 'info',
    });

    logger.info('Agent registered', { agentId, assetId, tid });
    return res.status(201).json({ assetId, status: 'created' });
  } catch (err) {
    logger.error('Agent register error', { err: err.message });
    return res.status(500).json({ error: 'Registration failed.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   POST /api/agent/heartbeat
   Receives a metrics snapshot every N seconds.
   ══════════════════════════════════════════════════════════════════ */
router.post('/heartbeat', async (req, res) => {
  try {
    const {
      assetId, agentId,
      status = 'online',
      cpuPct, memPct, diskPct,
      netInKbps, netOutKbps,
      loadAvg1, loadAvg5, loadAvg15,
      uptimeSeconds, processCount,
      ts,
    } = req.body;

    if (!assetId) return res.status(400).json({ error: 'assetId is required.' });

    const pool = await getPool();
    const tid  = req.tenantId;

    /* 1. Update asset last_seen + status */
    await pool.request()
      .input('id',     sql.UniqueIdentifier, assetId)
      .input('tid',    sql.UniqueIdentifier, tid)
      .input('status', sql.NVarChar,         status)
      .query(`UPDATE assets
              SET status=@status, last_seen=GETUTCDATE(), last_check_in=GETUTCDATE(),
                  updated_at=GETUTCDATE()
              WHERE id=@id AND tenant_id=@tid`);

    /* 2. Insert metric snapshot */
    await pool.request()
      .input('asset_id',       sql.UniqueIdentifier, assetId)
      .input('tid',            sql.UniqueIdentifier, tid)
      .input('cpu_pct',        sql.Float,  cpuPct        ?? null)
      .input('mem_pct',        sql.Float,  memPct        ?? null)
      .input('disk_pct',       sql.Float,  diskPct       ?? null)
      .input('net_in_kbps',    sql.Float,  netInKbps     ?? null)
      .input('net_out_kbps',   sql.Float,  netOutKbps    ?? null)
      .input('load_avg_1',     sql.Float,  loadAvg1      ?? null)
      .input('load_avg_5',     sql.Float,  loadAvg5      ?? null)
      .input('load_avg_15',    sql.Float,  loadAvg15     ?? null)
      .input('uptime_seconds', sql.BigInt, uptimeSeconds ?? null)
      .input('process_count',  sql.Int,    processCount  ?? null)
      .query(`INSERT INTO metric_snapshots
                (asset_id, tenant_id, cpu_pct, mem_pct, disk_pct,
                 net_in_kbps, net_out_kbps, load_avg_1, load_avg_5, load_avg_15,
                 uptime_seconds, process_count)
              VALUES
                (@asset_id, @tid, @cpu_pct, @mem_pct, @disk_pct,
                 @net_in_kbps, @net_out_kbps, @load_avg_1, @load_avg_5, @load_avg_15,
                 @uptime_seconds, @process_count)`);

    /* 3. Individual metric rows (for time-series queries) */
    const metrics = [
      ['cpu_pct',      cpuPct,      '%'],
      ['mem_pct',      memPct,      '%'],
      ['disk_pct',     diskPct,     '%'],
      ['net_in_kbps',  netInKbps,   'kbps'],
      ['net_out_kbps', netOutKbps,  'kbps'],
    ];
    for (const [name, value, unit] of metrics) {
      if (value == null) continue;
      await pool.request()
        .input('asset_id',    sql.UniqueIdentifier, assetId)
        .input('tid',         sql.UniqueIdentifier, tid)
        .input('metric_name', sql.NVarChar,         name)
        .input('value',       sql.Float,            value)
        .input('unit',        sql.NVarChar,         unit)
        .query(`INSERT INTO metrics (asset_id, tenant_id, metric_name, value, unit)
                VALUES (@asset_id, @tid, @metric_name, @value, @unit)`);
    }

    return res.json({ ok: true });
  } catch (err) {
    logger.error('Agent heartbeat error', { err: err.message });
    return res.status(500).json({ error: 'Heartbeat failed.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   POST /api/agent/inventory
   Full software + ports inventory (sent less frequently).
   ══════════════════════════════════════════════════════════════════ */
router.post('/inventory', async (req, res) => {
  try {
    const { assetId, software = [], ports = [] } = req.body;
    if (!assetId) return res.status(400).json({ error: 'assetId is required.' });

    const pool = await getPool();
    const tid  = req.tenantId;

    /* Verify asset belongs to this tenant */
    const check = await pool.request()
      .input('id',  sql.UniqueIdentifier, assetId)
      .input('tid', sql.UniqueIdentifier, tid)
      .query(`SELECT 1 FROM assets WHERE id=@id AND tenant_id=@tid`);
    if (!check.recordset.length) return res.status(403).json({ error: 'Asset not found.' });

    /* Replace software list */
    await pool.request()
      .input('asset_id', sql.UniqueIdentifier, assetId)
      .query(`DELETE FROM asset_software WHERE asset_id=@asset_id`);

    for (const sw of software.slice(0, 500)) {
      await pool.request()
        .input('asset_id',    sql.UniqueIdentifier, assetId)
        .input('name',        sql.NVarChar, sw.name        || 'Unknown')
        .input('version',     sql.NVarChar, sw.version     || null)
        .input('publisher',   sql.NVarChar, sw.publisher   || null)
        .input('install_date',sql.Date,     sw.installDate ? new Date(sw.installDate) : null)
        .input('install_path',sql.NVarChar, sw.installPath || null)
        .query(`INSERT INTO asset_software (asset_id, name, version, publisher, install_date, install_path)
                VALUES (@asset_id, @name, @version, @publisher, @install_date, @install_path)`);
    }

    /* Replace port list */
    await pool.request()
      .input('asset_id', sql.UniqueIdentifier, assetId)
      .query(`DELETE FROM asset_ports WHERE asset_id=@asset_id`);

    for (const p of ports.slice(0, 200)) {
      await pool.request()
        .input('asset_id', sql.UniqueIdentifier, assetId)
        .input('port',     sql.Int,     p.port)
        .input('protocol', sql.NVarChar, p.protocol || 'tcp')
        .input('state',    sql.NVarChar, p.state    || 'open')
        .input('service',  sql.NVarChar, p.service  || null)
        .input('version',  sql.NVarChar, p.version  || null)
        .query(`INSERT INTO asset_ports (asset_id, port, protocol, state, service, version)
                VALUES (@asset_id, @port, @protocol, @state, @service, @version)`);
    }

    return res.json({ ok: true, softwareCount: software.length, portCount: ports.length });
  } catch (err) {
    logger.error('Agent inventory error', { err: err.message });
    return res.status(500).json({ error: 'Inventory push failed.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   POST /api/agent/logs
   Batch log shipping from the agent.
   ══════════════════════════════════════════════════════════════════ */
router.post('/logs', async (req, res) => {
  try {
    const { assetId, logs = [] } = req.body;
    if (!assetId) return res.status(400).json({ error: 'assetId is required.' });

    const pool = await getPool();
    const tid  = req.tenantId;

    for (const entry of logs.slice(0, 1000)) {
      const severity = ['debug','info','warning','error','critical'].includes(entry.severity)
        ? entry.severity : 'info';

      await pool.request()
        .input('asset_id', sql.UniqueIdentifier, assetId)
        .input('tid',      sql.UniqueIdentifier, tid)
        .input('source',   sql.NVarChar,         entry.source   || null)
        .input('severity', sql.NVarChar,         severity)
        .input('message',  sql.NVarChar,         entry.message  || '')
        .input('raw_log',  sql.NVarChar,         entry.rawLog   || null)
        .input('tags',     sql.NVarChar,         entry.tags     || null)
        .query(`INSERT INTO log_entries (asset_id, tenant_id, source, severity, message, raw_log, tags)
                VALUES (@asset_id, @tid, @source, @severity, @message, @raw_log, @tags)`);
    }

    return res.json({ ok: true, ingested: logs.length });
  } catch (err) {
    logger.error('Agent logs error', { err: err.message });
    return res.status(500).json({ error: 'Log ingestion failed.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/agent/commands
   Agent polls for pending commands (remote script execution, etc.)
   Returns empty array until Phase 3 automation is wired.
   ══════════════════════════════════════════════════════════════════ */
router.get('/commands', async (req, res) => {
  const { assetId } = req.query;
  // Phase 3 will populate this from automation_runs
  return res.json({ commands: [], assetId: assetId || null });
});

module.exports = router;
