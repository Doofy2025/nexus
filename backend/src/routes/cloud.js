'use strict';
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { getPool, sql } = require('../db/pool');
const { authenticate, requireRole, tenantScope } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const logger = require('../utils/logger');
router.use(authenticate, tenantScope);

/* ══════════════════════════════════════════════════════════════════
   GET /api/cloud
   List cloud resources with filters + pagination
   ══════════════════════════════════════════════════════════════════ */
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const { provider, resource_type, region, account_id, status, search } = req.query;
    const page   = Math.max(1,   parseInt(req.query.page)  || 1);
    const limit  = Math.min(500, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;

    let where = `WHERE cr.tenant_id=@tid`;
    const request = pool.request().input('tid', sql.UniqueIdentifier, req.tenantId);
    if (provider)      { where += ` AND cr.provider=@provider`;           request.input('provider',      sql.NVarChar, provider); }
    if (resource_type) { where += ` AND cr.resource_type=@resource_type`; request.input('resource_type', sql.NVarChar, resource_type); }
    if (region)        { where += ` AND cr.region=@region`;               request.input('region',        sql.NVarChar, region); }
    if (account_id)    { where += ` AND cr.account_id=@account_id`;       request.input('account_id',    sql.NVarChar, account_id); }
    if (status)        { where += ` AND cr.status=@status`;               request.input('status',        sql.NVarChar, status); }
    if (search) {
      where += ` AND (cr.resource_name LIKE @srch OR cr.resource_id LIKE @srch OR cr.region LIKE @srch)`;
      request.input('srch', sql.NVarChar, `%${search}%`);
    }

    const cntReq = pool.request().input('tid2', sql.UniqueIdentifier, req.tenantId);
    let cntWhere = `WHERE cr.tenant_id=@tid2`;
    if (provider)      { cntWhere += ` AND cr.provider=@p2`;       cntReq.input('p2',  sql.NVarChar, provider); }
    if (resource_type) { cntWhere += ` AND cr.resource_type=@rt2`; cntReq.input('rt2', sql.NVarChar, resource_type); }
    const cntRes = await cntReq.query(`SELECT COUNT(*) AS total FROM cloud_resources cr ${cntWhere}`);

    const r = await request.query(`
      SELECT cr.*, a.name AS asset_name
      FROM cloud_resources cr
      LEFT JOIN assets a ON cr.asset_id=a.id
      ${where}
      ORDER BY cr.provider, cr.resource_type, cr.resource_name
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`);

    res.json({ data: r.recordset, total: cntRes.recordset[0].total, page, limit });
  } catch (e) { logger.error('cloud list', { err: e.message }); res.status(500).json({ error: 'Failed to fetch cloud resources.' }); }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/cloud/summary
   ══════════════════════════════════════════════════════════════════ */
router.get('/summary', async (req, res) => {
  try {
    const pool = await getPool();
    const totals = await pool.request().input('tid', sql.UniqueIdentifier, req.tenantId).query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN provider='aws'   THEN 1 ELSE 0 END) AS aws,
        SUM(CASE WHEN provider='azure' THEN 1 ELSE 0 END) AS azure,
        SUM(CASE WHEN provider='gcp'   THEN 1 ELSE 0 END) AS gcp,
        SUM(CASE WHEN provider='oracle' THEN 1 ELSE 0 END) AS oracle,
        SUM(CASE WHEN provider='other' THEN 1 ELSE 0 END) AS other,
        SUM(ISNULL(cost_daily,0))   AS total_cost_daily,
        SUM(ISNULL(cost_monthly,0)) AS total_cost_monthly,
        COUNT(DISTINCT account_id)  AS account_count,
        COUNT(DISTINCT region)      AS region_count,
        COUNT(DISTINCT resource_type) AS resource_type_count
      FROM cloud_resources WHERE tenant_id=@tid`);

    const byType = await pool.request().input('tid2', sql.UniqueIdentifier, req.tenantId).query(`
      SELECT provider, resource_type, COUNT(*) AS count,
             SUM(ISNULL(cost_monthly,0)) AS cost_monthly
      FROM cloud_resources WHERE tenant_id=@tid2
      GROUP BY provider, resource_type ORDER BY provider, count DESC`);

    const byRegion = await pool.request().input('tid3', sql.UniqueIdentifier, req.tenantId).query(`
      SELECT provider, region, COUNT(*) AS count
      FROM cloud_resources WHERE tenant_id=@tid3 AND region IS NOT NULL
      GROUP BY provider, region ORDER BY count DESC`);

    res.json({ totals: totals.recordset[0], byType: byType.recordset, byRegion: byRegion.recordset });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch cloud summary.' }); }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/cloud/providers
   Distinct providers + account IDs present
   ══════════════════════════════════════════════════════════════════ */
router.get('/providers', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().input('tid', sql.UniqueIdentifier, req.tenantId).query(`
      SELECT provider, account_id, COUNT(*) AS resource_count, MAX(last_synced) AS last_synced
      FROM cloud_resources WHERE tenant_id=@tid
      GROUP BY provider, account_id ORDER BY provider, account_id`);
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch providers.' }); }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/cloud/:id
   ══════════════════════════════════════════════════════════════════ */
router.get('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT cr.*, a.name AS asset_name FROM cloud_resources cr LEFT JOIN assets a ON cr.asset_id=a.id WHERE cr.id=@id AND cr.tenant_id=@tid`);
    if (!r.recordset.length) return res.status(404).json({ error: 'Cloud resource not found.' });
    res.json(r.recordset[0]);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch cloud resource.' }); }
});

/* ══════════════════════════════════════════════════════════════════
   POST /api/cloud
   Manual registration or sync ingest
   ══════════════════════════════════════════════════════════════════ */
router.post('/', requireRole('operator', 'tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool(); const id = uuidv4();
    const { provider, resource_type, resource_id, resource_name, region, account_id, status, tags, cost_daily, cost_monthly, raw_metadata, asset_id } = req.body;
    if (!provider || !resource_type || !resource_id) return res.status(400).json({ error: 'provider, resource_type, resource_id required.' });
    const validProviders = ['aws','azure','gcp','oracle','other'];
    if (!validProviders.includes(provider)) return res.status(400).json({ error: `provider must be one of: ${validProviders.join(', ')}` });
    await pool.request()
      .input('id',            sql.UniqueIdentifier, id)
      .input('tid',           sql.UniqueIdentifier, req.tenantId)
      .input('asset_id',      sql.UniqueIdentifier, asset_id     || null)
      .input('provider',      sql.NVarChar,         provider)
      .input('resource_type', sql.NVarChar,         resource_type)
      .input('resource_id',   sql.NVarChar,         resource_id)
      .input('resource_name', sql.NVarChar,         resource_name || null)
      .input('region',        sql.NVarChar,         region        || null)
      .input('account_id',    sql.NVarChar,         account_id    || null)
      .input('status',        sql.NVarChar,         status        || null)
      .input('tags',          sql.NVarChar,         tags          ? JSON.stringify(tags)         : null)
      .input('raw_metadata',  sql.NVarChar,         raw_metadata  ? JSON.stringify(raw_metadata) : null)
      .input('cost_daily',    sql.Float,            cost_daily    ?? null)
      .input('cost_monthly',  sql.Float,            cost_monthly  ?? null)
      .query(`INSERT INTO cloud_resources (id,tenant_id,asset_id,provider,resource_type,resource_id,resource_name,region,account_id,status,tags,raw_metadata,cost_daily,cost_monthly,last_synced)
              VALUES (@id,@tid,@asset_id,@provider,@resource_type,@resource_id,@resource_name,@region,@account_id,@status,@tags,@raw_metadata,@cost_daily,@cost_monthly,GETUTCDATE())`);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'CLOUD_RESOURCE_ADDED', resource: 'cloud_resources', resourceId: id, details: { provider, resource_type, resource_name }, ip: req.ip, ua: req.headers['user-agent'], severity: 'info' });
    res.status(201).json({ id, provider, resource_type, resource_name });
  } catch (e) { logger.error('cloud create', { err: e.message }); res.status(500).json({ error: 'Failed to add cloud resource.' }); }
});

/* ══════════════════════════════════════════════════════════════════
   POST /api/cloud/bulk — batch sync ingest from cloud connector
   ══════════════════════════════════════════════════════════════════ */
router.post('/bulk', requireRole('operator', 'tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const { resources } = req.body;
    if (!Array.isArray(resources) || !resources.length) return res.status(400).json({ error: 'resources array required.' });
    const pool = await getPool(); let upserted = 0;
    const validProviders = new Set(['aws','azure','gcp','oracle','other']);
    for (const item of resources.slice(0, 2000)) {
      if (!item.provider || !item.resource_type || !item.resource_id) continue;
      if (!validProviders.has(item.provider)) continue;
      const existing = await pool.request()
        .input('rid', sql.NVarChar, item.resource_id).input('prov', sql.NVarChar, item.provider).input('tid', sql.UniqueIdentifier, req.tenantId)
        .query(`SELECT id FROM cloud_resources WHERE resource_id=@rid AND provider=@prov AND tenant_id=@tid`);
      if (existing.recordset.length) {
        await pool.request()
          .input('rid',   sql.NVarChar, item.resource_id).input('tid',  sql.UniqueIdentifier, req.tenantId)
          .input('name',  sql.NVarChar, item.resource_name || null).input('status', sql.NVarChar, item.status || null)
          .input('cost_daily',   sql.Float, item.cost_daily   ?? null)
          .input('cost_monthly', sql.Float, item.cost_monthly ?? null)
          .input('tags', sql.NVarChar, item.tags ? JSON.stringify(item.tags) : null)
          .input('meta', sql.NVarChar, item.raw_metadata ? JSON.stringify(item.raw_metadata) : null)
          .query(`UPDATE cloud_resources SET resource_name=@name,status=@status,cost_daily=@cost_daily,cost_monthly=@cost_monthly,tags=@tags,raw_metadata=@meta,last_synced=GETUTCDATE() WHERE resource_id=@rid AND tenant_id=@tid`);
      } else {
        await pool.request()
          .input('id',  sql.UniqueIdentifier, uuidv4()).input('tid', sql.UniqueIdentifier, req.tenantId)
          .input('provider',      sql.NVarChar, item.provider)
          .input('resource_type', sql.NVarChar, item.resource_type)
          .input('resource_id',   sql.NVarChar, item.resource_id)
          .input('resource_name', sql.NVarChar, item.resource_name || null)
          .input('region',        sql.NVarChar, item.region        || null)
          .input('account_id',    sql.NVarChar, item.account_id    || null)
          .input('status',        sql.NVarChar, item.status        || null)
          .input('cost_daily',    sql.Float,    item.cost_daily    ?? null)
          .input('cost_monthly',  sql.Float,    item.cost_monthly  ?? null)
          .input('tags', sql.NVarChar, item.tags         ? JSON.stringify(item.tags)         : null)
          .input('meta', sql.NVarChar, item.raw_metadata ? JSON.stringify(item.raw_metadata) : null)
          .query(`INSERT INTO cloud_resources (id,tenant_id,provider,resource_type,resource_id,resource_name,region,account_id,status,cost_daily,cost_monthly,tags,raw_metadata,last_synced)
                  VALUES (@id,@tid,@provider,@resource_type,@resource_id,@resource_name,@region,@account_id,@status,@cost_daily,@cost_monthly,@tags,@meta,GETUTCDATE())`);
      }
      upserted++;
    }
    res.status(201).json({ upserted, message: `${upserted} resource(s) synced.` });
  } catch (e) { logger.error('cloud bulk', { err: e.message }); res.status(500).json({ error: 'Cloud bulk sync failed.' }); }
});

/* ══════════════════════════════════════════════════════════════════
   PATCH /api/cloud/:id
   ══════════════════════════════════════════════════════════════════ */
router.patch('/:id', requireRole('operator', 'tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    const sets = []; const request = pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId);
    const textFields = ['resource_name','region','account_id','status'];
    for (const k of textFields) { if (req.body[k] !== undefined) { sets.push(`${k}=@${k}`); request.input(k, sql.NVarChar, req.body[k]); } }
    if (req.body.cost_daily   !== undefined) { sets.push('cost_daily=@cd');   request.input('cd',  sql.Float,            req.body.cost_daily); }
    if (req.body.cost_monthly !== undefined) { sets.push('cost_monthly=@cm'); request.input('cm',  sql.Float,            req.body.cost_monthly); }
    if (req.body.asset_id     !== undefined) { sets.push('asset_id=@aid');    request.input('aid', sql.UniqueIdentifier, req.body.asset_id || null); }
    if (req.body.tags         !== undefined) { sets.push('tags=@tags');        request.input('tags', sql.NVarChar, JSON.stringify(req.body.tags)); }
    if (sets.length) { sets.push('updated_at=GETUTCDATE()'); await request.query(`UPDATE cloud_resources SET ${sets.join(',')} WHERE id=@id AND tenant_id=@tid`); }
    res.json({ message: 'Cloud resource updated.' });
  } catch (e) { res.status(500).json({ error: 'Failed to update cloud resource.' }); }
});

/* ══════════════════════════════════════════════════════════════════
   DELETE /api/cloud/:id
   ══════════════════════════════════════════════════════════════════ */
router.delete('/:id', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`DELETE FROM cloud_resources WHERE id=@id AND tenant_id=@tid`);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'CLOUD_RESOURCE_DELETED', resource: 'cloud_resources', resourceId: req.params.id, ip: req.ip, ua: req.headers['user-agent'], severity: 'info' });
    res.json({ message: 'Cloud resource deleted.' });
  } catch (e) { res.status(500).json({ error: 'Failed to delete cloud resource.' }); }
});

module.exports = router;
