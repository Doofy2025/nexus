'use strict';

const { getPool, sql } = require('../db/pool');
const logger = require('./logger');

/**
 * Write an immutable audit record.
 * Never throws — audit must not crash the request pipeline.
 */
async function logAudit({
  tenantId   = null,
  userId     = null,
  userEmail  = null,
  action,
  resource,
  resourceId = null,
  details    = null,
  ip         = null,
  ua         = null,
  severity   = 'info',   // info | warning | critical
}) {
  try {
    const pool = await getPool();
    const detailStr = details
      ? (typeof details === 'string' ? details : JSON.stringify(details))
      : null;

    await pool.request()
      .input('tenant_id',  sql.UniqueIdentifier, tenantId  || null)
      .input('user_id',    sql.UniqueIdentifier, userId    || null)
      .input('user_email', sql.NVarChar,         userEmail || null)
      .input('action',     sql.NVarChar,         action)
      .input('resource',   sql.NVarChar,         resource)
      .input('resource_id',sql.NVarChar,         resourceId || null)
      .input('details',    sql.NVarChar,         detailStr)
      .input('ip',         sql.NVarChar,         ip  ? String(ip).slice(0, 45)  : null)
      .input('ua',         sql.NVarChar,         ua  ? String(ua).slice(0, 500) : null)
      .input('severity',   sql.NVarChar,         severity)
      .query(`
        INSERT INTO audit_log
          (tenant_id, user_id, user_email, action, resource, resource_id,
           details, ip_address, user_agent, severity)
        VALUES
          (@tenant_id, @user_id, @user_email, @action, @resource, @resource_id,
           @details, @ip, @ua, @severity)
      `);
  } catch (err) {
    logger.error('audit_log write failed', { err: err.message });
  }
}

module.exports = { logAudit };
