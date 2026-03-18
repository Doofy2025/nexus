'use strict';

require('dotenv').config();
const sql    = require('mssql');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const config = {
  server:   process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 1433,
  user:     process.env.DB_USER     || 'sa',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME     || 'vanguard_os',
  options:  { encrypt: process.env.DB_ENCRYPT !== 'false', trustServerCertificate: true },
};

const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;

async function exists(pool, table, col, val, type) {
  const r = await pool.request().input('v', type, val)
    .query(`SELECT 1 AS found FROM ${table} WHERE ${col}=@v`);
  return r.recordset.length > 0;
}

async function seed() {
  console.log('🌱  Seeding Vanguard OS …');
  const pool = await sql.connect(config);

  /* ── Tenant ─────────────────────────────────────── */
  const tenantId = uuidv4();
  if (!(await exists(pool, 'tenants', 'slug', 'vanguard', sql.NVarChar))) {
    await pool.request()
      .input('id',   sql.UniqueIdentifier, tenantId)
      .input('name', sql.NVarChar,         'Vanguard Corp')
      .input('slug', sql.NVarChar,         'vanguard')
      .query(`INSERT INTO tenants (id,name,slug) VALUES (@id,@name,@slug)`);
    console.log('  ✓ tenant: Vanguard Corp');
  }
  const tid = (await pool.request().query(`SELECT id FROM tenants WHERE slug='vanguard'`)).recordset[0].id;

  /* ── Super Admin ─────────────────────────────────── */
  const ADMIN_EMAIL = 'superadmin@vanguardos.io';
  if (!(await exists(pool, 'users', 'email', ADMIN_EMAIL, sql.NVarChar))) {
    const adminId   = uuidv4();
    const adminHash = await bcrypt.hash('changeme', ROUNDS);
    await pool.request()
      .input('id',   sql.UniqueIdentifier, adminId)
      .input('tid',  sql.UniqueIdentifier, tid)
      .input('email',sql.NVarChar,         ADMIN_EMAIL)
      .input('name', sql.NVarChar,         'System Administrator')
      .input('hash', sql.NVarChar,         adminHash)
      .query(`INSERT INTO users (id,tenant_id,email,display_name,password_hash)
              VALUES (@id,@tid,@email,@name,@hash)`);
    const uid = (await pool.request().query(`SELECT id FROM users WHERE email='${ADMIN_EMAIL}'`)).recordset[0].id;
    await pool.request()
      .input('uid', sql.UniqueIdentifier, uid)
      .input('tid', sql.UniqueIdentifier, tid)
      .query(`INSERT INTO user_roles (user_id,tenant_id,role) VALUES (@uid,@tid,'super_admin')`);
    console.log('  ✓ user: superadmin@vanguardos.io (super_admin)');
  }

  /* ── Tenant Admin ────────────────────────────────── */
  const TA_EMAIL = 'admin@vanguardos.io';
  if (!(await exists(pool, 'users', 'email', TA_EMAIL, sql.NVarChar))) {
    const taId   = uuidv4();
    const taHash = await bcrypt.hash('changeme', ROUNDS);
    await pool.request()
      .input('id',   sql.UniqueIdentifier, taId)
      .input('tid',  sql.UniqueIdentifier, tid)
      .input('email',sql.NVarChar,         TA_EMAIL)
      .input('name', sql.NVarChar,         'Tenant Administrator')
      .input('hash', sql.NVarChar,         taHash)
      .query(`INSERT INTO users (id,tenant_id,email,display_name,password_hash)
              VALUES (@id,@tid,@email,@name,@hash)`);
    const uid = (await pool.request().query(`SELECT id FROM users WHERE email='${TA_EMAIL}'`)).recordset[0].id;
    await pool.request()
      .input('uid', sql.UniqueIdentifier, uid)
      .input('tid', sql.UniqueIdentifier, tid)
      .query(`INSERT INTO user_roles (user_id,tenant_id,role) VALUES (@uid,@tid,'tenant_admin')`);
    console.log('  ✓ user: admin@vanguardos.io (tenant_admin)');
  }

  /* ── Operator ────────────────────────────────────── */
  const OP_EMAIL = 'operator@vanguardos.io';
  if (!(await exists(pool, 'users', 'email', OP_EMAIL, sql.NVarChar))) {
    const opId   = uuidv4();
    const opHash = await bcrypt.hash('changeme', ROUNDS);
    await pool.request()
      .input('id',   sql.UniqueIdentifier, opId)
      .input('tid',  sql.UniqueIdentifier, tid)
      .input('email',sql.NVarChar,         OP_EMAIL)
      .input('name', sql.NVarChar,         'Demo Operator')
      .input('hash', sql.NVarChar,         opHash)
      .query(`INSERT INTO users (id,tenant_id,email,display_name,password_hash)
              VALUES (@id,@tid,@email,@name,@hash)`);
    const uid = (await pool.request().query(`SELECT id FROM users WHERE email='${OP_EMAIL}'`)).recordset[0].id;
    await pool.request()
      .input('uid', sql.UniqueIdentifier, uid)
      .input('tid', sql.UniqueIdentifier, tid)
      .query(`INSERT INTO user_roles (user_id,tenant_id,role) VALUES (@uid,@tid,'operator')`);
    console.log('  ✓ user: operator@vanguardos.io (operator)');
  }

  /* ── Viewer ─────────────────────────────────────── */
  const VI_EMAIL = 'viewer@vanguardos.io';
  if (!(await exists(pool, 'users', 'email', VI_EMAIL, sql.NVarChar))) {
    const viId   = uuidv4();
    const viHash = await bcrypt.hash('changeme', ROUNDS);
    await pool.request()
      .input('id',   sql.UniqueIdentifier, viId)
      .input('tid',  sql.UniqueIdentifier, tid)
      .input('email',sql.NVarChar,         VI_EMAIL)
      .input('name', sql.NVarChar,         'Demo Viewer')
      .input('hash', sql.NVarChar,         viHash)
      .query(`INSERT INTO users (id,tenant_id,email,display_name,password_hash)
              VALUES (@id,@tid,@email,@name,@hash)`);
    const uid = (await pool.request().query(`SELECT id FROM users WHERE email='${VI_EMAIL}'`)).recordset[0].id;
    await pool.request()
      .input('uid', sql.UniqueIdentifier, uid)
      .input('tid', sql.UniqueIdentifier, tid)
      .query(`INSERT INTO user_roles (user_id,tenant_id,role) VALUES (@uid,@tid,'viewer')`);
    console.log('  ✓ user: viewer@vanguardos.io (viewer)');
  }

  /* ── Default Sites ──────────────────────────────── */
  const sites = [
    { name:'Austin Datacenter',      code:'ADC',       type:'datacenter', provider:null,    location:'Austin, TX',     lat:30.2672, lng:-97.7431 },
    { name:'San Angelo Datacenter',  code:'SDC',       type:'datacenter', provider:null,    location:'San Angelo, TX', lat:31.4638, lng:-100.4370 },
    { name:'LDC Annex',              code:'LDC-ANNEX', type:'datacenter', provider:null,    location:'Austin, TX',     lat:30.2730, lng:-97.7401 },
    { name:'LDC Mopac',              code:'LDC-MOPAC', type:'datacenter', provider:null,    location:'Austin, TX',     lat:30.3070, lng:-97.7401 },
    { name:'Amazon Web Services',    code:'AWS',       type:'cloud',      provider:'AWS',   location:'us-east-1',      lat:null,    lng:null },
    { name:'Microsoft Azure',        code:'AZURE',     type:'cloud',      provider:'Azure', location:'eastus',         lat:null,    lng:null },
    { name:'Google Cloud Platform',  code:'GCP',       type:'cloud',      provider:'GCP',   location:'us-central1',    lat:null,    lng:null },
  ];

  for (const s of sites) {
    const check = await pool.request()
      .input('tid',  sql.UniqueIdentifier, tid)
      .input('code', sql.NVarChar,         s.code)
      .query(`SELECT 1 FROM sites WHERE tenant_id=@tid AND code=@code`);
    if (!check.recordset.length) {
      await pool.request()
        .input('tid',      sql.UniqueIdentifier, tid)
        .input('name',     sql.NVarChar,         s.name)
        .input('code',     sql.NVarChar,         s.code)
        .input('type',     sql.NVarChar,         s.type)
        .input('provider', sql.NVarChar,         s.provider)
        .input('location', sql.NVarChar,         s.location)
        .input('lat',      sql.Float,            s.lat)
        .input('lng',      sql.Float,            s.lng)
        .query(`INSERT INTO sites (tenant_id,name,code,type,provider,location,latitude,longitude)
                VALUES (@tid,@name,@code,@type,@provider,@location,@lat,@lng)`);
      console.log(`  ✓ site: ${s.name}`);
    }
  }

  /* ── Default Notification Channel ───────────────── */
  const nc = await pool.request().input('tid', sql.UniqueIdentifier, tid)
    .query(`SELECT 1 FROM notification_channels WHERE tenant_id=@tid AND name='Default Email'`);
  if (!nc.recordset.length) {
    await pool.request()
      .input('tid',    sql.UniqueIdentifier, tid)
      .input('config', sql.NVarChar, JSON.stringify({ to: 'ops@vanguardos.io' }))
      .query(`INSERT INTO notification_channels (tenant_id,name,type,config)
              VALUES (@tid,'Default Email','email',@config)`);
    console.log('  ✓ notification_channel: Default Email');
  }

  /* ── Default Alert Rules ─────────────────────────── */
  const adminId2 = (await pool.request().query(`SELECT id FROM users WHERE email='${ADMIN_EMAIL}'`)).recordset[0].id;
  const rules = [
    { name:'High CPU',           metric:'cpu_pct',  cond:'gt', thresh:90,  sev:'high',     dur:300 },
    { name:'Low Disk Space',     metric:'disk_pct', cond:'gt', thresh:85,  sev:'critical', dur:60  },
    { name:'High Memory',        metric:'mem_pct',  cond:'gt', thresh:95,  sev:'high',     dur:120 },
    { name:'Agent Not Reporting',metric:null,       cond:'absent', thresh:null, sev:'critical', dur:900 },
  ];

  for (const r of rules) {
    const rcheck = await pool.request()
      .input('tid', sql.UniqueIdentifier, tid)
      .input('name',sql.NVarChar,         r.name)
      .query(`SELECT 1 FROM alert_rules WHERE tenant_id=@tid AND name=@name`);
    if (!rcheck.recordset.length) {
      await pool.request()
        .input('tid',    sql.UniqueIdentifier, tid)
        .input('name',   sql.NVarChar,         r.name)
        .input('metric', sql.NVarChar,         r.metric)
        .input('cond',   sql.NVarChar,         r.cond)
        .input('thresh', sql.Float,            r.thresh)
        .input('sev',    sql.NVarChar,         r.sev)
        .input('dur',    sql.Int,              r.dur)
        .input('uid',    sql.UniqueIdentifier, adminId2)
        .query(`INSERT INTO alert_rules (tenant_id,name,metric_name,condition,threshold,severity,duration_secs,created_by)
                VALUES (@tid,@name,@metric,@cond,@thresh,@sev,@dur,@uid)`);
      console.log(`  ✓ alert_rule: ${r.name}`);
    }
  }

  console.log(`
✅  Seed complete!

   Credentials (all passwords: changeme — CHANGE IMMEDIATELY):
   ┌────────────────────────────────┬──────────────┐
   │ Email                          │ Role         │
   ├────────────────────────────────┼──────────────┤
   │ superadmin@vanguardos.io       │ super_admin  │
   │ admin@vanguardos.io            │ tenant_admin │
   │ operator@vanguardos.io         │ operator     │
   │ viewer@vanguardos.io           │ viewer       │
   └────────────────────────────────┴──────────────┘
`);
  await pool.close();
}

seed().catch(err => { console.error('❌  Seed failed:', err); process.exit(1); });
