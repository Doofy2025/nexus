'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { getPool, sql }   = require('../db/pool');
const { authenticate, requireRole, tenantScope } = require('../middleware/auth');
const { logAudit }       = require('../utils/audit');

router.use(authenticate, tenantScope);

/* GET /api/sites */
router.get('/', async (req, res) => {
  try {
    const pool   = await getPool();
    const result = await pool.request()
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`
        SELECT s.*,
          (SELECT COUNT(*) FROM assets WHERE site_id=s.id) AS asset_count
        FROM sites s
        WHERE s.tenant_id=@tid
        ORDER BY s.name
      `);
    return res.json(result.recordset);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch sites.' });
  }
});

/* GET /api/sites/:id */
router.get('/:id', async (req, res) => {
  try {
    const pool   = await getPool();
    const result = await pool.request()
      .input('id',  sql.UniqueIdentifier, req.params.id)
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT * FROM sites WHERE id=@id AND tenant_id=@tid`);

    if (!result.recordset.length) return res.status(404).json({ error: 'Site not found.' });
    return res.json(result.recordset[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch site.' });
  }
});

/* POST /api/sites */
router.post('/', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const { name, code, type, provider, location, latitude, longitude, metadata } = req.body;
    if (!name || !code || !type) {
      return res.status(400).json({ error: 'Name, code and type are required.' });
    }

    const pool = await getPool();
    const dup  = await pool.request()
      .input('tid',  sql.UniqueIdentifier, req.tenantId)
      .input('code', sql.NVarChar,         code.toUpperCase())
      .query(`SELECT 1 FROM sites WHERE tenant_id=@tid AND code=@code`);
    if (dup.recordset.length) return res.status(409).json({ error: 'Site code already exists.' });

    const id = uuidv4();
    await pool.request()
      .input('id',       sql.UniqueIdentifier, id)
      .input('tid',      sql.UniqueIdentifier, req.tenantId)
      .input('name',     sql.NVarChar,         name)
      .input('code',     sql.NVarChar,         code.toUpperCase())
      .input('type',     sql.NVarChar,         type)
      .input('provider', sql.NVarChar,         provider  || null)
      .input('location', sql.NVarChar,         location  || null)
      .input('lat',      sql.Float,            latitude  || null)
      .input('lng',      sql.Float,            longitude || null)
      .input('metadata', sql.NVarChar,         metadata  ? JSON.stringify(metadata) : null)
      .query(`INSERT INTO sites (id,tenant_id,name,code,type,provider,location,latitude,longitude,metadata)
              VALUES (@id,@tid,@name,@code,@type,@provider,@location,@lat,@lng,@metadata)`);

    await logAudit({ tenantId:req.tenantId, userId:req.user.id, userEmail:req.user.email,
      action:'SITE_CREATED', resource:'sites', resourceId:id,
      details:{ name, code, type }, ip:req.ip, ua:req.headers['user-agent'], severity:'info' });

    return res.status(201).json({ id, name, code: code.toUpperCase(), type });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create site.' });
  }
});

/* PATCH /api/sites/:id */
router.patch('/:id', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool  = await getPool();
    const check = await pool.request()
      .input('id',  sql.UniqueIdentifier, req.params.id)
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT 1 FROM sites WHERE id=@id AND tenant_id=@tid`);
    if (!check.recordset.length) return res.status(404).json({ error: 'Site not found.' });

    const allowed = { name:sql.NVarChar, provider:sql.NVarChar, location:sql.NVarChar,
                      latitude:sql.Float, longitude:sql.Float };
    const sets    = [];
    const request = pool.request().input('id', sql.UniqueIdentifier, req.params.id);

    for (const [k, t] of Object.entries(allowed)) {
      if (req.body[k] !== undefined) { sets.push(`${k}=@${k}`); request.input(k, t, req.body[k]); }
    }
    if (sets.length) {
      sets.push(`updated_at=GETUTCDATE()`);
      await request.query(`UPDATE sites SET ${sets.join(',')} WHERE id=@id`);
    }

    return res.json({ message: 'Site updated.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update site.' });
  }
});

/* PATCH /api/sites/:id/toggle */
router.patch('/:id/toggle', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('id',  sql.UniqueIdentifier, req.params.id)
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`UPDATE sites SET is_active=CASE WHEN is_active=1 THEN 0 ELSE 1 END,
                               updated_at=GETUTCDATE() WHERE id=@id AND tenant_id=@tid`);
    return res.json({ message: 'Site toggled.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to toggle site.' });
  }
});

/* DELETE /api/sites/:id */
router.delete('/:id', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool();

    const assetCheck = await pool.request()
      .input('id', sql.UniqueIdentifier, req.params.id)
      .query(`SELECT COUNT(*) AS cnt FROM assets WHERE site_id=@id AND status != 'decommissioned'`);
    if (assetCheck.recordset[0].cnt > 0) {
      return res.status(409).json({ error: 'Cannot delete site with active assets. Move or decommission assets first.' });
    }

    await pool.request()
      .input('id',  sql.UniqueIdentifier, req.params.id)
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`DELETE FROM sites WHERE id=@id AND tenant_id=@tid`);

    await logAudit({ tenantId:req.tenantId, userId:req.user.id, userEmail:req.user.email,
      action:'SITE_DELETED', resource:'sites', resourceId:req.params.id,
      ip:req.ip, ua:req.headers['user-agent'], severity:'warning' });

    return res.json({ message: 'Site deleted.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete site.' });
  }
});

module.exports = router;
