'use strict';
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { getPool, sql } = require('../db/pool');
const { authenticate, requireRole, tenantScope } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
router.use(authenticate, tenantScope);

// GET /api/incidents
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const { status, severity, assigned_to } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 25);
    const offset = (page - 1) * limit;
    let where = `WHERE i.tenant_id=@tid`;
    const request = pool.request().input('tid', sql.UniqueIdentifier, req.tenantId);
    if (status) { where += ` AND i.status=@status`; request.input('status', sql.NVarChar, status); }
    if (severity) { where += ` AND i.severity=@severity`; request.input('severity', sql.NVarChar, severity); }
    if (assigned_to) { where += ` AND i.assigned_to=@assigned_to`; request.input('assigned_to', sql.UniqueIdentifier, assigned_to); }
    const r = await request.query(`
      SELECT i.*, u.display_name AS assigned_to_name, cb.display_name AS created_by_name
      FROM incidents i
      LEFT JOIN users u  ON i.assigned_to=u.id
      LEFT JOIN users cb ON i.created_by=cb.id
      ${where} ORDER BY i.opened_at DESC
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`);
    const summary = await pool.request().input('tid2', sql.UniqueIdentifier, req.tenantId).query(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN status='open'          THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN status='investigating' THEN 1 ELSE 0 END) AS investigating,
        SUM(CASE WHEN status='mitigated'     THEN 1 ELSE 0 END) AS mitigated,
        SUM(CASE WHEN severity='p1'          THEN 1 ELSE 0 END) AS p1,
        SUM(CASE WHEN severity='p2'          THEN 1 ELSE 0 END) AS p2
      FROM incidents WHERE tenant_id=@tid2 AND status NOT IN ('resolved','closed')`);
    res.json({ data: r.recordset, summary: summary.recordset[0], page, limit });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch incidents.' }); }
});

// GET /api/incidents/:id
router.get('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT i.*, u.display_name AS assigned_to_name FROM incidents i LEFT JOIN users u ON i.assigned_to=u.id WHERE i.id=@id AND i.tenant_id=@tid`);
    if (!r.recordset.length) return res.status(404).json({ error: 'Incident not found.' });
    res.json(r.recordset[0]);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch incident.' }); }
});

// POST /api/incidents
router.post('/', requireRole('operator','tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool(); const id = uuidv4();
    const { title, description, severity, assigned_to, alert_ids, asset_ids, ticket_id } = req.body;
    if (!title || !severity) return res.status(400).json({ error: 'title and severity required.' });
    await pool.request()
      .input('id', sql.UniqueIdentifier, id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .input('title', sql.NVarChar, title).input('description', sql.NVarChar, description || null)
      .input('severity', sql.NVarChar, severity).input('assigned_to', sql.UniqueIdentifier, assigned_to || null)
      .input('alert_ids', sql.NVarChar, alert_ids ? JSON.stringify(alert_ids) : null)
      .input('asset_ids', sql.NVarChar, asset_ids ? JSON.stringify(asset_ids) : null)
      .input('ticket_id', sql.NVarChar, ticket_id || null)
      .input('created_by', sql.UniqueIdentifier, req.user.id)
      .query(`INSERT INTO incidents (id,tenant_id,title,description,severity,assigned_to,alert_ids,asset_ids,ticket_id,created_by) VALUES (@id,@tid,@title,@description,@severity,@assigned_to,@alert_ids,@asset_ids,@ticket_id,@created_by)`);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'INCIDENT_CREATED', resource: 'incidents', resourceId: id, details: { title, severity }, ip: req.ip, ua: req.headers['user-agent'], severity: 'warning' });
    res.status(201).json({ id, title, severity });
  } catch (e) { res.status(500).json({ error: 'Failed to create incident.' }); }
});

// PATCH /api/incidents/:id
router.patch('/:id', requireRole('operator','tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    const allowed = ['title','description','severity','status','ticket_id','rca'];
    const sets = []; const request = pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId);
    for (const k of allowed) { if (req.body[k] !== undefined) { sets.push(`${k}=@${k}`); request.input(k, sql.NVarChar, req.body[k]); } }
    if (req.body.assigned_to !== undefined) { sets.push('assigned_to=@assigned_to'); request.input('assigned_to', sql.UniqueIdentifier, req.body.assigned_to || null); }
    if (req.body.timeline !== undefined) { sets.push('timeline=@timeline'); request.input('timeline', sql.NVarChar, JSON.stringify(req.body.timeline)); }
    if (req.body.status === 'resolved' || req.body.status === 'closed') { sets.push('resolved_at=GETUTCDATE()'); }
    if (sets.length) { sets.push('updated_at=GETUTCDATE()'); await request.query(`UPDATE incidents SET ${sets.join(',')} WHERE id=@id AND tenant_id=@tid`); }
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'INCIDENT_UPDATED', resource: 'incidents', resourceId: req.params.id, details: req.body, ip: req.ip, ua: req.headers['user-agent'], severity: 'info' });
    res.json({ message: 'Incident updated.' });
  } catch (e) { res.status(500).json({ error: 'Failed to update incident.' }); }
});

// POST /api/incidents/:id/timeline — append a timeline entry
router.post('/:id/timeline', requireRole('operator','tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    const current = await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT timeline FROM incidents WHERE id=@id AND tenant_id=@tid`);
    if (!current.recordset.length) return res.status(404).json({ error: 'Incident not found.' });
    let timeline = [];
    try { timeline = JSON.parse(current.recordset[0].timeline || '[]'); } catch {}
    timeline.push({ ts: new Date().toISOString(), author: req.user.display_name, note: req.body.note || '' });
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tl', sql.NVarChar, JSON.stringify(timeline))
      .query(`UPDATE incidents SET timeline=@tl, updated_at=GETUTCDATE() WHERE id=@id`);
    res.json({ message: 'Timeline updated.', entries: timeline.length });
  } catch (e) { res.status(500).json({ error: 'Failed to update timeline.' }); }
});

// DELETE /api/incidents/:id
router.delete('/:id', requireRole('tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`UPDATE incidents SET status='closed', updated_at=GETUTCDATE() WHERE id=@id AND tenant_id=@tid`);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'INCIDENT_CLOSED', resource: 'incidents', resourceId: req.params.id, ip: req.ip, ua: req.headers['user-agent'], severity: 'warning' });
    res.json({ message: 'Incident closed.' });
  } catch (e) { res.status(500).json({ error: 'Failed to close incident.' }); }
});

module.exports = router;
