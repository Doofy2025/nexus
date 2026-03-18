'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { getPool, sql }   = require('../db/pool');
const { authenticate, requireRole, tenantScope } = require('../middleware/auth');
const { logAudit }       = require('../utils/audit');
const logger             = require('../utils/logger');

router.use(authenticate);

const DEFAULT_SITES = [
  { name:'Austin Datacenter',     code:'ADC',       type:'datacenter', provider:null,    location:'Austin, TX',     lat:30.2672, lng:-97.7431 },
  { name:'San Angelo Datacenter', code:'SDC',       type:'datacenter', provider:null,    location:'San Angelo, TX', lat:31.4638, lng:-100.4370 },
  { name:'LDC Annex',             code:'LDC-ANNEX', type:'datacenter', provider:null,    location:'Austin, TX',     lat:30.2730, lng:-97.7401 },
  { name:'LDC Mopac',             code:'LDC-MOPAC', type:'datacenter', provider:null,    location:'Austin, TX',     lat:30.3070, lng:-97.7401 },
  { name:'Amazon Web Services',   code:'AWS',       type:'cloud',      provider:'AWS',   location:'us-east-1',      lat:null, lng:null },
  { name:'Microsoft Azure',       code:'AZURE',     type:'cloud',      provider:'Azure', location:'eastus',         lat:null, lng:null },
  { name:'Google Cloud Platform', code:'GCP',       type:'cloud',      provider:'GCP',   location:'us-central1',    lat:null, lng:null },
];

/* ══════════════════════════════════════════════════════════════════
   GET /api/tenants  — super_admin sees all; others see own
   ══════════════════════════════════════════════════════════════════ */
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();

    if (req.user.role === 'super_admin') {
      const result = await pool.request().query(`
        SELECT t.*,
          (SELECT COUNT(*) FROM users  WHERE tenant_id=t.id) AS user_count,
          (SELECT COUNT(*) FROM assets WHERE tenant_id=t.id) AS asset_count,
          (SELECT COUNT(*) FROM sites  WHERE tenant_id=t.id) AS site_count
        FROM tenants t ORDER BY t.created_at DESC
      `);
      return res.json(result.recordset);
    }

    /* non-super — own tenant only */
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT * FROM tenants WHERE id=@id`);
    return res.json(result.recordset);
  } catch (err) {
    logger.error('tenants list', { err: err.message });
    return res.status(500).json({ error: 'Failed to fetch tenants.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/tenants/:id
   ══════════════════════════════════════════════════════════════════ */
router.get('/:id', async (req, res) => {
  try {
    /* non-super_admin can only read their own tenant */
    if (req.user.role !== 'super_admin' && req.params.id !== req.tenantId) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const pool   = await getPool();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, req.params.id)
      .query(`SELECT * FROM tenants WHERE id=@id`);

    if (!result.recordset.length) return res.status(404).json({ error: 'Tenant not found.' });
    return res.json(result.recordset[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch tenant.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   POST /api/tenants  — super_admin only; creates tenant + default sites
   ══════════════════════════════════════════════════════════════════ */
router.post('/', requireRole('super_admin'), async (req, res) => {
  try {
    const { name, slug, logoUrl, primaryColor } = req.body;
    if (!name || !slug) return res.status(400).json({ error: 'Name and slug are required.' });
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).json({ error: 'Slug may only contain lowercase letters, numbers and hyphens.' });
    }

    const pool = await getPool();
    const dup  = await pool.request()
      .input('slug', sql.NVarChar, slug)
      .query(`SELECT 1 FROM tenants WHERE slug=@slug`);
    if (dup.recordset.length) return res.status(409).json({ error: 'Slug already in use.' });

    const id = uuidv4();
    await pool.request()
      .input('id',           sql.UniqueIdentifier, id)
      .input('name',         sql.NVarChar,         name.trim())
      .input('slug',         sql.NVarChar,         slug.trim())
      .input('logo_url',     sql.NVarChar,         logoUrl     || null)
      .input('primary_color',sql.NVarChar,         primaryColor || null)
      .query(`INSERT INTO tenants (id,name,slug,logo_url,primary_color)
              VALUES (@id,@name,@slug,@logo_url,@primary_color)`);

    /* create default sites */
    for (const s of DEFAULT_SITES) {
      await pool.request()
        .input('tid',      sql.UniqueIdentifier, id)
        .input('name',     sql.NVarChar,         s.name)
        .input('code',     sql.NVarChar,         s.code)
        .input('type',     sql.NVarChar,         s.type)
        .input('provider', sql.NVarChar,         s.provider)
        .input('location', sql.NVarChar,         s.location)
        .input('lat',      sql.Float,            s.lat)
        .input('lng',      sql.Float,            s.lng)
        .query(`INSERT INTO sites (tenant_id,name,code,type,provider,location,latitude,longitude)
                VALUES (@tid,@name,@code,@type,@provider,@location,@lat,@lng)`);
    }

    await logAudit({ tenantId:id, userId:req.user.id, userEmail:req.user.email,
      action:'TENANT_CREATED', resource:'tenants', resourceId:id,
      details:{ name, slug }, ip:req.ip, ua:req.headers['user-agent'], severity:'info' });

    return res.status(201).json({ id, name, slug });
  } catch (err) {
    logger.error('create tenant', { err: err.message });
    return res.status(500).json({ error: 'Failed to create tenant.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   PATCH /api/tenants/:id/settings
   ══════════════════════════════════════════════════════════════════ */
router.patch('/:id/settings', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    /* non-super can only update their own tenant */
    if (req.user.role !== 'super_admin' && req.params.id !== req.tenantId) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const allowed = {
      registration_enabled:     sql.Bit,
      session_timeout_minutes:  sql.Int,
      max_failed_attempts:      sql.Int,
      lockout_duration_minutes: sql.Int,
      logo_url:                 sql.NVarChar,
      primary_color:            sql.NVarChar,
    };

    const sets    = [];
    const request = require('../db/pool').getPool().then(p => p.request())
      .catch(() => null);

    /* Synchronous build — pool must be ready */
    const pool = await getPool();
    const req2 = pool.request().input('id', sql.UniqueIdentifier, req.params.id);

    for (const [k, sqlType] of Object.entries(allowed)) {
      if (req.body[k] !== undefined) {
        sets.push(`${k}=@${k}`);
        req2.input(k, sqlType, req.body[k]);
      }
    }

    if (sets.length) {
      sets.push(`updated_at=GETUTCDATE()`);
      await req2.query(`UPDATE tenants SET ${sets.join(',')} WHERE id=@id`);
    }

    await logAudit({ tenantId:req.params.id, userId:req.user.id, userEmail:req.user.email,
      action:'TENANT_SETTINGS_UPDATED', resource:'tenants', resourceId:req.params.id,
      details:req.body, ip:req.ip, ua:req.headers['user-agent'], severity:'warning' });

    return res.json({ message: 'Settings updated.' });
  } catch (err) {
    logger.error('update tenant settings', { err: err.message });
    return res.status(500).json({ error: 'Failed to update settings.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   PATCH /api/tenants/:id/toggle-active  — super_admin only
   ══════════════════════════════════════════════════════════════════ */
router.patch('/:id/toggle-active', requireRole('super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.UniqueIdentifier, req.params.id)
      .query(`UPDATE tenants SET is_active=CASE WHEN is_active=1 THEN 0 ELSE 1 END,
                                updated_at=GETUTCDATE() WHERE id=@id`);

    await logAudit({ tenantId:req.params.id, userId:req.user.id, userEmail:req.user.email,
      action:'TENANT_TOGGLED', resource:'tenants', resourceId:req.params.id,
      ip:req.ip, ua:req.headers['user-agent'], severity:'critical' });

    return res.json({ message: 'Tenant toggled.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to toggle tenant.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   DELETE /api/tenants/:id  — super_admin only
   ══════════════════════════════════════════════════════════════════ */
router.delete('/:id', requireRole('super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.UniqueIdentifier, req.params.id)
      .query(`DELETE FROM tenants WHERE id=@id`);

    await logAudit({ tenantId:null, userId:req.user.id, userEmail:req.user.email,
      action:'TENANT_DELETED', resource:'tenants', resourceId:req.params.id,
      ip:req.ip, ua:req.headers['user-agent'], severity:'critical' });

    return res.json({ message: 'Tenant deleted.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete tenant.' });
  }
});

module.exports = router;
