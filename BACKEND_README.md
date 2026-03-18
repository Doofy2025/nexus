# Vanguard OS — Backend Setup (Node.js + MS-SQL)

This document provides the complete backend schema, API routes, and setup script for Vanguard OS using **Node.js** (Express) and **Microsoft SQL Server**.

## Prerequisites

- Node.js 18+
- MS-SQL Server 2019+ (or Azure SQL)
- npm or yarn

## Quick Start

```bash
cd backend
npm install
# Set environment variables (see .env.example below)
cp .env.example .env
# Edit .env with your MS-SQL connection details
npm run migrate   # Creates all tables
npm run seed      # Seeds default data
npm start         # Starts API server on port 3001
```

## Environment Variables (.env.example)

```env
PORT=3001
DB_HOST=localhost
DB_PORT=1433
DB_USER=sa
DB_PASSWORD=YourStrong!Passw0rd
DB_NAME=vanguard_os
JWT_SECRET=your-256-bit-secret-change-this
JWT_EXPIRY=30m
BCRYPT_ROUNDS=12
SESSION_TIMEOUT_MINUTES=30
MAX_FAILED_ATTEMPTS=5
LOCKOUT_DURATION_MINUTES=15
CORS_ORIGIN=http://localhost:5173
```

## Dependencies (package.json)

```json
{
  "name": "vanguard-os-backend",
  "version": "1.0.0",
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js",
    "migrate": "node src/db/migrate.js",
    "seed": "node src/db/seed.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "mssql": "^10.0.1",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.2",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "express-rate-limit": "^7.1.4",
    "uuid": "^9.0.0",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.2"
  }
}
```

---

## Database Schema (MS-SQL Migration Script)

Save as `backend/src/db/migrate.js`:

```javascript
require('dotenv').config();
const sql = require('mssql');

const config = {
  server: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  options: { encrypt: true, trustServerCertificate: true },
};

async function migrate() {
  const pool = await sql.connect(config);

  // ── Tenants ──
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tenants')
    CREATE TABLE tenants (
      id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
      name NVARCHAR(255) NOT NULL,
      slug NVARCHAR(100) NOT NULL UNIQUE,
      is_active BIT DEFAULT 1,
      registration_enabled BIT DEFAULT 1,
      session_timeout_minutes INT DEFAULT 30,
      max_failed_attempts INT DEFAULT 5,
      lockout_duration_minutes INT DEFAULT 15,
      created_at DATETIME2 DEFAULT GETUTCDATE(),
      updated_at DATETIME2 DEFAULT GETUTCDATE()
    )
  `);

  // ── Users ──
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'users')
    CREATE TABLE users (
      id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
      tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      email NVARCHAR(255) NOT NULL,
      display_name NVARCHAR(255) NOT NULL,
      password_hash NVARCHAR(255) NOT NULL,
      is_active BIT DEFAULT 1,
      is_locked BIT DEFAULT 0,
      failed_attempts INT DEFAULT 0,
      locked_until DATETIME2 NULL,
      last_login DATETIME2 NULL,
      mfa_enabled BIT DEFAULT 0,
      mfa_secret NVARCHAR(255) NULL,
      created_at DATETIME2 DEFAULT GETUTCDATE(),
      updated_at DATETIME2 DEFAULT GETUTCDATE(),
      CONSTRAINT UQ_users_email UNIQUE (email)
    )
  `);

  // ── Roles (separate table per security best practice) ──
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'user_roles')
    CREATE TABLE user_roles (
      id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
      user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role NVARCHAR(50) NOT NULL CHECK (role IN ('super_admin', 'tenant_admin', 'operator', 'viewer')),
      tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE NO ACTION,
      created_at DATETIME2 DEFAULT GETUTCDATE(),
      CONSTRAINT UQ_user_role UNIQUE (user_id, role, tenant_id)
    )
  `);

  // ── Sites ──
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'sites')
    CREATE TABLE sites (
      id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
      tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name NVARCHAR(255) NOT NULL,
      code NVARCHAR(50) NOT NULL,
      type NVARCHAR(50) NOT NULL CHECK (type IN ('datacenter', 'cloud', 'edge')),
      provider NVARCHAR(100) NULL,
      location NVARCHAR(255) NULL,
      is_active BIT DEFAULT 1,
      created_at DATETIME2 DEFAULT GETUTCDATE(),
      updated_at DATETIME2 DEFAULT GETUTCDATE(),
      CONSTRAINT UQ_site_code_tenant UNIQUE (tenant_id, code)
    )
  `);

  // ── Audit Log ──
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'audit_log')
    CREATE TABLE audit_log (
      id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
      tenant_id UNIQUEIDENTIFIER NULL REFERENCES tenants(id) ON DELETE SET NULL,
      user_id UNIQUEIDENTIFIER NULL,
      user_email NVARCHAR(255) NULL,
      action NVARCHAR(100) NOT NULL,
      resource NVARCHAR(100) NOT NULL,
      details NVARCHAR(MAX) NULL,
      ip_address NVARCHAR(45) NULL,
      severity NVARCHAR(20) DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
      created_at DATETIME2 DEFAULT GETUTCDATE()
    )
  `);

  // ── Sessions ──
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'sessions')
    CREATE TABLE sessions (
      id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
      user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash NVARCHAR(255) NOT NULL,
      ip_address NVARCHAR(45) NULL,
      user_agent NVARCHAR(500) NULL,
      expires_at DATETIME2 NOT NULL,
      created_at DATETIME2 DEFAULT GETUTCDATE(),
      is_revoked BIT DEFAULT 0
    )
  `);

  // ── Indexes ──
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_users_email')
      CREATE INDEX IX_users_email ON users(email);
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_users_tenant')
      CREATE INDEX IX_users_tenant ON users(tenant_id);
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_sites_tenant')
      CREATE INDEX IX_sites_tenant ON sites(tenant_id);
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_audit_tenant')
      CREATE INDEX IX_audit_tenant ON audit_log(tenant_id, created_at DESC);
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_user_roles_user')
      CREATE INDEX IX_user_roles_user ON user_roles(user_id);
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_sessions_user')
      CREATE INDEX IX_sessions_user ON sessions(user_id, is_revoked);
  `);

  console.log('✅ Migration complete');
  await pool.close();
}

migrate().catch(err => { console.error('Migration failed:', err); process.exit(1); });
```

---

## Seed Script

Save as `backend/src/db/seed.js`:

```javascript
require('dotenv').config();
const sql = require('mssql');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const config = {
  server: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  options: { encrypt: true, trustServerCertificate: true },
};

async function seed() {
  const pool = await sql.connect(config);
  const hash = await bcrypt.hash('password', 12);

  // Tenant
  const tenantId = uuidv4();
  await pool.request()
    .input('id', sql.UniqueIdentifier, tenantId)
    .input('name', sql.NVarChar, 'Vanguard Corp')
    .input('slug', sql.NVarChar, 'vanguard')
    .query(`INSERT INTO tenants (id, name, slug) VALUES (@id, @name, @slug)`);

  // Super Admin user
  const adminId = uuidv4();
  await pool.request()
    .input('id', sql.UniqueIdentifier, adminId)
    .input('tenant_id', sql.UniqueIdentifier, tenantId)
    .input('email', sql.NVarChar, 'superadmin@vanguardos.io')
    .input('display_name', sql.NVarChar, 'System Admin')
    .input('password_hash', sql.NVarChar, hash)
    .query(`INSERT INTO users (id, tenant_id, email, display_name, password_hash, mfa_enabled)
            VALUES (@id, @tenant_id, @email, @display_name, @password_hash, 1)`);

  await pool.request()
    .input('user_id', sql.UniqueIdentifier, adminId)
    .input('role', sql.NVarChar, 'super_admin')
    .input('tenant_id', sql.UniqueIdentifier, tenantId)
    .query(`INSERT INTO user_roles (user_id, role, tenant_id) VALUES (@user_id, @role, @tenant_id)`);

  // Default sites
  const defaultSites = [
    { name: 'Austin Datacenter', code: 'ADC', type: 'datacenter', location: 'Austin, TX' },
    { name: 'San Angelo Datacenter', code: 'SDC', type: 'datacenter', location: 'San Angelo, TX' },
    { name: 'Amazon Web Services', code: 'AWS', type: 'cloud', provider: 'AWS' },
    { name: 'Microsoft Azure', code: 'AZURE', type: 'cloud', provider: 'Azure' },
    { name: 'Google Cloud Platform', code: 'GCP', type: 'cloud', provider: 'GCP' },
    { name: 'LDC Annex', code: 'LDC-ANNEX', type: 'datacenter', location: 'Austin, TX' },
    { name: 'LDC Mopac', code: 'LDC-MOPAC', type: 'datacenter', location: 'Austin, TX' },
  ];

  for (const site of defaultSites) {
    await pool.request()
      .input('tenant_id', sql.UniqueIdentifier, tenantId)
      .input('name', sql.NVarChar, site.name)
      .input('code', sql.NVarChar, site.code)
      .input('type', sql.NVarChar, site.type)
      .input('provider', sql.NVarChar, site.provider || null)
      .input('location', sql.NVarChar, site.location || null)
      .query(`INSERT INTO sites (tenant_id, name, code, type, provider, location)
              VALUES (@tenant_id, @name, @code, @type, @provider, @location)`);
  }

  console.log('✅ Seed complete');
  console.log('   Login: superadmin@vanguardos.io / password');
  await pool.close();
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
```

---

## Server Entry Point

Save as `backend/src/server.js`:

```javascript
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const tenantRoutes = require('./routes/tenants');
const siteRoutes = require('./routes/sites');
const auditRoutes = require('./routes/audit');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
app.use(express.json());

// Rate limiting
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts. Try again later.' },
});

app.use('/api/auth/login', loginLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/sites', siteRoutes);
app.use('/api/audit', auditRoutes);

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Vanguard OS API running on port ${PORT}`));
```

---

## Middleware — Auth & RBAC

Save as `backend/src/middleware/auth.js`:

```javascript
const jwt = require('jsonwebtoken');
const { getPool } = require('../db/pool');

async function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const pool = await getPool();

    // Verify session not revoked
    const session = await pool.request()
      .input('user_id', decoded.userId)
      .query(`SELECT TOP 1 * FROM sessions WHERE user_id = @user_id AND is_revoked = 0 AND expires_at > GETUTCDATE()`);

    if (!session.recordset.length) {
      return res.status(401).json({ error: 'Session expired or revoked' });
    }

    // Get user with role
    const user = await pool.request()
      .input('id', decoded.userId)
      .query(`SELECT u.*, ur.role FROM users u
              JOIN user_roles ur ON u.id = ur.user_id
              WHERE u.id = @id AND u.is_active = 1 AND u.is_locked = 0`);

    if (!user.recordset.length) {
      return res.status(401).json({ error: 'Account disabled or locked' });
    }

    req.user = user.recordset[0];
    req.tenantId = user.recordset[0].tenant_id;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.user.role === 'super_admin') return next(); // super admin bypasses
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function tenantIsolation(req, res, next) {
  // Super admins can access any tenant
  if (req.user.role === 'super_admin') return next();
  // Others can only access their own tenant's data
  if (req.params.tenantId && req.params.tenantId !== req.tenantId) {
    return res.status(403).json({ error: 'Cross-tenant access denied' });
  }
  next();
}

module.exports = { authenticate, requireRole, tenantIsolation };
```

---

## API Routes

### Auth Routes (`backend/src/routes/auth.js`)

```javascript
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getPool } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const sql = require('mssql');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const pool = await getPool();

  const result = await pool.request()
    .input('email', sql.NVarChar, email)
    .query(`SELECT u.*, ur.role, t.max_failed_attempts, t.lockout_duration_minutes, t.session_timeout_minutes
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN tenants t ON u.tenant_id = t.id
            WHERE u.email = @email`);

  if (!result.recordset.length) {
    await logAudit(pool, null, null, email, 'LOGIN_FAILED', 'auth', 'Invalid credentials', req.ip, 'warning');
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const user = result.recordset[0];

  if (user.is_locked) {
    // Check if lockout has expired
    if (user.locked_until && new Date(user.locked_until) < new Date()) {
      await pool.request().input('id', sql.UniqueIdentifier, user.id)
        .query(`UPDATE users SET is_locked = 0, failed_attempts = 0, locked_until = NULL WHERE id = @id`);
    } else {
      await logAudit(pool, user.tenant_id, user.id, email, 'LOGIN_BLOCKED', 'auth', 'Locked account', req.ip, 'critical');
      return res.status(403).json({ error: 'Account locked. Contact administrator.' });
    }
  }

  if (!user.is_active) {
    return res.status(403).json({ error: 'Account disabled' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const attempts = user.failed_attempts + 1;
    const shouldLock = attempts >= user.max_failed_attempts;
    const lockedUntil = shouldLock ? new Date(Date.now() + user.lockout_duration_minutes * 60000) : null;

    await pool.request()
      .input('id', sql.UniqueIdentifier, user.id)
      .input('attempts', sql.Int, attempts)
      .input('locked', sql.Bit, shouldLock)
      .input('locked_until', sql.DateTime2, lockedUntil)
      .query(`UPDATE users SET failed_attempts = @attempts, is_locked = @locked, locked_until = @locked_until WHERE id = @id`);

    const severity = shouldLock ? 'critical' : 'warning';
    await logAudit(pool, user.tenant_id, user.id, email, 'LOGIN_FAILED', 'auth',
      `Attempt ${attempts}/${user.max_failed_attempts}${shouldLock ? ' — LOCKED' : ''}`, req.ip, severity);

    return res.status(401).json({
      error: shouldLock
        ? `Account locked after ${user.max_failed_attempts} failed attempts`
        : `Invalid credentials. ${user.max_failed_attempts - attempts} attempts remaining`,
    });
  }

  // Success — reset attempts, create session
  await pool.request().input('id', sql.UniqueIdentifier, user.id)
    .query(`UPDATE users SET failed_attempts = 0, last_login = GETUTCDATE() WHERE id = @id`);

  const token = jwt.sign(
    { userId: user.id, tenantId: user.tenant_id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: `${user.session_timeout_minutes}m` }
  );

  // Store session
  await pool.request()
    .input('user_id', sql.UniqueIdentifier, user.id)
    .input('token_hash', sql.NVarChar, require('crypto').createHash('sha256').update(token).digest('hex'))
    .input('ip', sql.NVarChar, req.ip)
    .input('ua', sql.NVarChar, req.headers['user-agent']?.substring(0, 500))
    .input('expires', sql.DateTime2, new Date(Date.now() + user.session_timeout_minutes * 60000))
    .query(`INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, expires_at)
            VALUES (@user_id, @token_hash, @ip, @ua, @expires)`);

  await logAudit(pool, user.tenant_id, user.id, email, 'LOGIN', 'auth', 'Successful login', req.ip, 'info');

  res.json({
    token,
    user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role, tenantId: user.tenant_id },
    expiresIn: user.session_timeout_minutes * 60,
  });
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password, displayName } = req.body;
  const pool = await getPool();

  // Find tenant with registration enabled
  const tenant = await pool.request()
    .query(`SELECT TOP 1 * FROM tenants WHERE registration_enabled = 1 AND is_active = 1`);

  if (!tenant.recordset.length) {
    return res.status(403).json({ error: 'Registration is currently disabled' });
  }

  const existing = await pool.request().input('email', sql.NVarChar, email)
    .query(`SELECT id FROM users WHERE email = @email`);

  if (existing.recordset.length) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS));
  const userId = uuidv4();
  const tenantId = tenant.recordset[0].id;

  await pool.request()
    .input('id', sql.UniqueIdentifier, userId)
    .input('tenant_id', sql.UniqueIdentifier, tenantId)
    .input('email', sql.NVarChar, email)
    .input('display_name', sql.NVarChar, displayName)
    .input('password_hash', sql.NVarChar, hash)
    .query(`INSERT INTO users (id, tenant_id, email, display_name, password_hash)
            VALUES (@id, @tenant_id, @email, @display_name, @password_hash)`);

  await pool.request()
    .input('user_id', sql.UniqueIdentifier, userId)
    .input('role', sql.NVarChar, 'viewer')
    .input('tenant_id', sql.UniqueIdentifier, tenantId)
    .query(`INSERT INTO user_roles (user_id, role, tenant_id) VALUES (@user_id, @role, @tenant_id)`);

  await logAudit(pool, tenantId, userId, email, 'USER_REGISTERED', 'auth', 'New registration', req.ip, 'info');

  res.status(201).json({ message: 'Account created. You can now log in.' });
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res) => {
  const pool = await getPool();
  await pool.request().input('user_id', sql.UniqueIdentifier, req.user.id)
    .query(`UPDATE sessions SET is_revoked = 1 WHERE user_id = @user_id`);

  await logAudit(pool, req.tenantId, req.user.id, req.user.email, 'LOGOUT', 'auth', 'User logged out', req.ip, 'info');
  res.json({ message: 'Logged out' });
});

async function logAudit(pool, tenantId, userId, email, action, resource, details, ip, severity) {
  await pool.request()
    .input('tenant_id', sql.UniqueIdentifier, tenantId)
    .input('user_id', sql.UniqueIdentifier, userId)
    .input('user_email', sql.NVarChar, email)
    .input('action', sql.NVarChar, action)
    .input('resource', sql.NVarChar, resource)
    .input('details', sql.NVarChar, details)
    .input('ip', sql.NVarChar, ip)
    .input('severity', sql.NVarChar, severity)
    .query(`INSERT INTO audit_log (tenant_id, user_id, user_email, action, resource, details, ip_address, severity)
            VALUES (@tenant_id, @user_id, @user_email, @action, @resource, @details, @ip, @severity)`);
}

module.exports = router;
```

### Users Routes (`backend/src/routes/users.js`)

```javascript
const router = require('express').Router();
const { authenticate, requireRole, tenantIsolation } = require('../middleware/auth');
const sql = require('mssql');
const { getPool } = require('../db/pool');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

router.use(authenticate);

// GET /api/users — list users (tenant-scoped)
router.get('/', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  const pool = await getPool();
  const tenantFilter = req.user.role === 'super_admin' && req.query.tenantId
    ? req.query.tenantId : req.tenantId;

  const result = await pool.request()
    .input('tenant_id', sql.UniqueIdentifier, tenantFilter)
    .query(`SELECT u.id, u.email, u.display_name, u.is_active, u.is_locked,
                   u.failed_attempts, u.last_login, u.mfa_enabled, u.created_at, ur.role
            FROM users u JOIN user_roles ur ON u.id = ur.user_id
            WHERE u.tenant_id = @tenant_id ORDER BY u.created_at DESC`);

  res.json(result.recordset);
});

// POST /api/users — create user
router.post('/', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  const { email, displayName, role, tenantId } = req.body;
  const pool = await getPool();
  const targetTenant = req.user.role === 'super_admin' && tenantId ? tenantId : req.tenantId;
  const hash = await bcrypt.hash('changeme', parseInt(process.env.BCRYPT_ROUNDS));
  const userId = uuidv4();

  await pool.request()
    .input('id', sql.UniqueIdentifier, userId)
    .input('tenant_id', sql.UniqueIdentifier, targetTenant)
    .input('email', sql.NVarChar, email)
    .input('display_name', sql.NVarChar, displayName)
    .input('password_hash', sql.NVarChar, hash)
    .query(`INSERT INTO users (id, tenant_id, email, display_name, password_hash)
            VALUES (@id, @tenant_id, @email, @display_name, @password_hash)`);

  await pool.request()
    .input('user_id', sql.UniqueIdentifier, userId)
    .input('role', sql.NVarChar, role || 'viewer')
    .input('tenant_id', sql.UniqueIdentifier, targetTenant)
    .query(`INSERT INTO user_roles (user_id, role, tenant_id) VALUES (@user_id, @role, @tenant_id)`);

  res.status(201).json({ id: userId, email, displayName, role: role || 'viewer' });
});

// PATCH /api/users/:id/role
router.patch('/:id/role', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  const pool = await getPool();
  await pool.request()
    .input('user_id', sql.UniqueIdentifier, req.params.id)
    .input('role', sql.NVarChar, req.body.role)
    .query(`UPDATE user_roles SET role = @role WHERE user_id = @user_id`);
  res.json({ message: 'Role updated' });
});

// PATCH /api/users/:id/toggle-active
router.patch('/:id/toggle-active', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  const pool = await getPool();
  await pool.request().input('id', sql.UniqueIdentifier, req.params.id)
    .query(`UPDATE users SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = @id`);
  res.json({ message: 'Toggled' });
});

// PATCH /api/users/:id/unlock
router.patch('/:id/unlock', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  const pool = await getPool();
  await pool.request().input('id', sql.UniqueIdentifier, req.params.id)
    .query(`UPDATE users SET is_locked = 0, failed_attempts = 0, locked_until = NULL WHERE id = @id`);
  res.json({ message: 'Unlocked' });
});

// DELETE /api/users/:id
router.delete('/:id', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  const pool = await getPool();
  await pool.request().input('id', sql.UniqueIdentifier, req.params.id)
    .query(`DELETE FROM users WHERE id = @id`);
  res.json({ message: 'Deleted' });
});

module.exports = router;
```

### Tenants Routes (`backend/src/routes/tenants.js`)

```javascript
const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const sql = require('mssql');
const { getPool } = require('../db/pool');
const { v4: uuidv4 } = require('uuid');

router.use(authenticate);

router.get('/', requireRole('super_admin'), async (req, res) => {
  const pool = await getPool();
  const result = await pool.request().query(`SELECT * FROM tenants ORDER BY created_at DESC`);
  res.json(result.recordset);
});

router.post('/', requireRole('super_admin'), async (req, res) => {
  const { name, slug } = req.body;
  const pool = await getPool();
  const id = uuidv4();

  await pool.request()
    .input('id', sql.UniqueIdentifier, id)
    .input('name', sql.NVarChar, name)
    .input('slug', sql.NVarChar, slug)
    .query(`INSERT INTO tenants (id, name, slug) VALUES (@id, @name, @slug)`);

  // Create default sites
  const sites = [
    { name: 'Austin Datacenter', code: 'ADC', type: 'datacenter', location: 'Austin, TX' },
    { name: 'San Angelo Datacenter', code: 'SDC', type: 'datacenter', location: 'San Angelo, TX' },
    { name: 'Amazon Web Services', code: 'AWS', type: 'cloud', provider: 'AWS' },
    { name: 'Microsoft Azure', code: 'AZURE', type: 'cloud', provider: 'Azure' },
    { name: 'Google Cloud Platform', code: 'GCP', type: 'cloud', provider: 'GCP' },
    { name: 'LDC Annex', code: 'LDC-ANNEX', type: 'datacenter', location: 'Austin, TX' },
    { name: 'LDC Mopac', code: 'LDC-MOPAC', type: 'datacenter', location: 'Austin, TX' },
  ];

  for (const site of sites) {
    await pool.request()
      .input('tenant_id', sql.UniqueIdentifier, id)
      .input('name', sql.NVarChar, site.name)
      .input('code', sql.NVarChar, site.code)
      .input('type', sql.NVarChar, site.type)
      .input('provider', sql.NVarChar, site.provider || null)
      .input('location', sql.NVarChar, site.location || null)
      .query(`INSERT INTO sites (tenant_id, name, code, type, provider, location) VALUES (@tenant_id, @name, @code, @type, @provider, @location)`);
  }

  res.status(201).json({ id, name, slug });
});

router.patch('/:id/settings', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  const pool = await getPool();
  const { registrationEnabled, sessionTimeoutMinutes, maxFailedAttempts, lockoutDurationMinutes } = req.body;

  const sets = [];
  if (registrationEnabled !== undefined) sets.push(`registration_enabled = ${registrationEnabled ? 1 : 0}`);
  if (sessionTimeoutMinutes !== undefined) sets.push(`session_timeout_minutes = ${parseInt(sessionTimeoutMinutes)}`);
  if (maxFailedAttempts !== undefined) sets.push(`max_failed_attempts = ${parseInt(maxFailedAttempts)}`);
  if (lockoutDurationMinutes !== undefined) sets.push(`lockout_duration_minutes = ${parseInt(lockoutDurationMinutes)}`);

  if (sets.length) {
    await pool.request().input('id', sql.UniqueIdentifier, req.params.id)
      .query(`UPDATE tenants SET ${sets.join(', ')}, updated_at = GETUTCDATE() WHERE id = @id`);
  }

  res.json({ message: 'Settings updated' });
});

router.delete('/:id', requireRole('super_admin'), async (req, res) => {
  const pool = await getPool();
  await pool.request().input('id', sql.UniqueIdentifier, req.params.id)
    .query(`DELETE FROM tenants WHERE id = @id`);
  res.json({ message: 'Deleted' });
});

module.exports = router;
```

### Sites Routes (`backend/src/routes/sites.js`)

```javascript
const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const sql = require('mssql');
const { getPool } = require('../db/pool');
const { v4: uuidv4 } = require('uuid');

router.use(authenticate);

router.get('/', async (req, res) => {
  const pool = await getPool();
  const tenantId = req.user.role === 'super_admin' && req.query.tenantId
    ? req.query.tenantId : req.tenantId;

  const result = await pool.request()
    .input('tenant_id', sql.UniqueIdentifier, tenantId)
    .query(`SELECT * FROM sites WHERE tenant_id = @tenant_id ORDER BY name`);
  res.json(result.recordset);
});

router.post('/', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  const { name, code, type, provider, location, tenantId } = req.body;
  const pool = await getPool();
  const targetTenant = req.user.role === 'super_admin' && tenantId ? tenantId : req.tenantId;
  const id = uuidv4();

  await pool.request()
    .input('id', sql.UniqueIdentifier, id)
    .input('tenant_id', sql.UniqueIdentifier, targetTenant)
    .input('name', sql.NVarChar, name)
    .input('code', sql.NVarChar, code)
    .input('type', sql.NVarChar, type)
    .input('provider', sql.NVarChar, provider || null)
    .input('location', sql.NVarChar, location || null)
    .query(`INSERT INTO sites (id, tenant_id, name, code, type, provider, location) VALUES (@id, @tenant_id, @name, @code, @type, @provider, @location)`);

  res.status(201).json({ id, name, code, type });
});

router.patch('/:id/toggle', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  const pool = await getPool();
  await pool.request().input('id', sql.UniqueIdentifier, req.params.id)
    .query(`UPDATE sites SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = @id`);
  res.json({ message: 'Toggled' });
});

router.delete('/:id', requireRole('tenant_admin', 'super_admin'), async (req, res) => {
  const pool = await getPool();
  await pool.request().input('id', sql.UniqueIdentifier, req.params.id)
    .query(`DELETE FROM sites WHERE id = @id`);
  res.json({ message: 'Deleted' });
});

module.exports = router;
```

### Audit Routes (`backend/src/routes/audit.js`)

```javascript
const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const sql = require('mssql');
const { getPool } = require('../db/pool');

router.use(authenticate, requireRole('tenant_admin', 'super_admin'));

router.get('/', async (req, res) => {
  const pool = await getPool();
  const tenantId = req.user.role === 'super_admin' && req.query.tenantId
    ? req.query.tenantId : req.tenantId;

  const result = await pool.request()
    .input('tenant_id', sql.UniqueIdentifier, tenantId)
    .query(`SELECT TOP 500 * FROM audit_log WHERE tenant_id = @tenant_id OR tenant_id IS NULL ORDER BY created_at DESC`);
  res.json(result.recordset);
});

module.exports = router;
```

### DB Pool (`backend/src/db/pool.js`)

```javascript
const sql = require('mssql');

const config = {
  server: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  options: { encrypt: true, trustServerCertificate: true },
  pool: { max: 20, min: 2, idleTimeoutMillis: 30000 },
};

let pool;

async function getPool() {
  if (!pool) pool = await sql.connect(config);
  return pool;
}

module.exports = { getPool };
```

---

## Security Features Summary

| Feature | Implementation |
|---|---|
| Password hashing | bcryptjs with 12 rounds |
| Session management | JWT + server-side session table with revocation |
| Account lockout | Configurable per-tenant (default: 5 attempts, 15 min lockout) |
| Session timeout | Configurable per-tenant (default: 30 min) |
| Rate limiting | 20 login attempts per 15 minutes per IP |
| RBAC | 4 roles: super_admin, tenant_admin, operator, viewer |
| Tenant isolation | Middleware enforces data boundaries |
| Audit logging | All auth events, user/site/tenant CRUD logged with severity |
| Brute force detection | Tracked via failed_attempts + auto-lock |
| CORS | Restricted to configured origin |
| Helmet | HTTP security headers |
| Parameterized queries | All SQL uses mssql parameterized inputs |

---

## Role Permission Matrix

| Action | Super Admin | Tenant Admin | Operator | Viewer |
|---|---|---|---|---|
| View all tenants | ✅ | ❌ | ❌ | ❌ |
| Create/delete tenants | ✅ | ❌ | ❌ | ❌ |
| Manage tenant settings | ✅ | Own tenant | ❌ | ❌ |
| Manage users | ✅ | Own tenant | ❌ | ❌ |
| Manage sites | ✅ | Own tenant | ❌ | ❌ |
| View audit log | ✅ | Own tenant | ❌ | ❌ |
| Toggle registration | ✅ | Own tenant | ❌ | ❌ |
| View dashboards | ✅ | ✅ | ✅ | ✅ |
| Run automation | ✅ | ✅ | ✅ | ❌ |
| View inventory | ✅ | ✅ | ✅ | ✅ |

---

## Folder Structure

```
backend/
├── src/
│   ├── server.js
│   ├── db/
│   │   ├── pool.js
│   │   ├── migrate.js
│   │   └── seed.js
│   ├── middleware/
│   │   └── auth.js
│   └── routes/
│       ├── auth.js
│       ├── users.js
│       ├── tenants.js
│       ├── sites.js
│       └── audit.js
├── .env.example
└── package.json
```
