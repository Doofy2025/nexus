# Vanguard OS — Backend  ·  Phase 1

Production-ready Node.js + MS SQL Server backend for the Vanguard OS observability platform.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — set DB_HOST, DB_PASSWORD, JWT_SECRET at minimum

# 3. Create the database (SQL Server must be running)
#    Connect with SSMS or sqlcmd and run:
#    CREATE DATABASE vanguard_os;

# 4. Run migrations (creates all tables)
npm run migrate

# 5. Seed default data (users, sites, alert rules)
npm run seed

# 6. Start the API
npm run dev        # development (nodemon)
npm start          # production
```

API is available at: `http://localhost:3001`  
Health check: `GET /api/health`

---

## Default Credentials

> ⚠️ **Change all passwords immediately after first login.**

| Email                        | Password  | Role         |
|------------------------------|-----------|--------------|
| superadmin@vanguardos.io     | changeme  | super_admin  |
| admin@vanguardos.io          | changeme  | tenant_admin |
| operator@vanguardos.io       | changeme  | operator     |
| viewer@vanguardos.io         | changeme  | viewer       |

---

## Phase 1 API Routes

### Auth  `/api/auth`
| Method | Endpoint              | Auth | Description              |
|--------|-----------------------|------|--------------------------|
| POST   | `/login`              | —    | Login, returns JWT       |
| POST   | `/register`           | —    | Self-register (if enabled) |
| POST   | `/logout`             | JWT  | Revoke session           |
| GET    | `/me`                 | JWT  | Current user info        |
| POST   | `/change-password`    | JWT  | Change own password      |

### Users  `/api/users`
| Method | Endpoint                 | Role          | Description         |
|--------|--------------------------|---------------|---------------------|
| GET    | `/`                      | admin+        | List users          |
| GET    | `/:id`                   | admin+        | Get user            |
| POST   | `/`                      | admin+        | Create user         |
| PATCH  | `/:id`                   | admin+        | Update name/avatar  |
| PATCH  | `/:id/role`              | admin+        | Change role         |
| PATCH  | `/:id/toggle-active`     | admin+        | Enable/disable      |
| PATCH  | `/:id/unlock`            | admin+        | Unlock account      |
| POST   | `/:id/reset-password`    | admin+        | Admin password reset|
| DELETE | `/:id`                   | admin+        | Delete user         |

### Tenants  `/api/tenants`
| Method | Endpoint              | Role        | Description         |
|--------|-----------------------|-------------|---------------------|
| GET    | `/`                   | any         | List tenants        |
| GET    | `/:id`                | any         | Get tenant          |
| POST   | `/`                   | super_admin | Create tenant       |
| PATCH  | `/:id/settings`       | admin+      | Update settings     |
| PATCH  | `/:id/toggle-active`  | super_admin | Enable/disable      |
| DELETE | `/:id`                | super_admin | Delete tenant       |

### Sites  `/api/sites`
| Method | Endpoint      | Role   | Description        |
|--------|---------------|--------|--------------------|
| GET    | `/`           | any    | List sites         |
| GET    | `/:id`        | any    | Get site           |
| POST   | `/`           | admin+ | Create site        |
| PATCH  | `/:id`        | admin+ | Update site        |
| PATCH  | `/:id/toggle` | admin+ | Enable/disable     |
| DELETE | `/:id`        | admin+ | Delete (if empty)  |

### Audit  `/api/audit`
| Method | Endpoint   | Role   | Description              |
|--------|------------|--------|--------------------------|
| GET    | `/`        | admin+ | Paginated audit log      |
| GET    | `/summary` | admin+ | Severity count summary   |

### Agent Ingest  `/api/agent`
| Method | Endpoint        | Auth         | Description               |
|--------|-----------------|--------------|---------------------------|
| POST   | `/register`     | Agent Token  | Agent self-registration   |
| POST   | `/heartbeat`    | Agent Token  | Metrics snapshot          |
| POST   | `/inventory`    | Agent Token  | Software + ports          |
| POST   | `/logs`         | Agent Token  | Batch log shipping        |
| GET    | `/commands`     | Agent Token  | Poll for commands         |

---

## Role Matrix

| Action                | super_admin | tenant_admin | operator | viewer |
|-----------------------|:-----------:|:------------:|:--------:|:------:|
| Manage all tenants    | ✅           | ❌            | ❌        | ❌      |
| Manage own tenant     | ✅           | ✅            | ❌        | ❌      |
| Manage users          | ✅           | ✅            | ❌        | ❌      |
| Manage sites          | ✅           | ✅            | ❌        | ❌      |
| View audit log        | ✅           | ✅            | ❌        | ❌      |
| View dashboards       | ✅           | ✅            | ✅        | ✅      |

---

## Agent Deployment

### Prerequisites
1. Create an agent token via the Vanguard OS UI (Settings → Agent Tokens)  
   or run: `node scripts/generate-agent-token.js`

### Windows (PowerShell Service)
```powershell
# Download NSSM from https://nssm.cc then:
cd agents\windows
.\install-service.ps1 `
    -ApiBase    "http://your-server:3001" `
    -AgentToken "your-token-here"

# Verify
Get-Service VanguardOSAgent
Get-Content "$env:ProgramData\VanguardOS\agent.log" -Tail 20 -Wait
```

### Linux (systemd)
```bash
cd agents/linux
sudo bash install-service.sh \
    --api-base "http://your-server:3001" \
    --token    "your-token-here"

# Verify
systemctl status vanguard-agent
journalctl -u vanguard-agent -f
```

### AIX (SRC subsystem)
```ksh
cd agents/aix
ksh install-src.sh \
    --api-base "http://your-server:3001" \
    --token    "your-token-here"

# Verify
lssrc -s vanguardagt
tail -f /var/log/vanguard/agent-aix.log
```

### macOS (LaunchDaemon)
```bash
cd agents/macos
sudo bash install-launchd.sh \
    --api-base "http://your-server:3001" \
    --token    "your-token-here"

# Verify
sudo launchctl list | grep vanguardos
tail -f /var/log/vanguard/agent-macos.log
```

---

## Folder Structure

```
vanguard-backend/
├── src/
│   ├── server.js               # Express app entry point
│   ├── db/
│   │   ├── pool.js             # MSSQL connection pool
│   │   ├── migrate.js          # Full schema (all phases)
│   │   └── seed.js             # Default data
│   ├── middleware/
│   │   └── auth.js             # JWT + agent token + RBAC
│   ├── routes/
│   │   ├── auth.js             # Login / register / logout
│   │   ├── users.js            # User management
│   │   ├── tenants.js          # Tenant management
│   │   ├── sites.js            # Site management
│   │   ├── audit.js            # Audit log
│   │   └── agent.js            # Agent ingest API
│   └── utils/
│       ├── logger.js           # Winston logger
│       └── audit.js            # Audit write helper
├── agents/
│   ├── windows/
│   │   ├── vanguard-agent.ps1  # PowerShell collector
│   │   ├── install-service.ps1 # NSSM service installer
│   │   └── uninstall-service.ps1
│   ├── linux/
│   │   ├── vanguard-agent.sh   # Bash collector
│   │   ├── install-service.sh  # systemd installer
│   │   └── uninstall-service.sh
│   ├── aix/
│   │   ├── vanguard-agent-aix.sh  # ksh collector
│   │   └── install-src.sh         # SRC installer
│   └── macos/
│       ├── vanguard-agent-macos.sh # Bash collector
│       ├── install-launchd.sh      # LaunchDaemon installer
│       └── uninstall-launchd.sh
├── scripts/
│   └── generate-agent-token.js
├── .env.example
├── package.json
└── README.md
```

---

## Security Notes

- All SQL uses parameterised queries — no SQL injection possible
- Passwords hashed with bcrypt (12 rounds)
- JWT sessions are server-side revocable (stored hash in `sessions` table)
- Account lockout: configurable per-tenant (default 5 attempts → 15 min lock)
- Rate limiting on all routes; login endpoint additionally hardened
- Agent tokens are stored as SHA-256 hashes — raw token shown once only
- Tenant isolation enforced at middleware level on every request
- All sensitive actions written to immutable `audit_log`

---

## Phases

| Phase | Status  | Contents                                        |
|-------|---------|-------------------------------------------------|
| 1     | ✅ Done  | Auth, Users, Tenants, Sites, Audit, Agents      |
| 2     | 🔜 Next  | Assets, Metrics, Alerts, Incidents              |
| 3     | 🔜       | Automation, Compliance, Certificates            |
| 4     | 🔜       | Cloud, Mobile, Integrations, WebSockets, Reports|
