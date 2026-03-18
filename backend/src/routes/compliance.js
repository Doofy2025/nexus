'use strict';
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { getPool, sql } = require('../db/pool');
const { authenticate, requireRole, tenantScope } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const logger = require('../utils/logger');
router.use(authenticate, tenantScope);

/* ── POLICIES ──────────────────────────────────────────────────── */

// GET /api/compliance/policies
router.get('/policies', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`
        SELECT p.*, u.display_name AS created_by_name,
          (SELECT COUNT(*) FROM compliance_results cr WHERE cr.policy_id=p.id) AS result_count,
          (SELECT COUNT(*) FROM compliance_results cr WHERE cr.policy_id=p.id AND cr.status='fail') AS fail_count,
          (SELECT COUNT(*) FROM compliance_results cr WHERE cr.policy_id=p.id AND cr.status='pass') AS pass_count,
          (SELECT AVG(score) FROM compliance_results cr WHERE cr.policy_id=p.id AND cr.score IS NOT NULL) AS avg_score
        FROM compliance_policies p
        LEFT JOIN users u ON p.created_by=u.id
        WHERE p.tenant_id=@tid ORDER BY p.name`);
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch policies.' }); }
});

// GET /api/compliance/policies/:id
router.get('/policies/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT p.*, u.display_name AS created_by_name FROM compliance_policies p LEFT JOIN users u ON p.created_by=u.id WHERE p.id=@id AND p.tenant_id=@tid`);
    if (!r.recordset.length) return res.status(404).json({ error: 'Policy not found.' });
    res.json(r.recordset[0]);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch policy.' }); }
});

// POST /api/compliance/policies
router.post('/policies', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool(); const id = uuidv4();
    const { name, framework, description, rules } = req.body;
    if (!name || !rules) return res.status(400).json({ error: 'name and rules required.' });
    if (!Array.isArray(rules) || !rules.length) return res.status(400).json({ error: 'rules must be a non-empty array.' });
    await pool.request()
      .input('id', sql.UniqueIdentifier, id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .input('name', sql.NVarChar, name).input('framework', sql.NVarChar, framework || null)
      .input('description', sql.NVarChar, description || null)
      .input('rules', sql.NVarChar, JSON.stringify(rules))
      .input('created_by', sql.UniqueIdentifier, req.user.id)
      .query(`INSERT INTO compliance_policies (id,tenant_id,name,framework,description,rules,created_by) VALUES (@id,@tid,@name,@framework,@description,@rules,@created_by)`);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'COMPLIANCE_POLICY_CREATED', resource: 'compliance_policies', resourceId: id, details: { name, framework }, ip: req.ip, ua: req.headers['user-agent'], severity: 'info' });
    res.status(201).json({ id, name, framework });
  } catch (e) { logger.error('policy create', { err: e.message }); res.status(500).json({ error: 'Failed to create policy.' }); }
});

// PATCH /api/compliance/policies/:id
router.patch('/policies/:id', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    const sets = []; const request = pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId);
    const textFields = ['name','framework','description'];
    for (const k of textFields) { if (req.body[k] !== undefined) { sets.push(`${k}=@${k}`); request.input(k, sql.NVarChar, req.body[k]); } }
    if (req.body.rules !== undefined) { sets.push('rules=@rules'); request.input('rules', sql.NVarChar, JSON.stringify(req.body.rules)); }
    if (req.body.is_enabled !== undefined) { sets.push('is_enabled=@ie'); request.input('ie', sql.Bit, req.body.is_enabled ? 1 : 0); }
    if (sets.length) { sets.push('updated_at=GETUTCDATE()'); await request.query(`UPDATE compliance_policies SET ${sets.join(',')} WHERE id=@id AND tenant_id=@tid`); }
    res.json({ message: 'Policy updated.' });
  } catch (e) { res.status(500).json({ error: 'Failed to update policy.' }); }
});

// DELETE /api/compliance/policies/:id
router.delete('/policies/:id', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`DELETE FROM compliance_policies WHERE id=@id AND tenant_id=@tid`);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'COMPLIANCE_POLICY_DELETED', resource: 'compliance_policies', resourceId: req.params.id, ip: req.ip, ua: req.headers['user-agent'], severity: 'warning' });
    res.json({ message: 'Policy deleted.' });
  } catch (e) { res.status(500).json({ error: 'Failed to delete policy.' }); }
});

/* ── RESULTS ───────────────────────────────────────────────────── */

// GET /api/compliance/results
router.get('/results', async (req, res) => {
  try {
    const pool = await getPool();
    const { policy_id, asset_id, status } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;
    let where = `WHERE cr.tenant_id=@tid`;
    const request = pool.request().input('tid', sql.UniqueIdentifier, req.tenantId);
    if (policy_id) { where += ` AND cr.policy_id=@pid`; request.input('pid', sql.UniqueIdentifier, policy_id); }
    if (asset_id)  { where += ` AND cr.asset_id=@aid`;  request.input('aid', sql.UniqueIdentifier, asset_id);  }
    if (status)    { where += ` AND cr.status=@status`;  request.input('status', sql.NVarChar, status);          }
    const r = await request.query(`
      SELECT cr.*, p.name AS policy_name, p.framework, a.name AS asset_name, a.hostname AS asset_hostname
      FROM compliance_results cr
      LEFT JOIN compliance_policies p ON cr.policy_id=p.id
      LEFT JOIN assets a ON cr.asset_id=a.id
      ${where} ORDER BY cr.checked_at DESC
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`);
    res.json({ data: r.recordset, page, limit });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch results.' }); }
});

// GET /api/compliance/summary
router.get('/summary', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().input('tid', sql.UniqueIdentifier, req.tenantId).query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status='pass'    THEN 1 ELSE 0 END) AS pass,
        SUM(CASE WHEN status='fail'    THEN 1 ELSE 0 END) AS fail,
        SUM(CASE WHEN status='warning' THEN 1 ELSE 0 END) AS warning,
        SUM(CASE WHEN status='skip'    THEN 1 ELSE 0 END) AS skip,
        SUM(CASE WHEN status='error'   THEN 1 ELSE 0 END) AS error,
        AVG(score) AS avg_score,
        COUNT(DISTINCT asset_id) AS assets_checked,
        COUNT(DISTINCT policy_id) AS policies_run
      FROM compliance_results WHERE tenant_id=@tid`);
    const byPolicy = await pool.request().input('tid2', sql.UniqueIdentifier, req.tenantId).query(`
      SELECT p.name AS policy_name, p.framework, cr.status, COUNT(*) AS count
      FROM compliance_results cr JOIN compliance_policies p ON cr.policy_id=p.id
      WHERE cr.tenant_id=@tid2 GROUP BY p.name, p.framework, cr.status ORDER BY p.name`);
    res.json({ totals: r.recordset[0], byPolicy: byPolicy.recordset });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch compliance summary.' }); }
});

// POST /api/compliance/results — ingest a result (from agent or scan)
router.post('/results', requireRole('operator', 'tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool(); const id = uuidv4();
    const { policy_id, asset_id, status, score, findings } = req.body;
    if (!policy_id || !asset_id || !status) return res.status(400).json({ error: 'policy_id, asset_id, status required.' });
    const validStatuses = ['pass','fail','warning','skip','error'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
    await pool.request()
      .input('id', sql.UniqueIdentifier, id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .input('policy_id', sql.UniqueIdentifier, policy_id).input('asset_id', sql.UniqueIdentifier, asset_id)
      .input('status', sql.NVarChar, status).input('score', sql.Float, score ?? null)
      .input('findings', sql.NVarChar, findings ? JSON.stringify(findings) : null)
      .query(`INSERT INTO compliance_results (id,tenant_id,policy_id,asset_id,status,score,findings) VALUES (@id,@tid,@policy_id,@asset_id,@status,@score,@findings)`);
    res.status(201).json({ id, status });
  } catch (e) { res.status(500).json({ error: 'Failed to ingest result.' }); }
});

// POST /api/compliance/results/bulk — batch ingest
router.post('/results/bulk', requireRole('operator', 'tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const { results } = req.body;
    if (!Array.isArray(results) || !results.length) return res.status(400).json({ error: 'results array required.' });
    const pool = await getPool(); let ingested = 0;
    const validStatuses = new Set(['pass','fail','warning','skip','error']);
    for (const item of results.slice(0, 1000)) {
      if (!item.policy_id || !item.asset_id || !validStatuses.has(item.status)) continue;
      await pool.request()
        .input('id', sql.UniqueIdentifier, uuidv4()).input('tid', sql.UniqueIdentifier, req.tenantId)
        .input('policy_id', sql.UniqueIdentifier, item.policy_id).input('asset_id', sql.UniqueIdentifier, item.asset_id)
        .input('status', sql.NVarChar, item.status).input('score', sql.Float, item.score ?? null)
        .input('findings', sql.NVarChar, item.findings ? JSON.stringify(item.findings) : null)
        .query(`INSERT INTO compliance_results (id,tenant_id,policy_id,asset_id,status,score,findings) VALUES (@id,@tid,@policy_id,@asset_id,@status,@score,@findings)`);
      ingested++;
    }
    res.status(201).json({ ingested, message: `${ingested} result(s) ingested.` });
  } catch (e) { res.status(500).json({ error: 'Bulk ingest failed.' }); }
});

// GET /api/compliance/assets/:assetId — all results for one asset
router.get('/assets/:assetId', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().input('aid', sql.UniqueIdentifier, req.params.assetId).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT cr.*, p.name AS policy_name, p.framework FROM compliance_results cr LEFT JOIN compliance_policies p ON cr.policy_id=p.id WHERE cr.asset_id=@aid AND cr.tenant_id=@tid ORDER BY cr.checked_at DESC`);
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch asset compliance.' }); }
});

module.exports = router;
