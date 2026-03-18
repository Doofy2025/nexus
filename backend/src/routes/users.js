'use strict';

const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getPool, sql }   = require('../db/pool');
const { authenticate, requireRole, tenantScope } = require('../middleware/auth');
const { logAudit }       = require('../utils/audit');
const logger             = require('../utils/logger');

router.use(authenticate, tenantScope);

/* ══════════════════════════════════════════════════════════════════
   GET /api/users
   List users for the current tenant (or any tenant for super_admin)
   ══════════════════════════════════════════════════════════════════ */
router.get('/', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool   = await getPool();
    const result = await pool.request()
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`
        SELECT
          u.id, u.email, u.display_name, u.avatar_url,
          u.is_active, u.is_locked, u.failed_attempts,
          u.last_login, u.mfa_enabled, u.created_at, u.updated_at,
          ur.role
        FROM users u
        JOIN user_roles ur ON u.id = ur.user_id AND ur.tenant_id = @tid
        WHERE u.tenant_id = @tid
        ORDER BY u.created_at DESC
      `);
    return res.json(result.recordset);
  } catch (err) {
    logger.error('users list', { err: err.message });
    return res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/users/:id
   ══════════════════════════════════════════════════════════════════ */
router.get('/:id', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool   = await getPool();
    const result = await pool.request()
      .input('id',  sql.UniqueIdentifier, req.params.id)
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`
        SELECT u.id, u.email, u.display_name, u.avatar_url,
               u.is_active, u.is_locked, u.failed_attempts,
               u.last_login, u.mfa_enabled, u.preferences,
               u.created_at, u.updated_at, ur.role
        FROM users u
        JOIN user_roles ur ON u.id = ur.user_id AND ur.tenant_id = @tid
        WHERE u.id=@id AND u.tenant_id=@tid
      `);

    if (!result.recordset.length) return res.status(404).json({ error: 'User not found.' });
    return res.json(result.recordset[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch user.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   POST /api/users   — create user (admin sets initial role)
   ══════════════════════════════════════════════════════════════════ */
router.post('/', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const { email, displayName, role = 'viewer', password } = req.body;
    if (!email || !displayName) {
      return res.status(400).json({ error: 'Email and display name are required.' });
    }

    const validRoles = ['tenant_admin', 'operator', 'viewer'];
    if (req.user.role === 'super_admin') validRoles.push('super_admin');
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}.` });
    }

    const pool     = await getPool();
    const existing = await pool.request()
      .input('email', sql.NVarChar, email.toLowerCase().trim())
      .query(`SELECT 1 FROM users WHERE email=@email`);

    if (existing.recordset.length) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const initialPassword = password || 'changeme';
    const hash   = await bcrypt.hash(initialPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    const userId = uuidv4();

    await pool.request()
      .input('id',    sql.UniqueIdentifier, userId)
      .input('tid',   sql.UniqueIdentifier, req.tenantId)
      .input('email', sql.NVarChar,         email.toLowerCase().trim())
      .input('name',  sql.NVarChar,         displayName.trim())
      .input('hash',  sql.NVarChar,         hash)
      .query(`INSERT INTO users (id,tenant_id,email,display_name,password_hash)
              VALUES (@id,@tid,@email,@name,@hash)`);

    await pool.request()
      .input('uid',  sql.UniqueIdentifier, userId)
      .input('tid',  sql.UniqueIdentifier, req.tenantId)
      .input('role', sql.NVarChar,         role)
      .query(`INSERT INTO user_roles (user_id,tenant_id,role) VALUES (@uid,@tid,@role)`);

    await logAudit({ tenantId:req.tenantId, userId:req.user.id, userEmail:req.user.email,
      action:'USER_CREATED', resource:'users', resourceId:userId,
      details:{ email, role }, ip:req.ip, ua:req.headers['user-agent'], severity:'info' });

    return res.status(201).json({ id:userId, email, displayName, role,
      message: password ? 'User created.' : 'User created with default password "changeme".' });
  } catch (err) {
    logger.error('create user', { err: err.message });
    return res.status(500).json({ error: 'Failed to create user.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   PATCH /api/users/:id  — update display name / avatar
   ══════════════════════════════════════════════════════════════════ */
router.patch('/:id', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool  = await getPool();
    const check = await pool.request()
      .input('id',  sql.UniqueIdentifier, req.params.id)
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`SELECT 1 FROM users WHERE id=@id AND tenant_id=@tid`);

    if (!check.recordset.length) return res.status(404).json({ error: 'User not found.' });

    const allowed = ['display_name', 'avatar_url', 'preferences'];
    const sets = [];
    const request = pool.request().input('id', sql.UniqueIdentifier, req.params.id);

    for (const [k, v] of Object.entries(req.body)) {
      if (allowed.includes(k)) {
        sets.push(`${k}=@${k}`);
        request.input(k, sql.NVarChar, typeof v === 'object' ? JSON.stringify(v) : v);
      }
    }

    if (sets.length) {
      sets.push(`updated_at=GETUTCDATE()`);
      await request.query(`UPDATE users SET ${sets.join(',')} WHERE id=@id`);
    }

    await logAudit({ tenantId:req.tenantId, userId:req.user.id, userEmail:req.user.email,
      action:'USER_UPDATED', resource:'users', resourceId:req.params.id,
      details:req.body, ip:req.ip, ua:req.headers['user-agent'], severity:'info' });

    return res.json({ message: 'User updated.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update user.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   PATCH /api/users/:id/role
   ══════════════════════════════════════════════════════════════════ */
router.patch('/:id/role', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const { role } = req.body;
    const validRoles = ['tenant_admin', 'operator', 'viewer'];
    if (req.user.role === 'super_admin') validRoles.push('super_admin');
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `Invalid role.` });
    }

    /* prevent demoting yourself */
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot change your own role.' });
    }

    const pool = await getPool();
    await pool.request()
      .input('uid',  sql.UniqueIdentifier, req.params.id)
      .input('tid',  sql.UniqueIdentifier, req.tenantId)
      .input('role', sql.NVarChar,         role)
      .query(`UPDATE user_roles SET role=@role WHERE user_id=@uid AND tenant_id=@tid`);

    await logAudit({ tenantId:req.tenantId, userId:req.user.id, userEmail:req.user.email,
      action:'ROLE_CHANGED', resource:'users', resourceId:req.params.id,
      details:{ newRole: role }, ip:req.ip, ua:req.headers['user-agent'], severity:'warning' });

    return res.json({ message: 'Role updated.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update role.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   PATCH /api/users/:id/toggle-active
   ══════════════════════════════════════════════════════════════════ */
router.patch('/:id/toggle-active', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot disable your own account.' });
    }
    const pool = await getPool();
    await pool.request()
      .input('id',  sql.UniqueIdentifier, req.params.id)
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`UPDATE users SET is_active=CASE WHEN is_active=1 THEN 0 ELSE 1 END,
                               updated_at=GETUTCDATE()
              WHERE id=@id AND tenant_id=@tid`);

    await logAudit({ tenantId:req.tenantId, userId:req.user.id, userEmail:req.user.email,
      action:'USER_TOGGLED', resource:'users', resourceId:req.params.id,
      ip:req.ip, ua:req.headers['user-agent'], severity:'warning' });

    return res.json({ message: 'User active status toggled.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to toggle user.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   PATCH /api/users/:id/unlock
   ══════════════════════════════════════════════════════════════════ */
router.patch('/:id/unlock', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('id',  sql.UniqueIdentifier, req.params.id)
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`UPDATE users
              SET is_locked=0, failed_attempts=0, locked_until=NULL, updated_at=GETUTCDATE()
              WHERE id=@id AND tenant_id=@tid`);

    await logAudit({ tenantId:req.tenantId, userId:req.user.id, userEmail:req.user.email,
      action:'USER_UNLOCKED', resource:'users', resourceId:req.params.id,
      ip:req.ip, ua:req.headers['user-agent'], severity:'warning' });

    return res.json({ message: 'User unlocked.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to unlock user.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   POST /api/users/:id/reset-password   — admin reset to temp password
   ══════════════════════════════════════════════════════════════════ */
router.post('/:id/reset-password', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    const tempPassword = Math.random().toString(36).slice(-10) + '!A1';
    const hash = await bcrypt.hash(tempPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    const pool = await getPool();

    await pool.request()
      .input('id',   sql.UniqueIdentifier, req.params.id)
      .input('tid',  sql.UniqueIdentifier, req.tenantId)
      .input('hash', sql.NVarChar,         hash)
      .query(`UPDATE users SET password_hash=@hash, updated_at=GETUTCDATE()
              WHERE id=@id AND tenant_id=@tid`);

    /* revoke all sessions for that user */
    await pool.request()
      .input('uid', sql.UniqueIdentifier, req.params.id)
      .query(`UPDATE sessions SET is_revoked=1 WHERE user_id=@uid`);

    await logAudit({ tenantId:req.tenantId, userId:req.user.id, userEmail:req.user.email,
      action:'PASSWORD_RESET', resource:'users', resourceId:req.params.id,
      ip:req.ip, ua:req.headers['user-agent'], severity:'critical' });

    return res.json({ message: 'Password reset.', tempPassword });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reset password.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   DELETE /api/users/:id
   ══════════════════════════════════════════════════════════════════ */
router.delete('/:id', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }
    const pool = await getPool();
    await pool.request()
      .input('id',  sql.UniqueIdentifier, req.params.id)
      .input('tid', sql.UniqueIdentifier, req.tenantId)
      .query(`DELETE FROM users WHERE id=@id AND tenant_id=@tid`);

    await logAudit({ tenantId:req.tenantId, userId:req.user.id, userEmail:req.user.email,
      action:'USER_DELETED', resource:'users', resourceId:req.params.id,
      ip:req.ip, ua:req.headers['user-agent'], severity:'critical' });

    return res.json({ message: 'User deleted.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete user.' });
  }
});

module.exports = router;
