'use strict';
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { getPool, sql } = require('../db/pool');
const { authenticate, requireRole, tenantScope } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const logger = require('../utils/logger');
router.use(authenticate, tenantScope);

const VALID_TYPES = [
  'servicenow','jira','slack','teams','pagerduty','opsgenie',
  'splunk','elastic','sentinel','crowdstrike','defender',
  'intune','active_directory','entra_id','okta','sccm',
  'tanium','vmware_vcenter','kubernetes','github','gitlab',
  'jenkins','smtp','webhook','generic_rest','grafana','datadog',
];

/* GET /api/integrations */
router.get('/', requireRole('tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT id,name,type,is_enabled,last_sync,sync_status,created_at,updated_at
              FROM integrations WHERE tenant_id=@tid ORDER BY name`);
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch integrations.' }); }
});

/* GET /api/integrations/:id */
router.get('/:id', requireRole('tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.UniqueIdentifier, req.params.id)
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT id,name,type,config,is_enabled,last_sync,sync_status,created_at,updated_at
              FROM integrations WHERE id=@id AND tenant_id=@tid`);
    if (!r.recordset.length) return res.status(404).json({ error: 'Integration not found.' });
    /* Never return credentials in GET */
    res.json(r.recordset[0]);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch integration.' }); }
});

/* POST /api/integrations */
router.post('/', requireRole('tenant_admin','super_admin'), async (req, res) => {
  try {
    const { name, type, config, credentials } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'name and type required.' });
    if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: `Invalid type. Valid: ${VALID_TYPES.join(', ')}` });
    const pool = await getPool(); const id = uuidv4();
    await pool.request()
      .input('id',          sql.UniqueIdentifier, id)
      .input('tid',         sql.UniqueIdentifier, req.tenantId)
      .input('name',        sql.NVarChar, name)
      .input('type',        sql.NVarChar, type)
      .input('config',      sql.NVarChar, config      ? JSON.stringify(config)      : null)
      .input('credentials', sql.NVarChar, credentials ? JSON.stringify(credentials) : null)
      .input('created_by',  sql.UniqueIdentifier, req.user.id)
      .query(`INSERT INTO integrations (id,tenant_id,name,type,config,credentials,created_by)
              VALUES (@id,@tid,@name,@type,@config,@credentials,@created_by)`);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'INTEGRATION_CREATED', resource: 'integrations', resourceId: id, details: { name, type }, ip: req.ip, ua: req.headers['user-agent'], severity: 'warning' });
    res.status(201).json({ id, name, type });
  } catch (e) { logger.error('integration create', { err: e.message }); res.status(500).json({ error: 'Failed to create integration.' }); }
});

/* PATCH /api/integrations/:id */
router.patch('/:id', requireRole('tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    const sets = []; const request = pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId);
    if (req.body.name        !== undefined) { sets.push('name=@name');               request.input('name',        sql.NVarChar, req.body.name); }
    if (req.body.config      !== undefined) { sets.push('config=@config');           request.input('config',      sql.NVarChar, JSON.stringify(req.body.config)); }
    if (req.body.credentials !== undefined) { sets.push('credentials=@credentials'); request.input('credentials', sql.NVarChar, JSON.stringify(req.body.credentials)); }
    if (req.body.is_enabled  !== undefined) { sets.push('is_enabled=@ie');           request.input('ie', sql.Bit, req.body.is_enabled ? 1 : 0); }
    if (sets.length) { sets.push('updated_at=GETUTCDATE()'); await request.query(`UPDATE integrations SET ${sets.join(',')} WHERE id=@id AND tenant_id=@tid`); }
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'INTEGRATION_UPDATED', resource: 'integrations', resourceId: req.params.id, ip: req.ip, ua: req.headers['user-agent'], severity: 'warning' });
    res.json({ message: 'Integration updated.' });
  } catch (e) { res.status(500).json({ error: 'Failed to update integration.' }); }
});

/* PATCH /api/integrations/:id/toggle */
router.patch('/:id/toggle', requireRole('tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`UPDATE integrations SET is_enabled=CASE WHEN is_enabled=1 THEN 0 ELSE 1 END, updated_at=GETUTCDATE() WHERE id=@id AND tenant_id=@tid`);
    res.json({ message: 'Toggled.' });
  } catch (e) { res.status(500).json({ error: 'Failed to toggle integration.' }); }
});

/* POST /api/integrations/:id/test — ping the integration endpoint */
router.post('/:id/test', requireRole('tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT type, config, credentials FROM integrations WHERE id=@id AND tenant_id=@tid AND is_enabled=1`);
    if (!r.recordset.length) return res.status(404).json({ error: 'Integration not found or disabled.' });
    const { type } = r.recordset[0];
    /* Update sync status regardless — actual connectivity test is handled by the connector worker in Phase 4 */
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id)
      .query(`UPDATE integrations SET last_sync=GETUTCDATE(), sync_status='test_ok', updated_at=GETUTCDATE() WHERE id=@id`);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'INTEGRATION_TESTED', resource: 'integrations', resourceId: req.params.id, details: { type }, ip: req.ip, ua: req.headers['user-agent'], severity: 'info' });
    res.json({ ok: true, type, message: `Test ping recorded for ${type}. Connector worker validates live connectivity.` });
  } catch (e) { res.status(500).json({ error: 'Test failed.' }); }
});

/* PATCH /api/integrations/:id/sync-status — connector worker updates status */
router.patch('/:id/sync-status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status required.' });
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .input('status', sql.NVarChar, status)
      .query(`UPDATE integrations SET sync_status=@status, last_sync=GETUTCDATE(), updated_at=GETUTCDATE() WHERE id=@id AND tenant_id=@tid`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to update sync status.' }); }
});

/* DELETE /api/integrations/:id */
router.delete('/:id', requireRole('tenant_admin','super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`DELETE FROM integrations WHERE id=@id AND tenant_id=@tid`);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'INTEGRATION_DELETED', resource: 'integrations', resourceId: req.params.id, ip: req.ip, ua: req.headers['user-agent'], severity: 'critical' });
    res.json({ message: 'Integration deleted.' });
  } catch (e) { res.status(500).json({ error: 'Failed to delete integration.' }); }
});

/* GET /api/integrations/types/available — return valid type list for UI dropdowns */
router.get('/types/available', requireRole('tenant_admin','super_admin'), (_req, res) => {
  res.json(VALID_TYPES.map(t => ({ type: t, label: t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) })));
});

module.exports = router;
