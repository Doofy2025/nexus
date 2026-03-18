'use strict';
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { getPool, sql } = require('../db/pool');
const { authenticate, requireRole, tenantScope } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
router.use(authenticate, tenantScope);

/* ══════════════════════════════════════════════════════════════════
   DASHBOARDS
   GET    /api/dashboards            list own + shared
   GET    /api/dashboards/:id        get single
   POST   /api/dashboards            create
   PATCH  /api/dashboards/:id        update layout/widgets
   DELETE /api/dashboards/:id        delete
   POST   /api/dashboards/:id/share  toggle shared flag
   POST   /api/dashboards/:id/default set as tenant default
   ══════════════════════════════════════════════════════════════════ */

router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .input('uid', sql.UniqueIdentifier, req.user.id)
      .query(`SELECT d.*, u.display_name AS owner_name
              FROM dashboards d LEFT JOIN users u ON d.user_id=u.id
              WHERE d.tenant_id=@tid AND (d.user_id=@uid OR d.is_shared=1 OR d.is_default=1)
              ORDER BY d.is_default DESC, d.is_shared DESC, d.name`);
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch dashboards.' }); }
});

router.get('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.UniqueIdentifier, req.params.id)
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .input('uid', sql.UniqueIdentifier, req.user.id)
      .query(`SELECT d.*, u.display_name AS owner_name FROM dashboards d LEFT JOIN users u ON d.user_id=u.id
              WHERE d.id=@id AND d.tenant_id=@tid AND (d.user_id=@uid OR d.is_shared=1 OR d.is_default=1)`);
    if (!r.recordset.length) return res.status(404).json({ error: 'Dashboard not found.' });
    res.json(r.recordset[0]);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch dashboard.' }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, layout, widgets, is_shared } = req.body;
    if (!name) return res.status(400).json({ error: 'name required.' });
    const pool = await getPool(); const id = uuidv4();
    await pool.request()
      .input('id',        sql.UniqueIdentifier, id)
      .input('tid',       sql.UniqueIdentifier, req.tenantId)
      .input('uid',       sql.UniqueIdentifier, req.user.id)
      .input('name',      sql.NVarChar, name)
      .input('layout',    sql.NVarChar, layout  ? JSON.stringify(layout)  : null)
      .input('widgets',   sql.NVarChar, widgets ? JSON.stringify(widgets) : null)
      .input('is_shared', sql.Bit, is_shared ? 1 : 0)
      .query(`INSERT INTO dashboards (id,tenant_id,user_id,name,layout,widgets,is_shared) VALUES (@id,@tid,@uid,@name,@layout,@widgets,@is_shared)`);
    res.status(201).json({ id, name });
  } catch (e) { res.status(500).json({ error: 'Failed to create dashboard.' }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const check = await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('uid', sql.UniqueIdentifier, req.user.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT 1 FROM dashboards WHERE id=@id AND tenant_id=@tid AND (user_id=@uid OR @role='super_admin' OR @role='tenant_admin')`);
    // simplified — check ownership then update
    const sets = []; const request = pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId);
    if (req.body.name      !== undefined) { sets.push('name=@name');         request.input('name',      sql.NVarChar, req.body.name); }
    if (req.body.layout    !== undefined) { sets.push('layout=@layout');     request.input('layout',    sql.NVarChar, JSON.stringify(req.body.layout)); }
    if (req.body.widgets   !== undefined) { sets.push('widgets=@widgets');   request.input('widgets',   sql.NVarChar, JSON.stringify(req.body.widgets)); }
    if (req.body.is_shared !== undefined) { sets.push('is_shared=@is_shared'); request.input('is_shared', sql.Bit, req.body.is_shared ? 1 : 0); }
    if (sets.length) { sets.push('updated_at=GETUTCDATE()'); await request.query(`UPDATE dashboards SET ${sets.join(',')} WHERE id=@id AND tenant_id=@tid`); }
    res.json({ message: 'Dashboard updated.' });
  } catch (e) { res.status(500).json({ error: 'Failed to update dashboard.' }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`DELETE FROM dashboards WHERE id=@id AND tenant_id=@tid`);
    res.json({ message: 'Dashboard deleted.' });
  } catch (e) { res.status(500).json({ error: 'Failed to delete dashboard.' }); }
});

router.post('/:id/share', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`UPDATE dashboards SET is_shared=CASE WHEN is_shared=1 THEN 0 ELSE 1 END, updated_at=GETUTCDATE() WHERE id=@id AND tenant_id=@tid`);
    res.json({ message: 'Share toggled.' });
  } catch (e) { res.status(500).json({ error: 'Failed to toggle share.' }); }
});

router.post('/:id/default', requireRole('tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`UPDATE dashboards SET is_default=0 WHERE tenant_id=@tid`);
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`UPDATE dashboards SET is_default=1, is_shared=1, updated_at=GETUTCDATE() WHERE id=@id AND tenant_id=@tid`);
    res.json({ message: 'Default dashboard set.' });
  } catch (e) { res.status(500).json({ error: 'Failed to set default.' }); }
});

/* ══════════════════════════════════════════════════════════════════
   REPORTS
   GET    /api/dashboards/reports            list reports
   GET    /api/dashboards/reports/:id        get report + last result
   POST   /api/dashboards/reports            create report definition
   POST   /api/dashboards/reports/:id/run    generate report now
   PATCH  /api/dashboards/reports/:id        update definition
   DELETE /api/dashboards/reports/:id        delete
   ══════════════════════════════════════════════════════════════════ */

const REPORT_TYPES = ['assets','alerts','incidents','compliance','certificates','cloud','mobile','audit','executive_summary'];

router.get('/reports', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT r.*, u.display_name AS created_by_name FROM reports r LEFT JOIN users u ON r.created_by=u.id WHERE r.tenant_id=@tid ORDER BY r.name`);
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch reports.' }); }
});

router.get('/reports/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT * FROM reports WHERE id=@id AND tenant_id=@tid`);
    if (!r.recordset.length) return res.status(404).json({ error: 'Report not found.' });
    res.json(r.recordset[0]);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch report.' }); }
});

router.post('/reports', requireRole('operator','tenant_admin','super_admin'), async (req, res) => {
  try {
    const { name, report_type, filters, schedule, output_format } = req.body;
    if (!name || !report_type) return res.status(400).json({ error: 'name and report_type required.' });
    if (!REPORT_TYPES.includes(report_type)) return res.status(400).json({ error: `report_type must be one of: ${REPORT_TYPES.join(', ')}` });
    const pool = await getPool(); const id = uuidv4();
    await pool.request()
      .input('id',            sql.UniqueIdentifier, id)
      .input('tid',           sql.UniqueIdentifier, req.tenantId)
      .input('name',          sql.NVarChar, name)
      .input('report_type',   sql.NVarChar, report_type)
      .input('filters',       sql.NVarChar, filters       ? JSON.stringify(filters)  : null)
      .input('schedule',      sql.NVarChar, schedule      || null)
      .input('output_format', sql.NVarChar, output_format || 'json')
      .input('created_by',    sql.UniqueIdentifier, req.user.id)
      .query(`INSERT INTO reports (id,tenant_id,name,report_type,filters,schedule,output_format,created_by) VALUES (@id,@tid,@name,@report_type,@filters,@schedule,@output_format,@created_by)`);
    res.status(201).json({ id, name, report_type });
  } catch (e) { res.status(500).json({ error: 'Failed to create report.' }); }
});

/* POST /api/dashboards/reports/:id/run — generate the report inline */
router.post('/reports/:id/run', requireRole('operator','tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    const rpt = await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT * FROM reports WHERE id=@id AND tenant_id=@tid`);
    if (!rpt.recordset.length) return res.status(404).json({ error: 'Report not found.' });
    const { report_type, filters: filtersRaw } = rpt.recordset[0];
    const filters = filtersRaw ? JSON.parse(filtersRaw) : {};
    const tid = req.tenantId;

    let result = {};

    if (report_type === 'assets') {
      const r = await pool.request().input('tid', sql.UniqueIdentifier, tid).query(`
        SELECT asset_type, status, criticality, COUNT(*) AS count
        FROM assets WHERE tenant_id=@tid AND status!='decommissioned'
        GROUP BY asset_type, status, criticality ORDER BY count DESC`);
      result = { report_type, generated_at: new Date(), rows: r.recordset };
    } else if (report_type === 'alerts') {
      const r = await pool.request().input('tid', sql.UniqueIdentifier, tid).query(`
        SELECT severity, status, COUNT(*) AS count FROM alerts WHERE tenant_id=@tid
        GROUP BY severity, status ORDER BY severity, status`);
      result = { report_type, generated_at: new Date(), rows: r.recordset };
    } else if (report_type === 'compliance') {
      const r = await pool.request().input('tid', sql.UniqueIdentifier, tid).query(`
        SELECT p.name AS policy, p.framework, cr.status, COUNT(*) AS count, AVG(cr.score) AS avg_score
        FROM compliance_results cr JOIN compliance_policies p ON cr.policy_id=p.id
        WHERE cr.tenant_id=@tid GROUP BY p.name, p.framework, cr.status ORDER BY p.name`);
      result = { report_type, generated_at: new Date(), rows: r.recordset };
    } else if (report_type === 'certificates') {
      const r = await pool.request().input('tid', sql.UniqueIdentifier, tid).query(`
        SELECT is_expired, is_self_signed, COUNT(*) AS count,
          MIN(days_remaining) AS min_days, MAX(days_remaining) AS max_days
        FROM certificates WHERE tenant_id=@tid GROUP BY is_expired, is_self_signed`);
      result = { report_type, generated_at: new Date(), rows: r.recordset };
    } else if (report_type === 'incidents') {
      const r = await pool.request().input('tid', sql.UniqueIdentifier, tid).query(`
        SELECT severity, status, COUNT(*) AS count FROM incidents WHERE tenant_id=@tid
        GROUP BY severity, status ORDER BY severity`);
      result = { report_type, generated_at: new Date(), rows: r.recordset };
    } else if (report_type === 'cloud') {
      const r = await pool.request().input('tid', sql.UniqueIdentifier, tid).query(`
        SELECT provider, resource_type, COUNT(*) AS count, SUM(ISNULL(cost_monthly,0)) AS cost_monthly
        FROM cloud_resources WHERE tenant_id=@tid GROUP BY provider, resource_type ORDER BY provider, cost_monthly DESC`);
      result = { report_type, generated_at: new Date(), rows: r.recordset };
    } else if (report_type === 'executive_summary') {
      const assets = await pool.request().input('tid', sql.UniqueIdentifier, tid).query(`SELECT COUNT(*) AS total, SUM(CASE WHEN status='online' THEN 1 ELSE 0 END) AS online FROM assets WHERE tenant_id=@tid AND status!='decommissioned'`);
      const alerts = await pool.request().input('tid2', sql.UniqueIdentifier, tid).query(`SELECT COUNT(*) AS open, SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) AS critical FROM alerts WHERE tenant_id=@tid2 AND status='open'`);
      const incidents = await pool.request().input('tid3', sql.UniqueIdentifier, tid).query(`SELECT COUNT(*) AS open_p1_p2 FROM incidents WHERE tenant_id=@tid3 AND severity IN ('p1','p2') AND status NOT IN ('resolved','closed')`);
      const certs = await pool.request().input('tid4', sql.UniqueIdentifier, tid).query(`SELECT SUM(CASE WHEN is_expired=1 THEN 1 ELSE 0 END) AS expired, SUM(CASE WHEN is_expired=0 AND not_after<=DATEADD(day,30,GETUTCDATE()) THEN 1 ELSE 0 END) AS expiring_30d FROM certificates WHERE tenant_id=@tid4`);
      result = { report_type, generated_at: new Date(), assets: assets.recordset[0], alerts: alerts.recordset[0], incidents: incidents.recordset[0], certificates: certs.recordset[0] };
    } else {
      result = { report_type, generated_at: new Date(), message: 'Report type collected — no query defined yet.' };
    }

    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('res', sql.NVarChar, JSON.stringify(result))
      .query(`UPDATE reports SET last_run=GETUTCDATE(), last_result=@res WHERE id=@id`);

    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'REPORT_RUN', resource: 'reports', resourceId: req.params.id, details: { report_type }, ip: req.ip, ua: req.headers['user-agent'], severity: 'info' });
    res.json(result);
  } catch (e) { res.status(500).json({ error: 'Report generation failed.' }); }
});

router.patch('/reports/:id', requireRole('operator','tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    const sets = []; const request = pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId);
    if (req.body.name          !== undefined) { sets.push('name=@name');                   request.input('name',          sql.NVarChar, req.body.name); }
    if (req.body.schedule      !== undefined) { sets.push('schedule=@schedule');           request.input('schedule',      sql.NVarChar, req.body.schedule); }
    if (req.body.output_format !== undefined) { sets.push('output_format=@output_format'); request.input('output_format', sql.NVarChar, req.body.output_format); }
    if (req.body.filters       !== undefined) { sets.push('filters=@filters');             request.input('filters',       sql.NVarChar, JSON.stringify(req.body.filters)); }
    if (sets.length) await request.query(`UPDATE reports SET ${sets.join(',')} WHERE id=@id AND tenant_id=@tid`);
    res.json({ message: 'Report updated.' });
  } catch (e) { res.status(500).json({ error: 'Failed to update report.' }); }
});

router.delete('/reports/:id', requireRole('operator','tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`DELETE FROM reports WHERE id=@id AND tenant_id=@tid`);
    res.json({ message: 'Report deleted.' });
  } catch (e) { res.status(500).json({ error: 'Failed to delete report.' }); }
});

module.exports = router;
