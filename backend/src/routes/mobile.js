'use strict';
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { getPool, sql } = require('../db/pool');
const { authenticate, requireRole, tenantScope } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const logger = require('../utils/logger');
router.use(authenticate, tenantScope);

/* ══════════════════════════════════════════════════════════════════
   GET /api/mobile
   ══════════════════════════════════════════════════════════════════ */
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const { os_type, mdm_enrolled, mdm_compliant, security_compliant, assigned_user, search } = req.query;
    const page   = Math.max(1,   parseInt(req.query.page)  || 1);
    const limit  = Math.min(500, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;

    let where = `WHERE m.tenant_id=@tid`;
    const request = pool.request().input('tid', sql.UniqueIdentifier, req.tenantId);
    if (os_type)           { where += ` AND m.os_type=@os_type`;          request.input('os_type',  sql.NVarChar, os_type); }
    if (mdm_enrolled !== undefined) { where += ` AND m.mdm_enrolled=@me`; request.input('me', sql.Bit, mdm_enrolled === 'true' ? 1 : 0); }
    if (mdm_compliant !== undefined){ where += ` AND m.mdm_compliant=@mc`; request.input('mc', sql.Bit, mdm_compliant === 'true' ? 1 : 0); }
    if (security_compliant !== undefined){ where += ` AND m.security_compliant=@sc`; request.input('sc', sql.Bit, security_compliant === 'true' ? 1 : 0); }
    if (assigned_user) { where += ` AND m.assigned_user LIKE @au`; request.input('au', sql.NVarChar, `%${assigned_user}%`); }
    if (search) {
      where += ` AND (m.name LIKE @srch OR m.model LIKE @srch OR m.device_id LIKE @srch OR m.assigned_user LIKE @srch OR m.os_version LIKE @srch)`;
      request.input('srch', sql.NVarChar, `%${search}%`);
    }

    const cntReq = pool.request().input('tid2', sql.UniqueIdentifier, req.tenantId);
    const cntRes = await cntReq.query(`SELECT COUNT(*) AS total FROM mobile_devices m WHERE m.tenant_id=@tid2`);

    const r = await request.query(`
      SELECT m.*,
        CASE WHEN m.last_seen < DATEADD(hour,-24,GETUTCDATE()) THEN 1 ELSE 0 END AS is_stale
      FROM mobile_devices m
      ${where}
      ORDER BY m.last_seen DESC
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`);

    res.json({ data: r.recordset, total: cntRes.recordset[0].total, page, limit });
  } catch (e) { logger.error('mobile list', { err: e.message }); res.status(500).json({ error: 'Failed to fetch mobile devices.' }); }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/mobile/summary
   ══════════════════════════════════════════════════════════════════ */
router.get('/summary', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().input('tid', sql.UniqueIdentifier, req.tenantId).query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN os_type='ios'            THEN 1 ELSE 0 END) AS ios,
        SUM(CASE WHEN os_type='android'        THEN 1 ELSE 0 END) AS android,
        SUM(CASE WHEN os_type='windows_mobile' THEN 1 ELSE 0 END) AS windows_mobile,
        SUM(CASE WHEN mdm_enrolled=1    THEN 1 ELSE 0 END) AS mdm_enrolled,
        SUM(CASE WHEN mdm_enrolled=0    THEN 1 ELSE 0 END) AS mdm_not_enrolled,
        SUM(CASE WHEN mdm_compliant=1   THEN 1 ELSE 0 END) AS mdm_compliant,
        SUM(CASE WHEN mdm_compliant=0   THEN 1 ELSE 0 END) AS mdm_non_compliant,
        SUM(CASE WHEN security_compliant=1 THEN 1 ELSE 0 END) AS security_compliant,
        SUM(CASE WHEN security_compliant=0 THEN 1 ELSE 0 END) AS security_non_compliant,
        SUM(CASE WHEN jailbroken=1         THEN 1 ELSE 0 END) AS jailbroken,
        SUM(CASE WHEN encryption_enabled=0 THEN 1 ELSE 0 END) AS encryption_disabled,
        SUM(CASE WHEN screen_lock_enabled=0 THEN 1 ELSE 0 END) AS no_screen_lock,
        SUM(CASE WHEN wifi_connected=1      THEN 1 ELSE 0 END) AS wifi_connected,
        SUM(CASE WHEN cellular_connected=1  THEN 1 ELSE 0 END) AS cellular_connected,
        SUM(CASE WHEN last_seen < DATEADD(hour,-24,GETUTCDATE()) THEN 1 ELSE 0 END) AS stale_24h,
        SUM(CASE WHEN last_seen < DATEADD(hour,-72,GETUTCDATE()) THEN 1 ELSE 0 END) AS stale_72h,
        AVG(CAST(battery_level AS FLOAT)) AS avg_battery
      FROM mobile_devices WHERE tenant_id=@tid`);
    res.json(r.recordset[0]);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch mobile summary.' }); }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/mobile/:id
   ══════════════════════════════════════════════════════════════════ */
router.get('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT * FROM mobile_devices WHERE id=@id AND tenant_id=@tid`);
    if (!r.recordset.length) return res.status(404).json({ error: 'Mobile device not found.' });
    res.json(r.recordset[0]);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch mobile device.' }); }
});

/* ══════════════════════════════════════════════════════════════════
   POST /api/mobile — register device (manual or MDM webhook)
   ══════════════════════════════════════════════════════════════════ */
router.post('/', requireRole('operator', 'tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool(); const id = uuidv4();
    const {
      device_id, name, model, manufacturer, os_type, os_version,
      mdm_provider, mdm_enrolled, mdm_compliant, mdm_last_sync,
      battery_level, battery_health, is_charging,
      wifi_connected, cellular_connected,
      gps_lat, gps_lng, gps_accuracy_m, gps_timestamp,
      security_compliant, screen_lock_enabled, encryption_enabled, jailbroken,
      assigned_user, asset_id, metadata,
    } = req.body;
    if (!device_id || !os_type) return res.status(400).json({ error: 'device_id and os_type required.' });
    const validOS = ['ios','android','windows_mobile','other'];
    if (!validOS.includes(os_type)) return res.status(400).json({ error: `os_type must be one of: ${validOS.join(', ')}` });

    /* Check for existing device_id in this tenant */
    const dup = await pool.request().input('did', sql.NVarChar, device_id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT id FROM mobile_devices WHERE device_id=@did AND tenant_id=@tid`);
    if (dup.recordset.length) return res.status(409).json({ error: 'Device already registered. Use PATCH to update.', existingId: dup.recordset[0].id });

    await pool.request()
      .input('id', sql.UniqueIdentifier, id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .input('asset_id',           sql.UniqueIdentifier, asset_id          || null)
      .input('device_id',          sql.NVarChar,         device_id)
      .input('name',               sql.NVarChar,         name              || null)
      .input('model',              sql.NVarChar,         model             || null)
      .input('manufacturer',       sql.NVarChar,         manufacturer      || null)
      .input('os_type',            sql.NVarChar,         os_type)
      .input('os_version',         sql.NVarChar,         os_version        || null)
      .input('mdm_provider',       sql.NVarChar,         mdm_provider      || null)
      .input('mdm_enrolled',       sql.Bit,              mdm_enrolled      ? 1 : 0)
      .input('mdm_compliant',      sql.Bit,              mdm_compliant     ?? null)
      .input('mdm_last_sync',      sql.DateTime2,        mdm_last_sync     ? new Date(mdm_last_sync) : null)
      .input('battery_level',      sql.Int,              battery_level     ?? null)
      .input('battery_health',     sql.NVarChar,         battery_health    || null)
      .input('is_charging',        sql.Bit,              is_charging       ?? null)
      .input('wifi_connected',     sql.Bit,              wifi_connected    ?? null)
      .input('cellular_connected', sql.Bit,              cellular_connected ?? null)
      .input('gps_lat',            sql.Float,            gps_lat           ?? null)
      .input('gps_lng',            sql.Float,            gps_lng           ?? null)
      .input('gps_accuracy_m',     sql.Float,            gps_accuracy_m    ?? null)
      .input('gps_timestamp',      sql.DateTime2,        gps_timestamp     ? new Date(gps_timestamp) : null)
      .input('security_compliant', sql.Bit,              security_compliant ?? null)
      .input('screen_lock_enabled',sql.Bit,              screen_lock_enabled ?? null)
      .input('encryption_enabled', sql.Bit,              encryption_enabled  ?? null)
      .input('jailbroken',         sql.Bit,              jailbroken          ?? null)
      .input('assigned_user',      sql.NVarChar,         assigned_user       || null)
      .input('metadata',           sql.NVarChar,         metadata            ? JSON.stringify(metadata) : null)
      .query(`INSERT INTO mobile_devices
        (id,tenant_id,asset_id,device_id,name,model,manufacturer,os_type,os_version,
         mdm_provider,mdm_enrolled,mdm_compliant,mdm_last_sync,
         battery_level,battery_health,is_charging,wifi_connected,cellular_connected,
         gps_lat,gps_lng,gps_accuracy_m,gps_timestamp,
         security_compliant,screen_lock_enabled,encryption_enabled,jailbroken,
         assigned_user,metadata,last_seen,last_check_in)
        VALUES
        (@id,@tid,@asset_id,@device_id,@name,@model,@manufacturer,@os_type,@os_version,
         @mdm_provider,@mdm_enrolled,@mdm_compliant,@mdm_last_sync,
         @battery_level,@battery_health,@is_charging,@wifi_connected,@cellular_connected,
         @gps_lat,@gps_lng,@gps_accuracy_m,@gps_timestamp,
         @security_compliant,@screen_lock_enabled,@encryption_enabled,@jailbroken,
         @assigned_user,@metadata,GETUTCDATE(),GETUTCDATE())`);

    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'MOBILE_DEVICE_ADDED', resource: 'mobile_devices', resourceId: id, details: { device_id, os_type, assigned_user }, ip: req.ip, ua: req.headers['user-agent'], severity: 'info' });
    res.status(201).json({ id, device_id, os_type });
  } catch (e) { logger.error('mobile create', { err: e.message }); res.status(500).json({ error: 'Failed to register mobile device.' }); }
});

/* ══════════════════════════════════════════════════════════════════
   POST /api/mobile/checkin — MDM or agent check-in (upsert)
   ══════════════════════════════════════════════════════════════════ */
router.post('/checkin', async (req, res) => {
  try {
    const pool = await getPool();
    const { device_id, os_type } = req.body;
    if (!device_id) return res.status(400).json({ error: 'device_id required.' });

    const existing = await pool.request().input('did', sql.NVarChar, device_id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT id FROM mobile_devices WHERE device_id=@did AND tenant_id=@tid`);

    if (!existing.recordset.length) {
      /* Auto-register on first check-in */
      const newId = uuidv4();
      await pool.request()
        .input('id', sql.UniqueIdentifier, newId).input('tid', sql.UniqueIdentifier, req.tenantId)
        .input('did', sql.NVarChar, device_id).input('os', sql.NVarChar, os_type || 'other')
        .query(`INSERT INTO mobile_devices (id,tenant_id,device_id,os_type,mdm_enrolled,last_seen,last_check_in) VALUES (@id,@tid,@did,@os,0,GETUTCDATE(),GETUTCDATE())`);
      return res.json({ id: newId, status: 'registered' });
    }

    /* Update telemetry fields from check-in payload */
    const {
      os_version, mdm_compliant, mdm_last_sync, battery_level, battery_health, is_charging,
      wifi_connected, cellular_connected, gps_lat, gps_lng, gps_accuracy_m,
      security_compliant, screen_lock_enabled, encryption_enabled, jailbroken,
    } = req.body;

    const sets = ['last_seen=GETUTCDATE()', 'last_check_in=GETUTCDATE()', 'updated_at=GETUTCDATE()'];
    const request = pool.request().input('did', sql.NVarChar, device_id).input('tid', sql.UniqueIdentifier, req.tenantId);

    if (os_version       !== undefined) { sets.push('os_version=@ov');           request.input('ov',  sql.NVarChar,  os_version); }
    if (mdm_compliant    !== undefined) { sets.push('mdm_compliant=@mc');         request.input('mc',  sql.Bit,       mdm_compliant ? 1 : 0); }
    if (mdm_last_sync    !== undefined) { sets.push('mdm_last_sync=@mls');        request.input('mls', sql.DateTime2, new Date(mdm_last_sync)); }
    if (battery_level    !== undefined) { sets.push('battery_level=@bl');         request.input('bl',  sql.Int,       battery_level); }
    if (battery_health   !== undefined) { sets.push('battery_health=@bh');        request.input('bh',  sql.NVarChar,  battery_health); }
    if (is_charging      !== undefined) { sets.push('is_charging=@ic');           request.input('ic',  sql.Bit,       is_charging ? 1 : 0); }
    if (wifi_connected   !== undefined) { sets.push('wifi_connected=@wc');        request.input('wc',  sql.Bit,       wifi_connected ? 1 : 0); }
    if (cellular_connected !== undefined){ sets.push('cellular_connected=@cc');   request.input('cc',  sql.Bit,       cellular_connected ? 1 : 0); }
    if (gps_lat          !== undefined) { sets.push('gps_lat=@glat');             request.input('glat',sql.Float,     gps_lat); }
    if (gps_lng          !== undefined) { sets.push('gps_lng=@glng');             request.input('glng',sql.Float,     gps_lng); }
    if (gps_accuracy_m   !== undefined) { sets.push('gps_accuracy_m=@gacc');      request.input('gacc',sql.Float,     gps_accuracy_m); }
    if (gps_lat || gps_lng)             { sets.push('gps_timestamp=GETUTCDATE()'); }
    if (security_compliant !== undefined){ sets.push('security_compliant=@scs');  request.input('scs', sql.Bit,       security_compliant ? 1 : 0); }
    if (screen_lock_enabled !== undefined){ sets.push('screen_lock_enabled=@sle');request.input('sle', sql.Bit,       screen_lock_enabled ? 1 : 0); }
    if (encryption_enabled !== undefined){ sets.push('encryption_enabled=@ee');   request.input('ee',  sql.Bit,       encryption_enabled ? 1 : 0); }
    if (jailbroken       !== undefined) { sets.push('jailbroken=@jb');            request.input('jb',  sql.Bit,       jailbroken ? 1 : 0); }

    await request.query(`UPDATE mobile_devices SET ${sets.join(',')} WHERE device_id=@did AND tenant_id=@tid`);
    res.json({ id: existing.recordset[0].id, status: 'updated' });
  } catch (e) { logger.error('mobile checkin', { err: e.message }); res.status(500).json({ error: 'Check-in failed.' }); }
});

/* ══════════════════════════════════════════════════════════════════
   PATCH /api/mobile/:id
   ══════════════════════════════════════════════════════════════════ */
router.patch('/:id', requireRole('operator', 'tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    const textFields = ['name','model','manufacturer','os_version','mdm_provider','battery_health','assigned_user'];
    const sets = []; const request = pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId);
    for (const k of textFields) { if (req.body[k] !== undefined) { sets.push(`${k}=@${k}`); request.input(k, sql.NVarChar, req.body[k]); } }
    const bitFields = ['mdm_enrolled','mdm_compliant','is_charging','wifi_connected','cellular_connected','security_compliant','screen_lock_enabled','encryption_enabled','jailbroken'];
    for (const k of bitFields) { if (req.body[k] !== undefined) { sets.push(`${k}=@${k}`); request.input(k, sql.Bit, req.body[k] ? 1 : 0); } }
    if (req.body.battery_level !== undefined) { sets.push('battery_level=@battery_level'); request.input('battery_level', sql.Int, req.body.battery_level); }
    if (req.body.asset_id !== undefined) { sets.push('asset_id=@asset_id'); request.input('asset_id', sql.UniqueIdentifier, req.body.asset_id || null); }
    if (sets.length) { sets.push('updated_at=GETUTCDATE()'); await request.query(`UPDATE mobile_devices SET ${sets.join(',')} WHERE id=@id AND tenant_id=@tid`); }
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'MOBILE_DEVICE_UPDATED', resource: 'mobile_devices', resourceId: req.params.id, details: req.body, ip: req.ip, ua: req.headers['user-agent'], severity: 'info' });
    res.json({ message: 'Mobile device updated.' });
  } catch (e) { res.status(500).json({ error: 'Failed to update mobile device.' }); }
});

/* ══════════════════════════════════════════════════════════════════
   DELETE /api/mobile/:id
   ══════════════════════════════════════════════════════════════════ */
router.delete('/:id', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id).input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`DELETE FROM mobile_devices WHERE id=@id AND tenant_id=@tid`);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, userEmail: req.user.email, action: 'MOBILE_DEVICE_DELETED', resource: 'mobile_devices', resourceId: req.params.id, ip: req.ip, ua: req.headers['user-agent'], severity: 'warning' });
    res.json({ message: 'Mobile device deleted.' });
  } catch (e) { res.status(500).json({ error: 'Failed to delete mobile device.' }); }
});

module.exports = router;
