'use strict';

require('dotenv').config();
const sql    = require('mssql');
const logger = require('../utils/logger');

const config = {
  server:  process.env.DB_HOST || 'localhost',
  port:    parseInt(process.env.DB_PORT)  || 1433,
  user:    process.env.DB_USER            || 'sa',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME          || 'vanguard_os',
  options: {
    encrypt:              process.env.DB_ENCRYPT    !== 'false',
    trustServerCertificate: process.env.DB_TRUST_CERT !== 'false',
    enableArithAbort:     true,
  },
  pool: {
    max:               parseInt(process.env.DB_POOL_MAX)  || 20,
    min:               parseInt(process.env.DB_POOL_MIN)  || 2,
    idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE) || 30000,
  },
  connectionTimeout: 30000,
  requestTimeout:    30000,
};

let _pool = null;

async function getPool() {
  if (_pool && _pool.connected) return _pool;
  _pool = await sql.connect(config);
  _pool.on('error', (err) => {
    logger.error('SQL pool error', { err: err.message });
    _pool = null;
  });
  return _pool;
}

async function closePool() {
  if (_pool) { await _pool.close(); _pool = null; }
}

module.exports = { getPool, closePool, sql };
