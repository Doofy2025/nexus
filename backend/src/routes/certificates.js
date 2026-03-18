'use strict';
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { getPool, sql } = require('../db/pool');
const { authenticate, requireRole, tenantScope } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const logger = require('../utils/logger');
router.use(authenticate, tenantScope);

/* ── helpers ────────────────────────────────────────────────────── */
function daysUntil(date) {
  if (!date) return null;
  return Math.floor((new Date(date) - Date.now()) / 86400000);
}

/* ══════════════════════════════════════════════════════════════════
   GET /api/certificates
   ══════════════════════════════════════════════════════════════════ */
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const { expiring_days, is_expired, asset_id, search } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;
    let where = `WHERE c.tenant_id=@tid`;
    const request = pool.request().input('tid', sql.UniqueIdentifier, req.tenantId);
    if (is_expired === 'true') { where += ` AND c.is_expired=1`; }
    if (is_expired === 'false') { where += ` AND c.is_expired=0`; }
    if (expiring_days) { where += ` AND c.not_after <= DATEADD(day,@ed,GETUTCDATE()) AND c.is_expired=0`; request.input('ed', sql.Int, parseInt(expiring_days)); }
    if (asset_id) { where += ` AND c.asset_id=@aid`; request.input('aid', sql.UniqueIdentifier, asset_id); }
    if (search) { where += ` AND (c.common_name LIKE @srch OR c.issuer LIKE @srch OR c.subject LIKE @srch)`; request.input('srch', sql.NVarChar, `%${search}%`); }
    const r = await request.query(`
      SELECT c.*, a.name AS asset_name, a.hostname AS asset_hostname
      FROM certificates c
      LEFT JOIN assets a ON c.asset_id=a.id
      ${where} ORDER BY c.not_after ASC
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`);
    const summary = await pool.request().input('tid2', sql.UniqueIdentifier, req.tenantId).query(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN is_expired=1 THEN 1 ELSE 0 END) AS expired,
        SUM(CASE WHEN is_expired=0 AND not_after <= DATEADD(day,7, GETUTCDATE()) THEN 1 ELSE 0 END) AS expiring_7d,
        SUM(CASE WHEN is_expired=0 AND not_after <= DATEADD(day,30,GETUTCDATE()) THEN 1 ELSE 0 END) AS expiring_30d,
        SUM(CASE WHEN is_expired=0 AND not_after <= DATEADD(day,90,GETUTCDATE()) THEN 1 ELSE 0 END) AS expiring_90d,
        SUM(CASE WHEN is_self_signed=1 THEN 1 ELSE 0 END) AS self_signed
      FROM certificates WHERE tenant_id=@tid2`);
    res.json({ data: r.recordset, summary: summary.recordset[0], page, limit });
  } catch (e) { logger.error('certs list', { err: e.message }); res.status(500).json({ error: 'Failed to fetch certificates.' }); }
});

/* GET /api/certificates/expiring */
router.get('/expiring', async (req, res) => {
  try {
    const pool = await getPool();
    const days = Math.min(365, parseInt(req.query.days) || 30);
    const r = await pool.request().input('tid', sql.UniqueIdentifier, req.tenantId).input('days', sql.Int, days)
      .query(`
        SELECT c.*, a.name AS asset_name, a.hostname AS asset_hostname,
          DATEDIFF(day, GETUTCDATE(), c.not_after) AS days_remaining
        FROM certificates c LEFT JOIN assets a ON c.asset_id=a.id
        WHERE c.tenant_id=@tid AND c.is_expired=0 AND c.not_after IS NOT NULL
          AND c.not_after <= DATEADD(day,@days,GETUTCDATE())
        ORDER BY c.not_after ASC`);
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch expiring certificates.' }); }
});

/* GET /api/certificates/:id */
router.get('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT c.*, a.name AS asset_name FROM certificates c LEFT JOIN assets a ON c.asset_id=a.id WHERE c.id=@id AND c.tenant_id=@tid`);
    if (!r.recordset.length) return res.status(404).json({ error: 'Certificate not found.' });
    res.json(r.recordset[0]);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch certificate.' }); }
});

/* POST /api/certificates — manual registration */
router.post('/', requireRole('operator', 'tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool(); const id = uuidv4();
    const { common_name, san, issuer, subject, serial_number, thumbprint, not_before, not_after, is_self_signed, port, protocol, asset_id } = req.body;
    if (!common_name) return res.status(400).json({ error: 'common_name required.' });
    const notAfterDate = not_after ? new Date(not_after) : null;
    const daysRem = daysUntil(notAfterDate);
    const expired = notAfterDate ? notAfterDate < new Date() : false;
    await pool.request()
      .input('id', sql.UniqueIdentifier, id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .input('asset_id', sql.UniqueIdentifier, asset_id || null)
      .input('common_name', sql.NVarChar, common_name)
      .input('san', sql.NVarChar, san ? JSON.stringify(san) : null)
      .input('issuer', sql.NVarChar, issuer || null).input('subject', sql.NVarChar, subject || null)
      .input('serial_number', sql.NVarChar, serial_number || null).input('thumbprint', sql.NVarChar, thumbprint || null)
      .input('not_before', sql.DateTime2, not_before ? new Date(not_before) : null)
      .input('not_after', sql.DateTime2, notAfterDate)
      .input('days_remaining', sql.Int, daysRem).input('is_expired', sql.Bit, expired ? 1 : 0)
      .input('is_self_signed', sql.Bit, is_self_signed ? 1 : 0)
      .input('port', sql.Int, port || null).input('protocol', sql.NVarChar, protocol || null)
      .query(`INSERT INTO certificates (id,tenant_id,asset_id,common_name,san,issuer,subject,serial_number,thumbprint,not_before,not_after,days_remaining,is_expired,is_self_signed,port,protocol,last_checked)
              VALUES (@id,@tid,@asset_id,@common_name,@san,@issuer,@subject,@serial_number,@thumbprint,@not_before,@not_after,@days_remaining,@is_expired,@is_self_signed,@port,@protocol,GETUTCDATE())`);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'CERTIFICATE_ADDED', resource: 'certificates', resourceId: id, details: { common_name, not_after }, ip: req.ip, ua: req.headers['user-agent'], severity: 'info' });
    res.status(201).json({ id, common_name, days_remaining: daysRem, is_expired: expired });
  } catch (e) { logger.error('cert create', { err: e.message }); res.status(500).json({ error: 'Failed to add certificate.' }); }
});

/* POST /api/certificates/bulk — agent batch ingest */
router.post('/bulk', requireRole('operator', 'tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const { certs } = req.body;
    if (!Array.isArray(certs) || !certs.length) return res.status(400).json({ error: 'certs array required.' });
    const pool = await getPool(); let ingested = 0;
    for (const c of certs.slice(0, 500)) {
      if (!c.common_name) continue;
      const notAfterDate = c.not_after ? new Date(c.not_after) : null;
      const daysRem = daysUntil(notAfterDate);
      const expired = notAfterDate ? notAfterDate < new Date() : false;
      /* upsert by thumbprint if present, else insert */
      if (c.thumbprint) {
        const exists = await pool.request().input('tp', sql.NVarChar, c.thumbprint).input('tid', sql.UniqueIdentifier, req.tenantId)
          .query(`SELECT id FROM certificates WHERE thumbprint=@tp AND tenant_id=@tid`);
        if (exists.recordset.length) {
          await pool.request()
            .input('tp', sql.NVarChar, c.thumbprint).input('tid', sql.UniqueIdentifier, req.tenantId)
            .input('not_after', sql.DateTime2, notAfterDate).input('dr', sql.Int, daysRem)
            .input('expired', sql.Bit, expired ? 1 : 0)
            .query(`UPDATE certificates SET not_after=@not_after, days_remaining=@dr, is_expired=@expired, last_checked=GETUTCDATE() WHERE thumbprint=@tp AND tenant_id=@tid`);
          ingested++; continue;
        }
      }
      await pool.request()
        .input('id', sql.UniqueIdentifier, uuidv4()).input('tid', sql.UniqueIdentifier, req.tenantId)
        .input('asset_id', sql.UniqueIdentifier, c.asset_id || null)
        .input('common_name', sql.NVarChar, c.common_name)
        .input('san', sql.NVarChar, c.san ? JSON.stringify(c.san) : null)
        .input('issuer', sql.NVarChar, c.issuer || null).input('subject', sql.NVarChar, c.subject || null)
        .input('serial_number', sql.NVarChar, c.serial_number || null).input('thumbprint', sql.NVarChar, c.thumbprint || null)
        .input('not_before', sql.DateTime2, c.not_before ? new Date(c.not_before) : null)
        .input('not_after', sql.DateTime2, notAfterDate).input('days_remaining', sql.Int, daysRem)
        .input('is_expired', sql.Bit, expired ? 1 : 0).input('is_self_signed', sql.Bit, c.is_self_signed ? 1 : 0)
        .input('port', sql.Int, c.port || null).input('protocol', sql.NVarChar, c.protocol || null)
        .query(`INSERT INTO certificates (id,tenant_id,asset_id,common_name,san,issuer,subject,serial_number,thumbprint,not_before,not_after,days_remaining,is_expired,is_self_signed,port,protocol,last_checked)
                VALUES (@id,@tid,@asset_id,@common_name,@san,@issuer,@subject,@serial_number,@thumbprint,@not_before,@not_after,@days_remaining,@is_expired,@is_self_signed,@port,@protocol,GETUTCDATE())`);
      ingested++;
    }
    res.status(201).json({ ingested, message: `${ingested} certificate(s) processed.` });
  } catch (e) { logger.error('cert bulk', { err: e.message }); res.status(500).json({ error: 'Bulk certificate ingest failed.' }); }
});

/* PATCH /api/certificates/:id */
router.patch('/:id', requireRole('operator', 'tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    const sets = []; const request = pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId);
    const textFields = ['common_name','issuer','subject','serial_number','thumbprint','protocol'];
    for (const k of textFields) { if (req.body[k] !== undefined) { sets.push(`${k}=@${k}`); request.input(k, sql.NVarChar, req.body[k]); } }
    if (req.body.asset_id !== undefined) { sets.push('asset_id=@asset_id'); request.input('asset_id', sql.UniqueIdentifier, req.body.asset_id || null); }
    if (req.body.port !== undefined) { sets.push('port=@port'); request.input('port', sql.Int, req.body.port); }
    if (req.body.not_after !== undefined) {
      const d = new Date(req.body.not_after);
      sets.push('not_after=@na', 'days_remaining=@dr', 'is_expired=@ie');
      request.input('na', sql.DateTime2, d).input('dr', sql.Int, daysUntil(d)).input('ie', sql.Bit, d < new Date() ? 1 : 0);
    }
    if (sets.length) { sets.push('last_checked=GETUTCDATE()'); await request.query(`UPDATE certificates SET ${sets.join(',')} WHERE id=@id AND tenant_id=@tid`); }
    res.json({ message: 'Certificate updated.' });
  } catch (e) { res.status(500).json({ error: 'Failed to update certificate.' }); }
});

/* DELETE /api/certificates/:id */
router.delete('/:id', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`DELETE FROM certificates WHERE id=@id AND tenant_id=@tid`);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'CERTIFICATE_DELETED', resource: 'certificates', resourceId: req.params.id, ip: req.ip, ua: req.headers['user-agent'], severity: 'info' });
    res.json({ message: 'Certificate deleted.' });
  } catch (e) { res.status(500).json({ error: 'Failed to delete certificate.' }); }
});

/* POST /api/certificates/refresh-days — recalculate days_remaining for all */
router.post('/refresh-days', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().input('tid', sql.UniqueIdentifier, req.tenantId).query(`
      UPDATE certificates
      SET days_remaining = DATEDIFF(day, GETUTCDATE(), not_after),
          is_expired      = CASE WHEN not_after < GETUTCDATE() THEN 1 ELSE 0 END,
          last_checked    = GETUTCDATE()
      WHERE tenant_id=@tid AND not_after IS NOT NULL`);
    res.json({ updated: r.rowsAffected[0], message: `${r.rowsAffected[0]} certificate(s) refreshed.` });
  } catch (e) { res.status(500).json({ error: 'Refresh failed.' }); }
});

module.exports = router;
