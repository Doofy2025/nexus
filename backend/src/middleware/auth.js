'use strict';

const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const { getPool, sql } = require('../db/pool');
const logger = require('../utils/logger');

/* ─── JWT user authentication ──────────────────────────────────────────────── */
async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const pool    = await getPool();

    /* verify session is not revoked */
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const sess = await pool.request()
      .input('user_id',    sql.UniqueIdentifier, decoded.userId)
      .input('token_hash', sql.NVarChar,         tokenHash)
      .query(`SELECT 1 AS ok FROM sessions
              WHERE user_id=@user_id AND token_hash=@token_hash
                AND is_revoked=0 AND expires_at > GETUTCDATE()`);

    if (!sess.recordset.length) {
      return res.status(401).json({ error: 'Session expired or revoked. Please log in again.' });
    }

    /* load user + role */
    const user = await pool.request()
      .input('id', sql.UniqueIdentifier, decoded.userId)
      .query(`SELECT u.id, u.tenant_id, u.email, u.display_name,
                     u.is_active, u.is_locked, u.mfa_enabled, u.avatar_url,
                     ur.role
              FROM users u
              JOIN user_roles ur ON u.id = ur.user_id
              WHERE u.id=@id AND u.is_active=1 AND u.is_locked=0`);

    if (!user.recordset.length) {
      return res.status(401).json({ error: 'Account disabled or locked.' });
    }

    req.user     = user.recordset[0];
    req.tenantId = user.recordset[0].tenant_id;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired. Please log in again.' });
    }
    logger.warn('JWT verify failed', { err: err.message });
    return res.status(401).json({ error: 'Invalid token.' });
  }
}

/* ─── Agent token authentication ──────────────────────────────────────────── */
async function authenticateAgent(req, res, next) {
  const rawToken = req.headers['x-agent-token'];
  if (!rawToken) return res.status(401).json({ error: 'Agent token required.' });

  try {
    const pool      = await getPool();
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const result = await pool.request()
      .input('hash', sql.NVarChar, tokenHash)
      .query(`SELECT at.id, at.tenant_id, at.asset_id, t.is_active AS tenant_active
              FROM agent_tokens at
              JOIN tenants t ON at.tenant_id = t.id
              WHERE at.token_hash=@hash AND at.is_revoked=0
                AND (at.expires_at IS NULL OR at.expires_at > GETUTCDATE())`);

    if (!result.recordset.length) {
      return res.status(401).json({ error: 'Invalid or expired agent token.' });
    }
    if (!result.recordset[0].tenant_active) {
      return res.status(403).json({ error: 'Tenant is disabled.' });
    }

    /* bump last_used async */
    pool.request().input('hash', sql.NVarChar, tokenHash)
      .query(`UPDATE agent_tokens SET last_used=GETUTCDATE() WHERE token_hash=@hash`)
      .catch(() => {});

    req.agentToken = result.recordset[0];
    req.tenantId   = result.recordset[0].tenant_id;
    next();
  } catch (err) {
    logger.warn('Agent auth failed', { err: err.message });
    return res.status(401).json({ error: 'Agent authentication failed.' });
  }
}

/* ─── RBAC guard ───────────────────────────────────────────────────────────── */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
    if (req.user.role === 'super_admin') return next();          // super_admin passes everything
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${roles.join(' or ')}.`,
      });
    }
    next();
  };
}

/* ─── Tenant scope helper ──────────────────────────────────────────────────── */
/* Allows super_admin to target any tenant via ?tenantId= query param */
function tenantScope(req, res, next) {
  if (req.user?.role === 'super_admin' && req.query.tenantId) {
    req.tenantId = req.query.tenantId;
  }
  next();
}

module.exports = { authenticate, authenticateAgent, requireRole, tenantScope };
