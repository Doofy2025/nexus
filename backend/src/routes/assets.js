'use strict';

/**
 * Vanguard OS — Assets / Inventory API  (Phase 2A)
 *
 * GET    /api/assets                     list with filters + pagination
 * GET    /api/assets/summary             dashboard counts
 * GET    /api/assets/types               distinct asset type counts
 * GET    /api/assets/:id                 full asset detail + enrichment
 * POST   /api/assets                     create asset manually
 * PATCH  /api/assets/:id                 update asset fields
 * DELETE /api/assets/:id                 soft-delete (decommission)
 *
 * GET    /api/assets/:id/snapshots       metric snapshots (time-series)
 * GET    /api/assets/:id/metrics         raw named metric rows
 * GET    /api/assets/:id/logs            log entries for this asset
 * GET    /api/assets/:id/software        installed software list
 * GET    /api/assets/:id/ports           open ports
 * GET    /api/assets/:id/topology        dependency graph edges
 * POST   /api/assets/:id/topology        add a dependency edge
 * DELETE /api/assets/:id/topology/:eid   remove a dependency edge
 *
 * POST   /api/assets/:id/agent-token     generate agent token (shown once)
 * DELETE /api/assets/:id/agent-token     revoke agent token
 *
 * POST   /api/assets/bulk/tag            bulk-tag multiple assets
 * POST   /api/assets/bulk/status         bulk status update
 * POST   /api/assets/bulk/site           bulk site reassign
 */

const router  = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const crypto  = require('crypto');
const { getPool, sql }    = require('../db/pool');
const { authenticate, requireRole, tenantScope } = require('../middleware/auth');
const { logAudit }        = require('../utils/audit');
const logger              = require('../utils/logger');

router.use(authenticate, tenantScope);

/* ─── constants ────────────────────────────────────────────────────────────── */
const VALID_ORDER = new Set([
  'name','status','asset_type','criticality','environment',
  'last_seen','created_at','updated_at','ip_address','hostname',
]);

/* ─── helpers ───────────────────────────────────────────────────────────────── */
/**
 * Build the WHERE clause for list / count queries.
 * Binds params directly onto the mssql Request object passed in.
 */
function buildWhere(req, request, tid) {
  const {
    type, status, site_id, environment, criticality,
    cloud_provider, is_managed, os_type, search,
  } = req.query;

  let w = `WHERE a.tenant_id=@tid AND a.status != 'decommissioned'`;
  request.input('tid', sql.UniqueIdentifier, tid);

  if (type)          { w += ` AND a.asset_type=@type`;          request.input('type',         sql.NVarChar,         type); }
  if (status)        { w += ` AND a.status=@astatus`;           request.input('astatus',      sql.NVarChar,         status); }
  if (site_id)       { w += ` AND a.site_id=@site_id`;          request.input('site_id',      sql.UniqueIdentifier, site_id); }
  if (environment)   { w += ` AND a.environment=@env`;          request.input('env',          sql.NVarChar,         environment); }
  if (criticality)   { w += ` AND a.criticality=@crit`;         request.input('crit',         sql.NVarChar,         criticality); }
  if (cloud_provider){ w += ` AND a.cloud_provider=@cprov`;     request.input('cprov',        sql.NVarChar,         cloud_provider); }
  if (os_type)       { w += ` AND a.os_type=@os_type`;          request.input('os_type',      sql.NVarChar,         os_type); }
  if (is_managed !== undefined) {
    w += ` AND a.is_managed=@is_managed`;
    request.input('is_managed', sql.Bit, is_managed === 'true' ? 1 : 0);
  }
  if (search) {
    w += ` AND (a.name LIKE @srch OR a.hostname LIKE @srch OR a.ip_address LIKE @srch
                OR a.fqdn LIKE @srch OR a.os_version LIKE @srch OR a.agent_id LIKE @srch)`;
    request.input('srch', sql.NVarChar, `%${search}%`);
  }
  return w;
}

/* ══════════════════════════════════════════════════════════════════
   GET /api/assets
   ══════════════════════════════════════════════════════════════════ */
router.get('/', async (req, res) => {
  try {
    const pool    = await getPool();
    const page    = Math.max(1,   parseInt(req.query.page)    || 1);
    const limit   = Math.min(500, parseInt(req.query.limit)   || 50);
    const orderBy = VALID_ORDER.has(req.query.orderBy) ? req.query.orderBy : 'name';
    const dir     = req.query.orderDir === 'DESC' ? 'DESC' : 'ASC';
    const offset  = (page - 1) * limit;

    /* count */
    const cntReq = pool.request();
    const cntWhere = buildWhere(req, cntReq, req.tenantId);
    const cntRes = await cntReq.query(`SELECT COUNT(*) AS total FROM assets a ${cntWhere}`);
    const total  = cntRes.recordset[0].total;

    /* data */
    const dataReq = pool.request();
    const dataWhere = buildWhere(req, dataReq, req.tenantId);

    const result = await dataReq.query(`
      SELECT
        a.id, a.name, a.hostname, a.fqdn, a.ip_address, a.mac_address,
        a.asset_type, a.os_type, a.os_version, a.cpu_cores, a.ram_gb, a.disk_gb,
        a.manufacturer, a.model,
        a.cloud_provider, a.cloud_region, a.cloud_resource_id,
        a.environment, a.criticality, a.status,
        a.agent_id, a.agent_version, a.last_seen, a.last_check_in,
        a.is_managed, a.tags, a.notes,
        a.created_at, a.updated_at,
        s.name AS site_name,
        s.code AS site_code,
        s.type AS site_type,
        (SELECT TOP 1 cpu_pct  FROM metric_snapshots ms WHERE ms.asset_id=a.id ORDER BY ms.ts DESC) AS cpu_pct,
        (SELECT TOP 1 mem_pct  FROM metric_snapshots ms WHERE ms.asset_id=a.id ORDER BY ms.ts DESC) AS mem_pct,
        (SELECT TOP 1 disk_pct FROM metric_snapshots ms WHERE ms.asset_id=a.id ORDER BY ms.ts DESC) AS disk_pct,
        (SELECT COUNT(*) FROM alerts al WHERE al.asset_id=a.id AND al.status='open') AS open_alerts
      FROM assets a
      LEFT JOIN sites s ON a.site_id = s.id
      ${dataWhere}
      ORDER BY a.${orderBy} ${dir}
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
    `);

    return res.json({
      data:  result.recordset,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    logger.error('assets list', { err: err.message });
    return res.status(500).json({ error: 'Failed to fetch assets.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/assets/summary
   ══════════════════════════════════════════════════════════════════ */
router.get('/summary', async (req, res) => {
  try {
    const pool = await getPool();
    const r    = await pool.request()
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status='online'      THEN 1 ELSE 0 END) AS online,
          SUM(CASE WHEN status='offline'     THEN 1 ELSE 0 END) AS offline,
          SUM(CASE WHEN status='degraded'    THEN 1 ELSE 0 END) AS degraded,
          SUM(CASE WHEN status='maintenance' THEN 1 ELSE 0 END) AS maintenance,
          SUM(CASE WHEN status='unknown'     THEN 1 ELSE 0 END) AS unknown,

          SUM(CASE WHEN asset_type='server'          THEN 1 ELSE 0 END) AS servers,
          SUM(CASE WHEN asset_type='workstation'     THEN 1 ELSE 0 END) AS workstations,
          SUM(CASE WHEN asset_type='vm'              THEN 1 ELSE 0 END) AS vms,
          SUM(CASE WHEN asset_type='container'       THEN 1 ELSE 0 END) AS containers,
          SUM(CASE WHEN asset_type='kubernetes_node' THEN 1 ELSE 0 END) AS kubernetes_nodes,
          SUM(CASE WHEN asset_type='cloud_instance'  THEN 1 ELSE 0 END) AS cloud_instances,
          SUM(CASE WHEN asset_type='network_device'  THEN 1 ELSE 0 END) AS network_devices,
          SUM(CASE WHEN asset_type='mobile_device'   THEN 1 ELSE 0 END) AS mobile_devices,
          SUM(CASE WHEN asset_type='database'        THEN 1 ELSE 0 END) AS databases,

          SUM(CASE WHEN criticality='critical' THEN 1 ELSE 0 END) AS crit_critical,
          SUM(CASE WHEN criticality='high'     THEN 1 ELSE 0 END) AS crit_high,
          SUM(CASE WHEN criticality='medium'   THEN 1 ELSE 0 END) AS crit_medium,
          SUM(CASE WHEN criticality='low'      THEN 1 ELSE 0 END) AS crit_low,

          SUM(CASE WHEN is_managed=1 THEN 1 ELSE 0 END) AS managed,
          SUM(CASE WHEN is_managed=0 THEN 1 ELSE 0 END) AS unmanaged,

          SUM(CASE WHEN environment='production'  THEN 1 ELSE 0 END) AS env_production,
          SUM(CASE WHEN environment='staging'     THEN 1 ELSE 0 END) AS env_staging,
          SUM(CASE WHEN environment='development' THEN 1 ELSE 0 END) AS env_development,
          SUM(CASE WHEN environment='test'        THEN 1 ELSE 0 END) AS env_test,
          SUM(CASE WHEN environment='dr'          THEN 1 ELSE 0 END) AS env_dr,

          SUM(CASE WHEN is_managed=1
                    AND last_seen < DATEADD(minute,-15,GETUTCDATE())
                    AND status='online'
               THEN 1 ELSE 0 END) AS stale_agents,

          SUM(CASE WHEN last_seen > DATEADD(minute,-5,GETUTCDATE()) THEN 1 ELSE 0 END) AS active_last_5m,
          SUM(CASE WHEN last_seen > DATEADD(hour,-1, GETUTCDATE()) THEN 1 ELSE 0 END) AS active_last_1h
        FROM assets
        WHERE tenant_id=@tid AND status != 'decommissioned'
      `);
    return res.json(r.recordset[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch asset summary.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/assets/types
   ══════════════════════════════════════════════════════════════════ */
router.get('/types', async (req, res) => {
  try {
    const pool = await getPool();
    const r    = await pool.request()
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`
        SELECT asset_type AS type, COUNT(*) AS count
        FROM assets
        WHERE tenant_id=@tid AND status != 'decommissioned'
        GROUP BY asset_type
        ORDER BY count DESC
      `);
    return res.json(r.recordset);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch asset types.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   BULK OPERATIONS  (must be before /:id to avoid route collision)
   ══════════════════════════════════════════════════════════════════ */

/* POST /api/assets/bulk/tag */
router.post('/bulk/tag', requireRole('operator','tenant_admin','super_admin'), async (req, res) => {
  try {
    const { ids, tags } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array required.' });

    const pool  = await getPool();
    const tagsJson = JSON.stringify(tags || []);
    let updated = 0;

    for (const id of ids.slice(0, 500)) {
      const r = await pool.request()
        .input('id',   sql.UniqueIdentifier, id)
        .input('tid',  sql.UniqueIdentifier, req.tenantId)
        .input('tags', sql.NVarChar,         tagsJson)
        .query(`UPDATE assets SET tags=@tags, updated_at=GETUTCDATE()
                WHERE id=@id AND tenant_id=@tid`);
      updated += r.rowsAffected[0];
    }

    await logAudit({ tenantId:req.tenantId, userId:req.user.id, userEmail:req.user.email,
      action:'ASSETS_BULK_TAGGED', resource:'assets', details:{ count:updated, tags },
      ip:req.ip, ua:req.headers['user-agent'], severity:'info' });

    return res.json({ updated, message: `${updated} asset(s) tagged.` });
  } catch (err) {
    return res.status(500).json({ error: 'Bulk tag failed.' });
  }
});

/* POST /api/assets/bulk/status */
router.post('/bulk/status', requireRole('operator','tenant_admin','super_admin'), async (req, res) => {
  try {
    const { ids, status } = req.body;
    const allowed = ['online','offline','degraded','maintenance','unknown'];
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array required.' });
    if (!allowed.includes(status)) return res.status(400).json({ error: `Invalid status.` });

    const pool  = await getPool();
    let updated = 0;

    for (const id of ids.slice(0, 500)) {
      const r = await pool.request()
        .input('id',     sql.UniqueIdentifier, id)
        .input('tid',    sql.UniqueIdentifier, req.tenantId)
        .input('status', sql.NVarChar,         status)
        .query(`UPDATE assets SET status=@status, updated_at=GETUTCDATE()
                WHERE id=@id AND tenant_id=@tid`);
      updated += r.rowsAffected[0];
    }

    return res.json({ updated, message: `${updated} asset(s) updated to ${status}.` });
  } catch (err) {
    return res.status(500).json({ error: 'Bulk status update failed.' });
  }
});

/* POST /api/assets/bulk/site */
router.post('/bulk/site', requireRole('tenant_admin','super_admin'), async (req, res) => {
  try {
    const { ids, site_id } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array required.' });

    const pool  = await getPool();
    let updated = 0;

    for (const id of ids.slice(0, 500)) {
      const r = await pool.request()
        .input('id',      sql.UniqueIdentifier, id)
        .input('tid',     sql.UniqueIdentifier, req.tenantId)
        .input('site_id', sql.UniqueIdentifier, site_id || null)
        .query(`UPDATE assets SET site_id=@site_id, updated_at=GETUTCDATE()
                WHERE id=@id AND tenant_id=@tid`);
      updated += r.rowsAffected[0];
    }

    return res.json({ updated, message: `${updated} asset(s) moved.` });
  } catch (err) {
    return res.status(500).json({ error: 'Bulk site update failed.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/assets/:id
   ══════════════════════════════════════════════════════════════════ */
router.get('/:id', async (req, res) => {
  try {
    const pool = await getPool();

    const asset = await pool.request()
      .input('id',  sql.UniqueIdentifier, req.params.id)
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`
        SELECT a.*, s.name AS site_name, s.code AS site_code, s.type AS site_type
        FROM assets a
        LEFT JOIN sites s ON a.site_id = s.id
        WHERE a.id=@id AND a.tenant_id=@tid
      `);

    if (!asset.recordset.length) return res.status(404).json({ error: 'Asset not found.' });

    const snap = await pool.request()
      .input('aid', sql.UniqueIdentifier, req.params.id)
      .query(`SELECT TOP 1 * FROM metric_snapshots WHERE asset_id=@aid ORDER BY ts DESC`);

    const alerts = await pool.request()
      .input('aid2', sql.UniqueIdentifier, req.params.id)
      .query(`SELECT COUNT(*) AS cnt FROM alerts WHERE asset_id=@aid2 AND status='open'`);

    const swCount = await pool.request()
      .input('aid3', sql.UniqueIdentifier, req.params.id)
      .query(`SELECT COUNT(*) AS cnt FROM asset_software WHERE asset_id=@aid3`);

    const portCount = await pool.request()
      .input('aid4', sql.UniqueIdentifier, req.params.id)
      .query(`SELECT COUNT(*) AS cnt FROM asset_ports WHERE asset_id=@aid4`);

    const depCount = await pool.request()
      .input('aid5', sql.UniqueIdentifier, req.params.id)
      .query(`SELECT COUNT(*) AS cnt FROM asset_dependencies
              WHERE source_id=@aid5 OR target_id=@aid5`);

    return res.json({
      ...asset.recordset[0],
      latestSnapshot:   snap.recordset[0]    || null,
      openAlertCount:   alerts.recordset[0].cnt,
      softwareCount:    swCount.recordset[0].cnt,
      portCount:        portCount.recordset[0].cnt,
      dependencyCount:  depCount.recordset[0].cnt,
    });
  } catch (err) {
    logger.error('asset get', { err: err.message });
    return res.status(500).json({ error: 'Failed to fetch asset.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   POST /api/assets
   ══════════════════════════════════════════════════════════════════ */
router.post('/', requireRole('operator','tenant_admin','super_admin'), async (req, res) => {
  try {
    const {
      name, hostname, fqdn, ip_address, mac_address,
      asset_type = 'unknown', os_type, os_version, os_build,
      cpu_cores, ram_gb, disk_gb,
      manufacturer, model, serial_number,
      site_id, environment, criticality = 'medium',
      cloud_provider, cloud_region, cloud_resource_id,
      tags, custom_fields, notes,
    } = req.body;

    if (!name) return res.status(400).json({ error: 'name is required.' });

    const pool = await getPool();
    const id   = uuidv4();

    await pool.request()
      .input('id',                sql.UniqueIdentifier, id)
      .input('tenant_id',         sql.UniqueIdentifier, req.tenantId)
      .input('site_id',           sql.UniqueIdentifier, site_id           || null)
      .input('name',              sql.NVarChar,         name)
      .input('hostname',          sql.NVarChar,         hostname          || null)
      .input('fqdn',              sql.NVarChar,         fqdn              || null)
      .input('ip_address',        sql.NVarChar,         ip_address        || null)
      .input('mac_address',       sql.NVarChar,         mac_address       || null)
      .input('asset_type',        sql.NVarChar,         asset_type)
      .input('os_type',           sql.NVarChar,         os_type           || null)
      .input('os_version',        sql.NVarChar,         os_version        || null)
      .input('os_build',          sql.NVarChar,         os_build          || null)
      .input('cpu_cores',         sql.Int,              cpu_cores         || null)
      .input('ram_gb',            sql.Float,            ram_gb            || null)
      .input('disk_gb',           sql.Float,            disk_gb           || null)
      .input('manufacturer',      sql.NVarChar,         manufacturer      || null)
      .input('model',             sql.NVarChar,         model             || null)
      .input('serial_number',     sql.NVarChar,         serial_number     || null)
      .input('environment',       sql.NVarChar,         environment       || null)
      .input('criticality',       sql.NVarChar,         criticality)
      .input('cloud_provider',    sql.NVarChar,         cloud_provider    || null)
      .input('cloud_region',      sql.NVarChar,         cloud_region      || null)
      .input('cloud_resource_id', sql.NVarChar,         cloud_resource_id || null)
      .input('tags',              sql.NVarChar,         tags         ? JSON.stringify(tags)         : null)
      .input('custom_fields',     sql.NVarChar,         custom_fields ? JSON.stringify(custom_fields) : null)
      .input('notes',             sql.NVarChar,         notes             || null)
      .query(`
        INSERT INTO assets (
          id, tenant_id, site_id, name, hostname, fqdn, ip_address, mac_address,
          asset_type, os_type, os_version, os_build,
          cpu_cores, ram_gb, disk_gb, manufacturer, model, serial_number,
          environment, criticality, cloud_provider, cloud_region, cloud_resource_id,
          tags, custom_fields, notes
        ) VALUES (
          @id, @tenant_id, @site_id, @name, @hostname, @fqdn, @ip_address, @mac_address,
          @asset_type, @os_type, @os_version, @os_build,
          @cpu_cores, @ram_gb, @disk_gb, @manufacturer, @model, @serial_number,
          @environment, @criticality, @cloud_provider, @cloud_region, @cloud_resource_id,
          @tags, @custom_fields, @notes
        )
      `);

    await logAudit({ tenantId:req.tenantId, userId:req.user.id, userEmail:req.user.email,
      action:'ASSET_CREATED', resource:'assets', resourceId:id,
      details:{ name, asset_type }, ip:req.ip, ua:req.headers['user-agent'], severity:'info' });

    return res.status(201).json({ id, name, asset_type });
  } catch (err) {
    logger.error('asset create', { err: err.message });
    return res.status(500).json({ error: 'Failed to create asset.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   PATCH /api/assets/:id
   ══════════════════════════════════════════════════════════════════ */
router.patch('/:id', requireRole('operator','tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool  = await getPool();
    const check = await pool.request()
      .input('id',  sql.UniqueIdentifier, req.params.id)
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT 1 FROM assets WHERE id=@id AND tenant_id=@tid`);
    if (!check.recordset.length) return res.status(404).json({ error: 'Asset not found.' });

    const textFields = [
      'name','hostname','fqdn','ip_address','mac_address',
      'os_type','os_version','os_build','manufacturer','model',
      'serial_number','environment','criticality','status','notes',
      'cloud_provider','cloud_region','cloud_resource_id',
      'agent_version',
    ];

    const sets    = [];
    const request = pool.request().input('id', sql.UniqueIdentifier, req.params.id);

    for (const k of textFields) {
      if (req.body[k] !== undefined) {
        sets.push(`${k}=@${k}`);
        request.input(k, sql.NVarChar, req.body[k]);
      }
    }
    if (req.body.site_id !== undefined) {
      sets.push(`site_id=@site_id`);
      request.input('site_id', sql.UniqueIdentifier, req.body.site_id || null);
    }
    if (req.body.is_managed !== undefined) {
      sets.push(`is_managed=@is_managed`);
      request.input('is_managed', sql.Bit, req.body.is_managed ? 1 : 0);
    }
    if (req.body.cpu_cores !== undefined) { sets.push(`cpu_cores=@cpu_cores`); request.input('cpu_cores', sql.Int, req.body.cpu_cores); }
    if (req.body.ram_gb    !== undefined) { sets.push(`ram_gb=@ram_gb`);       request.input('ram_gb',    sql.Float, req.body.ram_gb); }
    if (req.body.disk_gb   !== undefined) { sets.push(`disk_gb=@disk_gb`);     request.input('disk_gb',   sql.Float, req.body.disk_gb); }
    if (req.body.tags          !== undefined) { sets.push(`tags=@tags`);               request.input('tags',          sql.NVarChar, JSON.stringify(req.body.tags)); }
    if (req.body.custom_fields !== undefined) { sets.push(`custom_fields=@cf`);        request.input('cf',            sql.NVarChar, JSON.stringify(req.body.custom_fields)); }

    if (sets.length) {
      sets.push(`updated_at=GETUTCDATE()`);
      await request.query(`UPDATE assets SET ${sets.join(',')} WHERE id=@id`);
    }

    await logAudit({ tenantId:req.tenantId, userId:req.user.id, userEmail:req.user.email,
      action:'ASSET_UPDATED', resource:'assets', resourceId:req.params.id,
      details:req.body, ip:req.ip, ua:req.headers['user-agent'], severity:'info' });

    return res.json({ message: 'Asset updated.' });
  } catch (err) {
    logger.error('asset patch', { err: err.message });
    return res.status(500).json({ error: 'Failed to update asset.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   DELETE /api/assets/:id  (soft-delete → decommissioned)
   ══════════════════════════════════════════════════════════════════ */
router.delete('/:id', requireRole('tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('id',  sql.UniqueIdentifier, req.params.id)
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`UPDATE assets SET status='decommissioned', updated_at=GETUTCDATE()
              WHERE id=@id AND tenant_id=@tid`);

    await logAudit({ tenantId:req.tenantId, userId:req.user.id, userEmail:req.user.email,
      action:'ASSET_DECOMMISSIONED', resource:'assets', resourceId:req.params.id,
      ip:req.ip, ua:req.headers['user-agent'], severity:'warning' });

    return res.json({ message: 'Asset decommissioned.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to decommission asset.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/assets/:id/snapshots
   ══════════════════════════════════════════════════════════════════ */
router.get('/:id/snapshots', async (req, res) => {
  try {
    const pool  = await getPool();
    const hours = Math.min(168, Math.max(1, parseInt(req.query.hours)  || 24));
    const limit = Math.min(2016,            parseInt(req.query.limit)  || 288);

    const r = await pool.request()
      .input('aid', sql.UniqueIdentifier, req.params.id)
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`
        SELECT TOP ${limit}
          id, cpu_pct, mem_pct, disk_pct,
          net_in_kbps, net_out_kbps,
          load_avg_1, load_avg_5, load_avg_15,
          uptime_seconds, process_count, ts
        FROM metric_snapshots
        WHERE asset_id=@aid AND tenant_id=@tid
          AND ts > DATEADD(hour,-${hours},GETUTCDATE())
        ORDER BY ts ASC
      `);
    return res.json(r.recordset);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch snapshots.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/assets/:id/metrics
   ══════════════════════════════════════════════════════════════════ */
router.get('/:id/metrics', async (req, res) => {
  try {
    const pool   = await getPool();
    const hours  = Math.min(168, parseInt(req.query.hours)  || 24);
    const limit  = Math.min(5000, parseInt(req.query.limit) || 500);
    const metric = req.query.metric;

    let where   = `WHERE asset_id=@aid AND tenant_id=@tid AND ts > DATEADD(hour,-${hours},GETUTCDATE())`;
    const request = pool.request()
      .input('aid', sql.UniqueIdentifier, req.params.id)
      .input('tid', sql.UniqueIdentifier, req.tenantId);

    if (metric) { where += ` AND metric_name=@metric`; request.input('metric', sql.NVarChar, metric); }

    const r = await request.query(
      `SELECT TOP ${limit} metric_name, value, unit, ts FROM metrics ${where} ORDER BY ts ASC`
    );
    return res.json(r.recordset);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch metrics.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/assets/:id/logs
   ══════════════════════════════════════════════════════════════════ */
router.get('/:id/logs', async (req, res) => {
  try {
    const pool     = await getPool();
    const hours    = Math.min(168, parseInt(req.query.hours)    || 24);
    const limit    = Math.min(2000, parseInt(req.query.limit)   || 200);
    const severity = req.query.severity;
    const search   = req.query.search;

    let where   = `WHERE asset_id=@aid AND tenant_id=@tid AND ts > DATEADD(hour,-${hours},GETUTCDATE())`;
    const request = pool.request()
      .input('aid', sql.UniqueIdentifier, req.params.id)
      .input('tid', sql.UniqueIdentifier, req.tenantId);

    if (severity) { where += ` AND severity=@sev`;     request.input('sev',    sql.NVarChar, severity); }
    if (search)   { where += ` AND message LIKE @srch`; request.input('srch',  sql.NVarChar, `%${search}%`); }

    const r = await request.query(
      `SELECT TOP ${limit} id, source, severity, message, tags, ts FROM log_entries ${where} ORDER BY ts DESC`
    );
    return res.json(r.recordset);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch logs.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/assets/:id/software
   ══════════════════════════════════════════════════════════════════ */
router.get('/:id/software', async (req, res) => {
  try {
    const pool   = await getPool();
    const search = req.query.search;
    let where    = `WHERE asset_id=@aid`;
    const request = pool.request().input('aid', sql.UniqueIdentifier, req.params.id);
    if (search) { where += ` AND (name LIKE @srch OR publisher LIKE @srch)`; request.input('srch', sql.NVarChar, `%${search}%`); }
    const r = await request.query(`SELECT * FROM asset_software ${where} ORDER BY name`);
    return res.json(r.recordset);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch software.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/assets/:id/ports
   ══════════════════════════════════════════════════════════════════ */
router.get('/:id/ports', async (req, res) => {
  try {
    const pool = await getPool();
    const r    = await pool.request()
      .input('aid', sql.UniqueIdentifier, req.params.id)
      .query(`SELECT * FROM asset_ports WHERE asset_id=@aid ORDER BY port`);
    return res.json(r.recordset);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch ports.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/assets/:id/topology
   ══════════════════════════════════════════════════════════════════ */
router.get('/:id/topology', async (req, res) => {
  try {
    const pool = await getPool();
    const r    = await pool.request()
      .input('aid', sql.UniqueIdentifier, req.params.id)
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`
        SELECT
          ad.id, ad.dep_type, ad.protocol, ad.port, ad.discovered_at,
          sa.id         AS source_id,   sa.name       AS source_name,
          sa.asset_type AS source_type, sa.status     AS source_status,
          sa.ip_address AS source_ip,
          ta.id         AS target_id,   ta.name       AS target_name,
          ta.asset_type AS target_type, ta.status     AS target_status,
          ta.ip_address AS target_ip
        FROM asset_dependencies ad
        JOIN assets sa ON ad.source_id = sa.id
        JOIN assets ta ON ad.target_id = ta.id
        WHERE (ad.source_id=@aid OR ad.target_id=@aid) AND ad.tenant_id=@tid
      `);
    return res.json(r.recordset);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch topology.' });
  }
});

/* POST /api/assets/:id/topology */
router.post('/:id/topology', requireRole('operator','tenant_admin','super_admin'), async (req, res) => {
  try {
    const { target_id, dep_type, protocol, port } = req.body;
    if (!target_id || !dep_type) return res.status(400).json({ error: 'target_id and dep_type are required.' });

    const pool = await getPool();
    const id   = uuidv4();
    await pool.request()
      .input('id',        sql.UniqueIdentifier, id)
      .input('tid',       sql.UniqueIdentifier, req.tenantId)
      .input('source_id', sql.UniqueIdentifier, req.params.id)
      .input('target_id', sql.UniqueIdentifier, target_id)
      .input('dep_type',  sql.NVarChar,         dep_type)
      .input('protocol',  sql.NVarChar,         protocol || null)
      .input('port',      sql.Int,              port     || null)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM asset_dependencies
          WHERE source_id=@source_id AND target_id=@target_id AND dep_type=@dep_type
        )
        INSERT INTO asset_dependencies (id,tenant_id,source_id,target_id,dep_type,protocol,port)
        VALUES (@id,@tid,@source_id,@target_id,@dep_type,@protocol,@port)
      `);
    return res.status(201).json({ id });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create dependency.' });
  }
});

/* DELETE /api/assets/:id/topology/:eid */
router.delete('/:id/topology/:eid', requireRole('operator','tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('id',  sql.UniqueIdentifier, req.params.eid)
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`DELETE FROM asset_dependencies WHERE id=@id AND tenant_id=@tid`);
    return res.json({ message: 'Dependency removed.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to remove dependency.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   POST /api/assets/:id/agent-token  (raw token shown ONCE)
   ══════════════════════════════════════════════════════════════════ */
router.post('/:id/agent-token', requireRole('tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool      = await getPool();
    const rawToken  = crypto.randomBytes(48).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    /* revoke any existing token for this asset */
    await pool.request()
      .input('aid', sql.UniqueIdentifier, req.params.id)
      .query(`UPDATE agent_tokens SET is_revoked=1 WHERE asset_id=@aid AND is_revoked=0`);

    await pool.request()
      .input('tid',  sql.UniqueIdentifier, req.tenantId)
      .input('aid',  sql.UniqueIdentifier, req.params.id)
      .input('hash', sql.NVarChar,         tokenHash)
      .input('desc', sql.NVarChar,         req.body.description || 'Agent token')
      .input('uid',  sql.UniqueIdentifier, req.user.id)
      .query(`INSERT INTO agent_tokens (tenant_id,asset_id,token_hash,description,created_by)
              VALUES (@tid,@aid,@hash,@desc,@uid)`);

    await logAudit({ tenantId:req.tenantId, userId:req.user.id, userEmail:req.user.email,
      action:'AGENT_TOKEN_CREATED', resource:'assets', resourceId:req.params.id,
      ip:req.ip, ua:req.headers['user-agent'], severity:'warning' });

    return res.status(201).json({
      token:   rawToken,
      message: 'Store this token securely — it will NOT be shown again.',
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create agent token.' });
  }
});

/* DELETE /api/assets/:id/agent-token */
router.delete('/:id/agent-token', requireRole('tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('aid', sql.UniqueIdentifier, req.params.id)
      .query(`UPDATE agent_tokens SET is_revoked=1 WHERE asset_id=@aid`);

    await logAudit({ tenantId:req.tenantId, userId:req.user.id, userEmail:req.user.email,
      action:'AGENT_TOKEN_REVOKED', resource:'assets', resourceId:req.params.id,
      ip:req.ip, ua:req.headers['user-agent'], severity:'warning' });

    return res.json({ message: 'Agent token revoked.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to revoke agent token.' });
  }
});

module.exports = router;
