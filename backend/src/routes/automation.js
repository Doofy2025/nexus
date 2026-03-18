'use strict';
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { getPool, sql } = require('../db/pool');
const { authenticate, requireRole, tenantScope } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const logger = require('../utils/logger');
router.use(authenticate, tenantScope);

/* ── PLAYBOOKS ─────────────────────────────────────────────────── */

// GET /api/automation/playbooks
router.get('/playbooks', async (req, res) => {
  try {
    const pool = await getPool();
    const { trigger_type, enabled } = req.query;
    let where = `WHERE p.tenant_id=@tid`;
    const request = pool.request().input('tid', sql.UniqueIdentifier, req.tenantId);
    if (trigger_type) { where += ` AND p.trigger_type=@tt`; request.input('tt', sql.NVarChar, trigger_type); }
    if (enabled !== undefined) { where += ` AND p.is_enabled=@en`; request.input('en', sql.Bit, enabled === 'true' ? 1 : 0); }
    const r = await request.query(`
      SELECT p.*, u.display_name AS created_by_name,
        (SELECT COUNT(*) FROM automation_runs r WHERE r.playbook_id=p.id) AS run_count,
        (SELECT TOP 1 status FROM automation_runs r WHERE r.playbook_id=p.id ORDER BY created_at DESC) AS last_run_status,
        (SELECT TOP 1 created_at FROM automation_runs r WHERE r.playbook_id=p.id ORDER BY created_at DESC) AS last_run_at
      FROM automation_playbooks p
      LEFT JOIN users u ON p.created_by=u.id
      ${where} ORDER BY p.name`);
    res.json(r.recordset);
  } catch (e) { logger.error('playbooks list', { err: e.message }); res.status(500).json({ error: 'Failed to fetch playbooks.' }); }
});

// GET /api/automation/playbooks/:id
router.get('/playbooks/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT p.*, u.display_name AS created_by_name FROM automation_playbooks p LEFT JOIN users u ON p.created_by=u.id WHERE p.id=@id AND p.tenant_id=@tid`);
    if (!r.recordset.length) return res.status(404).json({ error: 'Playbook not found.' });
    const runs = await pool.request().input('pid', sql.UniqueIdentifier, req.params.id)
      .query(`SELECT TOP 10 id,status,triggered_by,started_at,completed_at,steps_total,steps_completed FROM automation_runs WHERE playbook_id=@pid ORDER BY created_at DESC`);
    res.json({ ...r.recordset[0], recentRuns: runs.recordset });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch playbook.' }); }
});

// POST /api/automation/playbooks
router.post('/playbooks', requireRole('operator', 'tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool(); const id = uuidv4();
    const { name, description, trigger_type, trigger_config, steps, requires_approval, approvers, tags } = req.body;
    if (!name || !trigger_type || !steps) return res.status(400).json({ error: 'name, trigger_type, steps required.' });
    if (!Array.isArray(steps) || !steps.length) return res.status(400).json({ error: 'steps must be a non-empty array.' });
    const validTriggers = ['manual','schedule','alert','webhook','policy_violation','event'];
    if (!validTriggers.includes(trigger_type)) return res.status(400).json({ error: `trigger_type must be one of: ${validTriggers.join(', ')}` });
    await pool.request()
      .input('id', sql.UniqueIdentifier, id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .input('name', sql.NVarChar, name).input('description', sql.NVarChar, description || null)
      .input('trigger_type', sql.NVarChar, trigger_type)
      .input('trigger_config', sql.NVarChar, trigger_config ? JSON.stringify(trigger_config) : null)
      .input('steps', sql.NVarChar, JSON.stringify(steps))
      .input('requires_approval', sql.Bit, requires_approval ? 1 : 0)
      .input('approvers', sql.NVarChar, approvers ? JSON.stringify(approvers) : null)
      .input('tags', sql.NVarChar, tags ? JSON.stringify(tags) : null)
      .input('created_by', sql.UniqueIdentifier, req.user.id)
      .query(`INSERT INTO automation_playbooks (id,tenant_id,name,description,trigger_type,trigger_config,steps,requires_approval,approvers,tags,created_by)
              VALUES (@id,@tid,@name,@description,@trigger_type,@trigger_config,@steps,@requires_approval,@approvers,@tags,@created_by)`);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'PLAYBOOK_CREATED', resource: 'automation_playbooks', resourceId: id, details: { name, trigger_type }, ip: req.ip, ua: req.headers['user-agent'], severity: 'info' });
    res.status(201).json({ id, name, trigger_type });
  } catch (e) { logger.error('playbook create', { err: e.message }); res.status(500).json({ error: 'Failed to create playbook.' }); }
});

// PATCH /api/automation/playbooks/:id
router.patch('/playbooks/:id', requireRole('operator', 'tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    const check = await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT 1 FROM automation_playbooks WHERE id=@id AND tenant_id=@tid`);
    if (!check.recordset.length) return res.status(404).json({ error: 'Playbook not found.' });
    const sets = []; const request = pool.request().input('id', sql.UniqueIdentifier, req.params.id);
    const textFields = ['name','description','trigger_type'];
    for (const k of textFields) { if (req.body[k] !== undefined) { sets.push(`${k}=@${k}`); request.input(k, sql.NVarChar, req.body[k]); } }
    if (req.body.steps !== undefined) { sets.push('steps=@steps'); request.input('steps', sql.NVarChar, JSON.stringify(req.body.steps)); }
    if (req.body.trigger_config !== undefined) { sets.push('trigger_config=@tc'); request.input('tc', sql.NVarChar, JSON.stringify(req.body.trigger_config)); }
    if (req.body.approvers !== undefined) { sets.push('approvers=@approvers'); request.input('approvers', sql.NVarChar, JSON.stringify(req.body.approvers)); }
    if (req.body.requires_approval !== undefined) { sets.push('requires_approval=@ra'); request.input('ra', sql.Bit, req.body.requires_approval ? 1 : 0); }
    if (req.body.is_enabled !== undefined) { sets.push('is_enabled=@ie'); request.input('ie', sql.Bit, req.body.is_enabled ? 1 : 0); }
    if (sets.length) { sets.push('updated_at=GETUTCDATE()'); await request.query(`UPDATE automation_playbooks SET ${sets.join(',')} WHERE id=@id`); }
    res.json({ message: 'Playbook updated.' });
  } catch (e) { res.status(500).json({ error: 'Failed to update playbook.' }); }
});

// PATCH /api/automation/playbooks/:id/toggle
router.patch('/playbooks/:id/toggle', requireRole('operator', 'tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`UPDATE automation_playbooks SET is_enabled=CASE WHEN is_enabled=1 THEN 0 ELSE 1 END, updated_at=GETUTCDATE() WHERE id=@id AND tenant_id=@tid`);
    res.json({ message: 'Toggled.' });
  } catch (e) { res.status(500).json({ error: 'Failed to toggle.' }); }
});

// DELETE /api/automation/playbooks/:id
router.delete('/playbooks/:id', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`DELETE FROM automation_playbooks WHERE id=@id AND tenant_id=@tid`);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'PLAYBOOK_DELETED', resource: 'automation_playbooks', resourceId: req.params.id, ip: req.ip, ua: req.headers['user-agent'], severity: 'warning' });
    res.json({ message: 'Playbook deleted.' });
  } catch (e) { res.status(500).json({ error: 'Failed to delete playbook.' }); }
});

/* ── RUNS ──────────────────────────────────────────────────────── */

// GET /api/automation/runs
router.get('/runs', async (req, res) => {
  try {
    const pool = await getPool();
    const { status, playbook_id } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 25);
    const offset = (page - 1) * limit;
    let where = `WHERE r.tenant_id=@tid`;
    const request = pool.request().input('tid', sql.UniqueIdentifier, req.tenantId);
    if (status) { where += ` AND r.status=@status`; request.input('status', sql.NVarChar, status); }
    if (playbook_id) { where += ` AND r.playbook_id=@pid`; request.input('pid', sql.UniqueIdentifier, playbook_id); }
    const r = await request.query(`
      SELECT r.*, a.name AS asset_name, u.display_name AS triggered_by_user_name, ap.display_name AS approved_by_name
      FROM automation_runs r
      LEFT JOIN assets a ON r.target_asset_id=a.id
      LEFT JOIN users u  ON r.triggered_by_user=u.id
      LEFT JOIN users ap ON r.approved_by=ap.id
      ${where} ORDER BY r.created_at DESC
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`);
    res.json({ data: r.recordset, page, limit });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch runs.' }); }
});

// GET /api/automation/runs/:id
router.get('/runs/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT r.*, a.name AS asset_name, u.display_name AS triggered_by_user_name FROM automation_runs r LEFT JOIN assets a ON r.target_asset_id=a.id LEFT JOIN users u ON r.triggered_by_user=u.id WHERE r.id=@id AND r.tenant_id=@tid`);
    if (!r.recordset.length) return res.status(404).json({ error: 'Run not found.' });
    res.json(r.recordset[0]);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch run.' }); }
});

// POST /api/automation/runs — execute a playbook
router.post('/runs', requireRole('operator', 'tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool(); const id = uuidv4();
    const { playbook_id, target_asset_id, input_params } = req.body;
    if (!playbook_id) return res.status(400).json({ error: 'playbook_id required.' });

    // Load playbook
    const pb = await pool.request().input('pid', sql.UniqueIdentifier, playbook_id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT * FROM automation_playbooks WHERE id=@pid AND tenant_id=@tid AND is_enabled=1`);
    if (!pb.recordset.length) return res.status(404).json({ error: 'Playbook not found or disabled.' });

    const playbook = pb.recordset[0];
    const steps = JSON.parse(playbook.steps || '[]');
    const needsApproval = playbook.requires_approval;
    const initialStatus = needsApproval ? 'awaiting_approval' : 'pending';

    await pool.request()
      .input('id', sql.UniqueIdentifier, id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .input('playbook_id', sql.UniqueIdentifier, playbook_id)
      .input('playbook_name', sql.NVarChar, playbook.name)
      .input('target_asset_id', sql.UniqueIdentifier, target_asset_id || null)
      .input('triggered_by', sql.NVarChar, 'manual')
      .input('triggered_by_user', sql.UniqueIdentifier, req.user.id)
      .input('status', sql.NVarChar, initialStatus)
      .input('steps_total', sql.Int, steps.length)
      .input('output_log', sql.NVarChar, JSON.stringify([{ ts: new Date().toISOString(), msg: `Run created by ${req.user.email}`, step: 0 }]))
      .query(`INSERT INTO automation_runs (id,tenant_id,playbook_id,playbook_name,target_asset_id,triggered_by,triggered_by_user,status,steps_total,output_log)
              VALUES (@id,@tid,@playbook_id,@playbook_name,@target_asset_id,@triggered_by,@triggered_by_user,@status,@steps_total,@output_log)`);

    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'AUTOMATION_RUN_CREATED', resource: 'automation_runs', resourceId: id, details: { playbook_name: playbook.name, status: initialStatus }, ip: req.ip, ua: req.headers['user-agent'], severity: 'info' });
    res.status(201).json({ id, status: initialStatus, requiresApproval: needsApproval, message: needsApproval ? 'Run queued — awaiting approval.' : 'Run queued.' });
  } catch (e) { logger.error('run create', { err: e.message }); res.status(500).json({ error: 'Failed to create run.' }); }
});

// POST /api/automation/runs/:id/approve
router.post('/runs/:id/approve', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    const check = await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT id,status FROM automation_runs WHERE id=@id AND tenant_id=@tid`);
    if (!check.recordset.length) return res.status(404).json({ error: 'Run not found.' });
    if (check.recordset[0].status !== 'awaiting_approval') return res.status(400).json({ error: 'Run is not awaiting approval.' });
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('uid', sql.UniqueIdentifier, req.user.id)
      .query(`UPDATE automation_runs SET status='approved', approved_by=@uid, approved_at=GETUTCDATE() WHERE id=@id`);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'AUTOMATION_RUN_APPROVED', resource: 'automation_runs', resourceId: req.params.id, ip: req.ip, ua: req.headers['user-agent'], severity: 'warning' });
    res.json({ message: 'Run approved.' });
  } catch (e) { res.status(500).json({ error: 'Failed to approve run.' }); }
});

// POST /api/automation/runs/:id/cancel
router.post('/runs/:id/cancel', requireRole('operator', 'tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`UPDATE automation_runs SET status='cancelled', completed_at=GETUTCDATE() WHERE id=@id AND tenant_id=@tid AND status IN ('pending','awaiting_approval','approved')`);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'AUTOMATION_RUN_CANCELLED', resource: 'automation_runs', resourceId: req.params.id, ip: req.ip, ua: req.headers['user-agent'], severity: 'warning' });
    res.json({ message: 'Run cancelled.' });
  } catch (e) { res.status(500).json({ error: 'Failed to cancel run.' }); }
});

// POST /api/automation/runs/:id/rollback
router.post('/runs/:id/rollback', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    const check = await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT id,status FROM automation_runs WHERE id=@id AND tenant_id=@tid`);
    if (!check.recordset.length) return res.status(404).json({ error: 'Run not found.' });
    if (!['success','failed'].includes(check.recordset[0].status)) return res.status(400).json({ error: 'Only completed runs can be rolled back.' });
    const rollbackId = uuidv4();
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id)
      .query(`UPDATE automation_runs SET status='rolled_back', completed_at=GETUTCDATE() WHERE id=@id`);
    await pool.request()
      .input('id', sql.UniqueIdentifier, rollbackId).input('tid', sql.UniqueIdentifier, req.tenantId)
      .input('triggered_by', sql.NVarChar, 'rollback').input('triggered_by_user', sql.UniqueIdentifier, req.user.id)
      .input('status', sql.NVarChar, 'pending').input('output_log', sql.NVarChar, JSON.stringify([{ ts: new Date().toISOString(), msg: `Rollback of run ${req.params.id} by ${req.user.email}` }]))
      .query(`INSERT INTO automation_runs (id,tenant_id,triggered_by,triggered_by_user,status,steps_total,output_log) VALUES (@id,@tid,@triggered_by,@triggered_by_user,@status,0,@output_log)`);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'AUTOMATION_RUN_ROLLBACK', resource: 'automation_runs', resourceId: req.params.id, ip: req.ip, ua: req.headers['user-agent'], severity: 'critical' });
    res.json({ message: 'Rollback initiated.', rollbackRunId: rollbackId });
  } catch (e) { res.status(500).json({ error: 'Failed to rollback.' }); }
});

// PATCH /api/automation/runs/:id/log — agent appends step output
router.patch('/runs/:id/log', async (req, res) => {
  try {
    const pool = await getPool();
    const { step, msg, status } = req.body;
    const current = await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT output_log, steps_total, steps_completed FROM automation_runs WHERE id=@id AND tenant_id=@tid`);
    if (!current.recordset.length) return res.status(404).json({ error: 'Run not found.' });
    let log = []; try { log = JSON.parse(current.recordset[0].output_log || '[]'); } catch {}
    log.push({ ts: new Date().toISOString(), step: step || 0, msg: msg || '' });
    const completed = Math.min(current.recordset[0].steps_total, (current.recordset[0].steps_completed || 0) + 1);
    const sets = [`output_log=@log`, `steps_completed=@completed`];
    const request = pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('log', sql.NVarChar, JSON.stringify(log)).input('completed', sql.Int, completed);
    if (status) { sets.push('status=@status'); request.input('status', sql.NVarChar, status); if (['success','failed','cancelled'].includes(status)) sets.push('completed_at=GETUTCDATE()'); if (status === 'running' && !current.recordset[0].started_at) sets.push('started_at=GETUTCDATE()'); }
    await request.query(`UPDATE automation_runs SET ${sets.join(',')} WHERE id=@id`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to update run log.' }); }
});

module.exports = router;
