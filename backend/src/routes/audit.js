'use strict';

const router = require('express').Router();
const { getPool, sql }   = require('../db/pool');
const { authenticate, requireRole, tenantScope } = require('../middleware/auth');

router.use(authenticate, tenantScope, requireRole('tenant_admin', 'super_admin'));

/* GET /api/audit
   Supports: ?action= &resource= &severity= &userId= &from= &to= &page= &limit= */
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const {
      action, resource, severity, userId,
      from, to,
      page  = 1,
      limit = 100,
    } = req.query;

    let where   = `WHERE (al.tenant_id=@tid OR (al.tenant_id IS NULL AND @isSuper=1))`;
    const request = pool.request()
      .input('tid',     sql.UniqueIdentifier, req.tenantId)
      .input('isSuper', sql.Bit,              req.user.role === 'super_admin' ? 1 : 0);

    if (action)   { where += ` AND al.action=@action`;     request.input('action',   sql.NVarChar,         action);   }
    if (resource) { where += ` AND al.resource=@resource`; request.input('resource', sql.NVarChar,         resource); }
    if (severity) { where += ` AND al.severity=@severity`; request.input('severity', sql.NVarChar,         severity); }
    if (userId)   { where += ` AND al.user_id=@userId`;    request.input('userId',   sql.UniqueIdentifier, userId);   }
    if (from)     { where += ` AND al.created_at>=@from`;  request.input('from',     sql.DateTime2,        new Date(from)); }
    if (to)       { where += ` AND al.created_at<=@to`;    request.input('to',       sql.DateTime2,        new Date(to));   }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await request.query(`
      SELECT al.*
      FROM audit_log al
      ${where}
      ORDER BY al.created_at DESC
      OFFSET ${offset} ROWS FETCH NEXT ${parseInt(limit)} ROWS ONLY
    `);

    /* total count for pagination */
    const countReq = pool.request()
      .input('tid2',     sql.UniqueIdentifier, req.tenantId)
      .input('isSuper2', sql.Bit,              req.user.role === 'super_admin' ? 1 : 0);
    const countRes = await countReq.query(
      `SELECT COUNT(*) AS total FROM audit_log
       WHERE (tenant_id=@tid2 OR (tenant_id IS NULL AND @isSuper2=1))`
    );

    return res.json({
      data:  result.recordset,
      total: countRes.recordset[0].total,
      page:  parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch audit log.' });
  }
});

/* GET /api/audit/summary — counts by severity for dashboard widget */
router.get('/summary', async (req, res) => {
  try {
    const pool   = await getPool();
    const result = await pool.request()
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN severity='info'     THEN 1 ELSE 0 END) AS info,
          SUM(CASE WHEN severity='warning'  THEN 1 ELSE 0 END) AS warning,
          SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) AS critical,
          SUM(CASE WHEN created_at > DATEADD(hour,-24,GETUTCDATE()) THEN 1 ELSE 0 END) AS last_24h
        FROM audit_log
        WHERE tenant_id=@tid
      `);
    return res.json(result.recordset[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch audit summary.' });
  }
});

module.exports = router;
