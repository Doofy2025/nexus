'use strict';

const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getPool, sql } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { logAudit }     = require('../utils/audit');
const logger           = require('../utils/logger');

/* ══════════════════════════════════════════════════════════════════
   POST /api/auth/login
   ══════════════════════════════════════════════════════════════════ */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const pool   = await getPool();
    const result = await pool.request()
      .input('email', sql.NVarChar, email.toLowerCase().trim())
      .query(`
        SELECT
          u.id, u.tenant_id, u.email, u.display_name, u.password_hash,
          u.is_active, u.is_locked, u.failed_attempts, u.locked_until,
          u.mfa_enabled, u.avatar_url,
          ur.role,
          t.max_failed_attempts, t.lockout_duration_minutes, t.session_timeout_minutes,
          t.is_active AS tenant_active
        FROM users u
        JOIN user_roles ur ON u.id = ur.user_id
        JOIN tenants t     ON u.tenant_id = t.id
        WHERE u.email = @email
      `);

    /* unknown user — generic error to prevent email enumeration */
    if (!result.recordset.length || !result.recordset[0].tenant_active) {
      await logAudit({ tenantId:null, userEmail:email, action:'LOGIN_FAILED',
        resource:'auth', details:'Unknown user or inactive tenant',
        ip:req.ip, ua:req.headers['user-agent'], severity:'warning' });
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = result.recordset[0];

    /* lockout check */
    if (user.is_locked) {
      if (user.locked_until && new Date(user.locked_until) < new Date()) {
        /* lockout window expired — auto-unlock */
        await pool.request().input('id', sql.UniqueIdentifier, user.id)
          .query(`UPDATE users SET is_locked=0, failed_attempts=0, locked_until=NULL WHERE id=@id`);
      } else {
        await logAudit({ tenantId:user.tenant_id, userId:user.id, userEmail:email,
          action:'LOGIN_BLOCKED', resource:'auth', details:'Locked account',
          ip:req.ip, ua:req.headers['user-agent'], severity:'critical' });
        return res.status(403).json({ error: 'Account is locked. Contact your administrator.' });
      }
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is disabled.' });
    }

    /* password check */
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      const attempts    = (user.failed_attempts || 0) + 1;
      const max         = user.max_failed_attempts || 5;
      const shouldLock  = attempts >= max;
      const lockedUntil = shouldLock
        ? new Date(Date.now() + (user.lockout_duration_minutes || 15) * 60_000)
        : null;

      await pool.request()
        .input('id',           sql.UniqueIdentifier, user.id)
        .input('attempts',     sql.Int,              attempts)
        .input('locked',       sql.Bit,              shouldLock ? 1 : 0)
        .input('locked_until', sql.DateTime2,        lockedUntil)
        .query(`UPDATE users SET failed_attempts=@attempts, is_locked=@locked, locked_until=@locked_until WHERE id=@id`);

      await logAudit({ tenantId:user.tenant_id, userId:user.id, userEmail:email,
        action:'LOGIN_FAILED', resource:'auth',
        details:`Attempt ${attempts}/${max}${shouldLock ? ' — LOCKED' : ''}`,
        ip:req.ip, ua:req.headers['user-agent'],
        severity: shouldLock ? 'critical' : 'warning' });

      if (shouldLock) {
        return res.status(403).json({ error: `Account locked after ${max} failed attempts.` });
      }
      return res.status(401).json({
        error: `Invalid email or password. ${max - attempts} attempt(s) remaining.`,
      });
    }

    /* ✅ Successful login */
    const timeout = user.session_timeout_minutes || 30;

    await pool.request().input('id', sql.UniqueIdentifier, user.id)
      .query(`UPDATE users SET failed_attempts=0, is_locked=0, locked_until=NULL,
                               last_login=GETUTCDATE(), updated_at=GETUTCDATE()
              WHERE id=@id`);

    const token     = jwt.sign(
      { userId: user.id, tenantId: user.tenant_id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: `${timeout}m` }
    );
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + timeout * 60_000);

    await pool.request()
      .input('user_id',    sql.UniqueIdentifier, user.id)
      .input('token_hash', sql.NVarChar,         tokenHash)
      .input('ip',         sql.NVarChar,         String(req.ip).slice(0, 45))
      .input('ua',         sql.NVarChar,         String(req.headers['user-agent'] || '').slice(0, 500))
      .input('expires_at', sql.DateTime2,        expiresAt)
      .query(`INSERT INTO sessions (user_id,token_hash,ip_address,user_agent,expires_at)
              VALUES (@user_id,@token_hash,@ip,@ua,@expires_at)`);

    await logAudit({ tenantId:user.tenant_id, userId:user.id, userEmail:email,
      action:'LOGIN', resource:'auth', details:'Successful login',
      ip:req.ip, ua:req.headers['user-agent'], severity:'info' });

    return res.json({
      token,
      expiresIn: timeout * 60,
      user: {
        id:          user.id,
        email:       user.email,
        displayName: user.display_name,
        role:        user.role,
        tenantId:    user.tenant_id,
        mfaEnabled:  !!user.mfa_enabled,
        avatarUrl:   user.avatar_url || null,
      },
    });
  } catch (err) {
    logger.error('Login error', { err: err.message });
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   POST /api/auth/register
   ══════════════════════════════════════════════════════════════════ */
router.post('/register', async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    if (!email || !password || !displayName) {
      return res.status(400).json({ error: 'Email, password and display name are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const pool   = await getPool();
    const tenant = await pool.request()
      .query(`SELECT TOP 1 id FROM tenants WHERE registration_enabled=1 AND is_active=1`);

    if (!tenant.recordset.length) {
      return res.status(403).json({ error: 'Self-registration is currently disabled.' });
    }
    const tenantId = tenant.recordset[0].id;

    const existing = await pool.request()
      .input('email', sql.NVarChar, email.toLowerCase().trim())
      .query(`SELECT 1 FROM users WHERE email=@email`);

    if (existing.recordset.length) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const hash   = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    const userId = uuidv4();

    await pool.request()
      .input('id',    sql.UniqueIdentifier, userId)
      .input('tid',   sql.UniqueIdentifier, tenantId)
      .input('email', sql.NVarChar,         email.toLowerCase().trim())
      .input('name',  sql.NVarChar,         displayName.trim())
      .input('hash',  sql.NVarChar,         hash)
      .query(`INSERT INTO users (id,tenant_id,email,display_name,password_hash)
              VALUES (@id,@tid,@email,@name,@hash)`);

    await pool.request()
      .input('uid',  sql.UniqueIdentifier, userId)
      .input('tid',  sql.UniqueIdentifier, tenantId)
      .query(`INSERT INTO user_roles (user_id,tenant_id,role) VALUES (@uid,@tid,'viewer')`);

    await logAudit({ tenantId, userId, userEmail:email,
      action:'USER_REGISTERED', resource:'users', resourceId:userId,
      details:'Self-registration', ip:req.ip, ua:req.headers['user-agent'], severity:'info' });

    return res.status(201).json({ message: 'Account created. You can now log in.' });
  } catch (err) {
    logger.error('Register error', { err: err.message });
    return res.status(500).json({ error: 'Registration failed.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   POST /api/auth/logout
   ══════════════════════════════════════════════════════════════════ */
router.post('/logout', authenticate, async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('user_id', sql.UniqueIdentifier, req.user.id)
      .query(`UPDATE sessions SET is_revoked=1 WHERE user_id=@user_id AND is_revoked=0`);

    await logAudit({ tenantId:req.tenantId, userId:req.user.id, userEmail:req.user.email,
      action:'LOGOUT', resource:'auth', ip:req.ip, ua:req.headers['user-agent'], severity:'info' });

    return res.json({ message: 'Logged out successfully.' });
  } catch (err) {
    return res.status(500).json({ error: 'Logout failed.' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/auth/me
   ══════════════════════════════════════════════════════════════════ */
router.get('/me', authenticate, (req, res) => {
  const u = req.user;
  return res.json({
    id:          u.id,
    email:       u.email,
    displayName: u.display_name,
    role:        u.role,
    tenantId:    u.tenant_id,
    mfaEnabled:  !!u.mfa_enabled,
    avatarUrl:   u.avatar_url || null,
  });
});

/* ══════════════════════════════════════════════════════════════════
   POST /api/auth/change-password
   ══════════════════════════════════════════════════════════════════ */
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }

    const pool   = await getPool();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, req.user.id)
      .query(`SELECT password_hash FROM users WHERE id=@id`);

    const valid = await bcrypt.compare(currentPassword, result.recordset[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

    const newHash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    await pool.request()
      .input('id',   sql.UniqueIdentifier, req.user.id)
      .input('hash', sql.NVarChar,         newHash)
      .query(`UPDATE users SET password_hash=@hash, updated_at=GETUTCDATE() WHERE id=@id`);

    /* revoke all existing sessions — force re-login */
    await pool.request()
      .input('user_id', sql.UniqueIdentifier, req.user.id)
      .query(`UPDATE sessions SET is_revoked=1 WHERE user_id=@user_id`);

    await logAudit({ tenantId:req.tenantId, userId:req.user.id, userEmail:req.user.email,
      action:'PASSWORD_CHANGED', resource:'users', resourceId:req.user.id,
      ip:req.ip, ua:req.headers['user-agent'], severity:'warning' });

    return res.json({ message: 'Password changed. Please log in again.' });
  } catch (err) {
    logger.error('Change password error', { err: err.message });
    return res.status(500).json({ error: 'Password change failed.' });
  }
});

module.exports = router;
