'use strict';

/**
 * Vanguard OS — Metrics Retention Service
 *
 * Runs on a cron schedule and purges time-series rows older than
 * the configured retention window.
 *
 * Defaults (overridable via env):
 *   METRICS_RETENTION_DAYS   = 90   (raw metric rows)
 *   SNAPSHOTS_RETENTION_DAYS = 90   (metric_snapshots)
 *   LOGS_RETENTION_DAYS      = 30   (log_entries)
 *   AUDIT_RETENTION_DAYS     = 365  (audit_log — never below 90)
 */

const cron   = require('node-cron');
const { getPool, sql } = require('../db/pool');
const logger = require('../utils/logger');

const METRICS_DAYS   = Math.max(7,  parseInt(process.env.METRICS_RETENTION_DAYS)   || 90);
const SNAPSHOTS_DAYS = Math.max(7,  parseInt(process.env.SNAPSHOTS_RETENTION_DAYS) || 90);
const LOGS_DAYS      = Math.max(7,  parseInt(process.env.LOGS_RETENTION_DAYS)      || 30);
const AUDIT_DAYS     = Math.max(90, parseInt(process.env.AUDIT_RETENTION_DAYS)     || 365);

async function runRetention() {
  try {
    const pool = await getPool();

    /* raw metrics */
    const m = await pool.request().query(
      `DELETE FROM metrics WHERE ts < DATEADD(day,-${METRICS_DAYS},GETUTCDATE())`
    );
    logger.info(`retention: deleted ${m.rowsAffected[0]} metric rows`);

    /* snapshots */
    const s = await pool.request().query(
      `DELETE FROM metric_snapshots WHERE ts < DATEADD(day,-${SNAPSHOTS_DAYS},GETUTCDATE())`
    );
    logger.info(`retention: deleted ${s.rowsAffected[0]} snapshot rows`);

    /* logs */
    const l = await pool.request().query(
      `DELETE FROM log_entries WHERE ts < DATEADD(day,-${LOGS_DAYS},GETUTCDATE())`
    );
    logger.info(`retention: deleted ${l.rowsAffected[0]} log rows`);

    /* audit */
    const a = await pool.request().query(
      `DELETE FROM audit_log WHERE created_at < DATEADD(day,-${AUDIT_DAYS},GETUTCDATE())`
    );
    logger.info(`retention: deleted ${a.rowsAffected[0]} audit rows`);

  } catch (err) {
    logger.error('retention job failed', { err: err.message });
  }
}

function startRetentionJob() {
  /* Run at 02:00 UTC every day */
  cron.schedule('0 2 * * *', () => {
    logger.info('retention job: starting');
    runRetention();
  });
  logger.info(`retention job scheduled (metrics:${METRICS_DAYS}d snaps:${SNAPSHOTS_DAYS}d logs:${LOGS_DAYS}d audit:${AUDIT_DAYS}d)`);
}

module.exports = { startRetentionJob, runRetention };
