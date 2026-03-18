'use strict';
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { getPool, sql } = require('../db/pool');
const { authenticate, requireRole, tenantScope } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
router.use(authenticate, tenantScope);

// GET /api/alerts/rules
router.get('/rules', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT ar.*, u.display_name AS created_by_name FROM alert_rules ar
              LEFT JOIN users u ON ar.created_by=u.id WHERE ar.tenant_id=@tid ORDER BY ar.name`);
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch alert rules.' }); }
});

// POST /api/alerts/rules
router.post('/rules', requireRole('operator','tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool(); const id = uuidv4();
    const { name, description, metric_name, condition, threshold, duration_secs, severity, asset_filter, notification_channels, auto_remediate } = req.body;
    if (!name || !condition || !severity) return res.status(400).json({ error: 'name, condition, severity required.' });
    await pool.request()
      .input('id', sql.UniqueIdentifier, id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .input('name', sql.NVarChar, name).input('description', sql.NVarChar, description || null)
      .input('metric_name', sql.NVarChar, metric_name || null).input('condition', sql.NVarChar, condition)
      .input('threshold', sql.Float, threshold ?? null).input('duration_secs', sql.Int, duration_secs || 60)
      .input('severity', sql.NVarChar, severity)
      .input('asset_filter', sql.NVarChar, asset_filter ? JSON.stringify(asset_filter) : null)
      .input('notification_channels', sql.NVarChar, notification_channels ? JSON.stringify(notification_channels) : null)
      .input('auto_remediate', sql.Bit, auto_remediate ? 1 : 0)
      .input('created_by', sql.UniqueIdentifier, req.user.id)
      .query(`INSERT INTO alert_rules (id,tenant_id,name,description,metric_name,condition,threshold,duration_secs,severity,asset_filter,notification_channels,auto_remediate,created_by)
              VALUES (@id,@tid,@name,@description,@metric_name,@condition,@threshold,@duration_secs,@severity,@asset_filter,@notification_channels,@auto_remediate,@created_by)`);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'ALERT_RULE_CREATED', resource: 'alert_rules', resourceId: id, details: { name, severity }, ip: req.ip, ua: req.headers['user-agent'], severity: 'info' });
    res.status(201).json({ id, name });
  } catch (e) { res.status(500).json({ error: 'Failed to create alert rule.' }); }
});

// PATCH /api/alerts/rules/:id
router.patch('/rules/:id', requireRole('operator','tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    const allowed = ['name','description','metric_name','condition','severity'];
    const sets = []; const request = pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId);
    for (const k of allowed) { if (req.body[k] !== undefined) { sets.push(`${k}=@${k}`); request.input(k, sql.NVarChar, req.body[k]); } }
    if (req.body.threshold !== undefined) { sets.push('threshold=@threshold'); request.input('threshold', sql.Float, req.body.threshold); }
    if (req.body.duration_secs !== undefined) { sets.push('duration_secs=@duration_secs'); request.input('duration_secs', sql.Int, req.body.duration_secs); }
    if (req.body.auto_remediate !== undefined) { sets.push('auto_remediate=@auto_remediate'); request.input('auto_remediate', sql.Bit, req.body.auto_remediate ? 1 : 0); }
    if (sets.length) { sets.push('updated_at=GETUTCDATE()'); await request.query(`UPDATE alert_rules SET ${sets.join(',')} WHERE id=@id AND tenant_id=@tid`); }
    res.json({ message: 'Rule updated.' });
  } catch (e) { res.status(500).json({ error: 'Failed to update rule.' }); }
});

// PATCH /api/alerts/rules/:id/toggle
router.patch('/rules/:id/toggle', requireRole('operator','tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`UPDATE alert_rules SET is_enabled=CASE WHEN is_enabled=1 THEN 0 ELSE 1 END, updated_at=GETUTCDATE() WHERE id=@id AND tenant_id=@tid`);
    res.json({ message: 'Toggled.' });
  } catch (e) { res.status(500).json({ error: 'Failed to toggle rule.' }); }
});

// DELETE /api/alerts/rules/:id
router.delete('/rules/:id', requireRole('tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`DELETE FROM alert_rules WHERE id=@id AND tenant_id=@tid`);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'ALERT_RULE_DELETED', resource: 'alert_rules', resourceId: req.params.id, ip: req.ip, ua: req.headers['user-agent'], severity: 'warning' });
    res.json({ message: 'Rule deleted.' });
  } catch (e) { res.status(500).json({ error: 'Failed to delete rule.' }); }
});

// GET /api/alerts
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const { status, severity, asset_id, site_id } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;
    let where = `WHERE al.tenant_id=@tid`;
    const request = pool.request().input('tid', sql.UniqueIdentifier, req.tenantId);
    if (status) { where += ` AND al.status=@status`; request.input('status', sql.NVarChar, status); }
    else { where += ` AND al.status NOT IN ('resolved','suppressed')`; }
    if (severity) { where += ` AND al.severity=@severity`; request.input('severity', sql.NVarChar, severity); }
    if (asset_id) { where += ` AND al.asset_id=@asset_id`; request.input('asset_id', sql.UniqueIdentifier, asset_id); }
    const r = await request.query(`
      SELECT al.*, a.name AS asset_name, a.hostname AS asset_hostname, a.ip_address AS asset_ip
      FROM alerts al LEFT JOIN assets a ON al.asset_id=a.id ${where}
      ORDER BY al.triggered_at DESC
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`);
    const summary = await pool.request().input('tid2', sql.UniqueIdentifier, req.tenantId).query(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN status='open' AND severity='critical' THEN 1 ELSE 0 END) AS open_critical,
        SUM(CASE WHEN status='open' AND severity='high'     THEN 1 ELSE 0 END) AS open_high,
        SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open_total,
        SUM(CASE WHEN status='acknowledged' THEN 1 ELSE 0 END) AS acknowledged
      FROM alerts WHERE tenant_id=@tid2`);
    res.json({ data: r.recordset, summary: summary.recordset[0], page, limit });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch alerts.' }); }
});

// GET /api/alerts/:id
router.get('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT al.*, a.name AS asset_name, a.hostname AS asset_hostname FROM alerts al LEFT JOIN assets a ON al.asset_id=a.id WHERE al.id=@id AND al.tenant_id=@tid`);
    if (!r.recordset.length) return res.status(404).json({ error: 'Alert not found.' });
    res.json(r.recordset[0]);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch alert.' }); }
});

// POST /api/alerts (manual alert creation)
router.post('/', requireRole('operator','tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool(); const id = uuidv4();
    const { title, description, severity, asset_id, metric_name, metric_value, threshold } = req.body;
    if (!title || !severity) return res.status(400).json({ error: 'title and severity required.' });
    await pool.request()
      .input('id', sql.UniqueIdentifier, id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .input('title', sql.NVarChar, title).input('description', sql.NVarChar, description || null)
      .input('severity', sql.NVarChar, severity).input('asset_id', sql.UniqueIdentifier, asset_id || null)
      .input('metric_name', sql.NVarChar, metric_name || null).input('metric_value', sql.Float, metric_value ?? null)
      .input('threshold', sql.Float, threshold ?? null)
      .query(`INSERT INTO alerts (id,tenant_id,title,description,severity,asset_id,metric_name,metric_value,threshold) VALUES (@id,@tid,@title,@description,@severity,@asset_id,@metric_name,@metric_value,@threshold)`);
    res.status(201).json({ id, title });
  } catch (e) { res.status(500).json({ error: 'Failed to create alert.' }); }
});

// POST /api/alerts/:id/acknowledge
router.post('/:id/acknowledge', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId).input('uid', sql.UniqueIdentifier, req.user.id)
      .query(`UPDATE alerts SET status='acknowledged', acknowledged_at=GETUTCDATE(), acknowledged_by=@uid WHERE id=@id AND tenant_id=@tid AND status='open'`);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'ALERT_ACKNOWLEDGED', resource: 'alerts', resourceId: req.params.id, ip: req.ip, ua: req.headers['user-agent'], severity: 'info' });
    res.json({ message: 'Alert acknowledged.' });
  } catch (e) { res.status(500).json({ error: 'Failed to acknowledge.' }); }
});

// POST /api/alerts/:id/resolve
router.post('/:id/resolve', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId).input('uid', sql.UniqueIdentifier, req.user.id)
      .query(`UPDATE alerts SET status='resolved', resolved_at=GETUTCDATE(), resolved_by=@uid WHERE id=@id AND tenant_id=@tid AND status IN ('open','acknowledged')`);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'ALERT_RESOLVED', resource: 'alerts', resourceId: req.params.id, ip: req.ip, ua: req.headers['user-agent'], severity: 'info' });
    res.json({ message: 'Alert resolved.' });
  } catch (e) { res.status(500).json({ error: 'Failed to resolve.' }); }
});

// POST /api/alerts/:id/suppress
router.post('/:id/suppress', requireRole('operator','tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`UPDATE alerts SET status='suppressed' WHERE id=@id AND tenant_id=@tid`);
    res.json({ message: 'Alert suppressed.' });
  } catch (e) { res.status(500).json({ error: 'Failed to suppress.' }); }
});

// GET /api/alerts/maintenance
router.get('/maintenance/windows', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT mw.*, u.display_name AS created_by_name FROM maintenance_windows mw LEFT JOIN users u ON mw.created_by=u.id WHERE mw.tenant_id=@tid ORDER BY mw.starts_at DESC`);
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch maintenance windows.' }); }
});

// POST /api/alerts/maintenance
router.post('/maintenance/windows', requireRole('operator','tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool(); const id = uuidv4();
    const { name, asset_ids, starts_at, ends_at } = req.body;
    if (!name || !starts_at || !ends_at) return res.status(400).json({ error: 'name, starts_at, ends_at required.' });
    await pool.request()
      .input('id', sql.UniqueIdentifier, id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .input('name', sql.NVarChar, name).input('asset_ids', sql.NVarChar, asset_ids ? JSON.stringify(asset_ids) : null)
      .input('starts_at', sql.DateTime2, new Date(starts_at)).input('ends_at', sql.DateTime2, new Date(ends_at))
      .input('created_by', sql.UniqueIdentifier, req.user.id)
      .query(`INSERT INTO maintenance_windows (id,tenant_id,name,asset_ids,starts_at,ends_at,created_by) VALUES (@id,@tid,@name,@asset_ids,@starts_at,@ends_at,@created_by)`);
    res.status(201).json({ id, name });
  } catch (e) { res.status(500).json({ error: 'Failed to create maintenance window.' }); }
});

// DELETE /api/alerts/maintenance/:id
router.delete('/maintenance/windows/:id', requireRole('operator','tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`DELETE FROM maintenance_windows WHERE id=@id AND tenant_id=@tid`);
    res.json({ message: 'Maintenance window deleted.' });
  } catch (e) { res.status(500).json({ error: 'Failed to delete maintenance window.' }); }
});

// GET /api/alerts/notification-channels
router.get('/notification/channels', requireRole('tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT id,name,type,is_enabled,created_at FROM notification_channels WHERE tenant_id=@tid ORDER BY name`);
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch channels.' }); }
});

// POST /api/alerts/notification-channels
router.post('/notification/channels', requireRole('tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool(); const id = uuidv4();
    const { name, type, config } = req.body;
    if (!name || !type || !config) return res.status(400).json({ error: 'name, type, config required.' });
    await pool.request()
      .input('id', sql.UniqueIdentifier, id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .input('name', sql.NVarChar, name).input('type', sql.NVarChar, type)
      .input('config', sql.NVarChar, JSON.stringify(config))
      .query(`INSERT INTO notification_channels (id,tenant_id,name,type,config) VALUES (@id,@tid,@name,@type,@config)`);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'CHANNEL_CREATED', resource: 'notification_channels', resourceId: id, details: { name, type }, ip: req.ip, ua: req.headers['user-agent'], severity: 'info' });
    res.status(201).json({ id, name, type });
  } catch (e) { res.status(500).json({ error: 'Failed to create channel.' }); }
});

// PATCH /api/alerts/notification-channels/:id/toggle
router.patch('/notification/channels/:id/toggle', requireRole('tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`UPDATE notification_channels SET is_enabled=CASE WHEN is_enabled=1 THEN 0 ELSE 1 END WHERE id=@id AND tenant_id=@tid`);
    res.json({ message: 'Toggled.' });
  } catch (e) { res.status(500).json({ error: 'Failed to toggle channel.' }); }
});

// DELETE /api/alerts/notification-channels/:id
router.delete('/notification/channels/:id', requireRole('tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`DELETE FROM notification_channels WHERE id=@id AND tenant_id=@tid`);
    res.json({ message: 'Channel deleted.' });
  } catch (e) { res.status(500).json({ error: 'Failed to delete channel.' }); }
});

module.exports = router;
