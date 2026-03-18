'use strict';

require('dotenv').config();
const sql = require('mssql');

const config = {
  server:   process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 1433,
  user:     process.env.DB_USER     || 'sa',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME     || 'vanguard_os',
  options:  { encrypt: process.env.DB_ENCRYPT !== 'false', trustServerCertificate: true },
};

/* ─── helpers ─────────────────────────────────────────────────────────────── */
function table(name, ddl) {
  return `
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = '${name}')
    BEGIN
      CREATE TABLE ${name} (${ddl})
    END
  `;
}
function idx(name, ddl) {
  return `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='${name}') CREATE ${ddl}`;
}

/* ─── run ─────────────────────────────────────────────────────────────────── */
async function migrate() {
  console.log('🔄  Connecting to SQL Server …');
  const pool = await sql.connect(config);
  const q = (s) => pool.request().query(s);
  console.log('✅  Connected. Running migrations …\n');

  /* ══════════════════════════════════════════════════════════
     PHASE 1 — CORE
     ══════════════════════════════════════════════════════════ */

  /* tenants */
  await q(table('tenants', `
    id                        UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    name                      NVARCHAR(255)     NOT NULL,
    slug                      NVARCHAR(100)     NOT NULL UNIQUE,
    is_active                 BIT               NOT NULL DEFAULT 1,
    registration_enabled      BIT               NOT NULL DEFAULT 1,
    session_timeout_minutes   INT               NOT NULL DEFAULT 30,
    max_failed_attempts       INT               NOT NULL DEFAULT 5,
    lockout_duration_minutes  INT               NOT NULL DEFAULT 15,
    logo_url                  NVARCHAR(500)     NULL,
    primary_color             NVARCHAR(20)      NULL,
    created_at                DATETIME2         NOT NULL DEFAULT GETUTCDATE(),
    updated_at                DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  `));
  console.log('  ✓ tenants');

  /* users */
  await q(table('users', `
    id              UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    tenant_id       UNIQUEIDENTIFIER  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email           NVARCHAR(255)     NOT NULL,
    display_name    NVARCHAR(255)     NOT NULL,
    password_hash   NVARCHAR(255)     NOT NULL,
    avatar_url      NVARCHAR(500)     NULL,
    is_active       BIT               NOT NULL DEFAULT 1,
    is_locked       BIT               NOT NULL DEFAULT 0,
    failed_attempts INT               NOT NULL DEFAULT 0,
    locked_until    DATETIME2         NULL,
    last_login      DATETIME2         NULL,
    mfa_enabled     BIT               NOT NULL DEFAULT 0,
    mfa_secret      NVARCHAR(255)     NULL,
    preferences     NVARCHAR(MAX)     NULL,
    created_at      DATETIME2         NOT NULL DEFAULT GETUTCDATE(),
    updated_at      DATETIME2         NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_users_email UNIQUE (email)
  `));
  console.log('  ✓ users');

  /* user_roles */
  await q(table('user_roles', `
    id          UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    user_id     UNIQUEIDENTIFIER  NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    tenant_id   UNIQUEIDENTIFIER  NOT NULL REFERENCES tenants(id) ON DELETE NO ACTION,
    role        NVARCHAR(50)      NOT NULL
                  CHECK (role IN ('super_admin','tenant_admin','operator','viewer')),
    created_at  DATETIME2         NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_user_role UNIQUE (user_id, tenant_id, role)
  `));
  console.log('  ✓ user_roles');

  /* sessions */
  await q(table('sessions', `
    id          UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    user_id     UNIQUEIDENTIFIER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  NVARCHAR(255)     NOT NULL,
    ip_address  NVARCHAR(45)      NULL,
    user_agent  NVARCHAR(500)     NULL,
    expires_at  DATETIME2         NOT NULL,
    is_revoked  BIT               NOT NULL DEFAULT 0,
    created_at  DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  `));
  console.log('  ✓ sessions');

  /* audit_log */
  await q(table('audit_log', `
    id           UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    tenant_id    UNIQUEIDENTIFIER  NULL REFERENCES tenants(id) ON DELETE SET NULL,
    user_id      UNIQUEIDENTIFIER  NULL,
    user_email   NVARCHAR(255)     NULL,
    action       NVARCHAR(100)     NOT NULL,
    resource     NVARCHAR(100)     NOT NULL,
    resource_id  NVARCHAR(255)     NULL,
    details      NVARCHAR(MAX)     NULL,
    ip_address   NVARCHAR(45)      NULL,
    user_agent   NVARCHAR(500)     NULL,
    severity     NVARCHAR(20)      NOT NULL DEFAULT 'info'
                   CHECK (severity IN ('info','warning','critical')),
    created_at   DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  `));
  console.log('  ✓ audit_log');

  /* sites */
  await q(table('sites', `
    id          UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    tenant_id   UNIQUEIDENTIFIER  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        NVARCHAR(255)     NOT NULL,
    code        NVARCHAR(50)      NOT NULL,
    type        NVARCHAR(50)      NOT NULL
                  CHECK (type IN ('datacenter','cloud','edge','hybrid')),
    provider    NVARCHAR(100)     NULL,
    location    NVARCHAR(255)     NULL,
    latitude    FLOAT             NULL,
    longitude   FLOAT             NULL,
    is_active   BIT               NOT NULL DEFAULT 1,
    metadata    NVARCHAR(MAX)     NULL,
    created_at  DATETIME2         NOT NULL DEFAULT GETUTCDATE(),
    updated_at  DATETIME2         NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_site_code_tenant UNIQUE (tenant_id, code)
  `));
  console.log('  ✓ sites');

  /* agent_tokens */
  await q(table('agent_tokens', `
    id           UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    tenant_id    UNIQUEIDENTIFIER  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    asset_id     UNIQUEIDENTIFIER  NULL,
    token_hash   NVARCHAR(255)     NOT NULL UNIQUE,
    description  NVARCHAR(255)     NULL,
    is_revoked   BIT               NOT NULL DEFAULT 0,
    last_used    DATETIME2         NULL,
    expires_at   DATETIME2         NULL,
    created_by   UNIQUEIDENTIFIER  NULL,
    created_at   DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  `));
  console.log('  ✓ agent_tokens');

  /* notification_channels (needed early for alert_rules FK in Phase 2) */
  await q(table('notification_channels', `
    id          UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    tenant_id   UNIQUEIDENTIFIER  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        NVARCHAR(255)     NOT NULL,
    type        NVARCHAR(50)      NOT NULL
                  CHECK (type IN ('email','slack','teams','pagerduty','opsgenie','webhook','sms')),
    config      NVARCHAR(MAX)     NOT NULL,
    is_enabled  BIT               NOT NULL DEFAULT 1,
    created_at  DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  `));
  console.log('  ✓ notification_channels');

  /* ══════════════════════════════════════════════════════════
     PHASE 2 — ASSETS / MONITORING (schema created now, routes in Phase 2)
     ══════════════════════════════════════════════════════════ */

  await q(table('assets', `
    id                UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    tenant_id         UNIQUEIDENTIFIER  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    site_id           UNIQUEIDENTIFIER  NULL REFERENCES sites(id) ON DELETE SET NULL,
    name              NVARCHAR(255)     NOT NULL,
    hostname          NVARCHAR(255)     NULL,
    fqdn              NVARCHAR(500)     NULL,
    ip_address        NVARCHAR(45)      NULL,
    mac_address       NVARCHAR(20)      NULL,
    asset_type        NVARCHAR(50)      NOT NULL DEFAULT 'unknown'
                        CHECK (asset_type IN (
                          'server','workstation','vm','container','kubernetes_node',
                          'network_device','storage','cloud_instance','mobile_device',
                          'edge_device','application','service','database',
                          'certificate','domain','load_balancer','firewall',
                          'switch','router','unknown')),
    os_type           NVARCHAR(50)      NULL,
    os_version        NVARCHAR(100)     NULL,
    os_build          NVARCHAR(100)     NULL,
    cpu_cores         INT               NULL,
    ram_gb            FLOAT             NULL,
    disk_gb           FLOAT             NULL,
    manufacturer      NVARCHAR(255)     NULL,
    model             NVARCHAR(255)     NULL,
    serial_number     NVARCHAR(255)     NULL,
    cloud_provider    NVARCHAR(50)      NULL,
    cloud_region      NVARCHAR(100)     NULL,
    cloud_resource_id NVARCHAR(500)     NULL,
    environment       NVARCHAR(50)      NULL
                        CHECK (environment IN (
                          'production','staging','development','test','dr','unknown') OR environment IS NULL),
    criticality       NVARCHAR(20)      NOT NULL DEFAULT 'medium'
                        CHECK (criticality IN ('critical','high','medium','low')),
    status            NVARCHAR(30)      NOT NULL DEFAULT 'unknown'
                        CHECK (status IN (
                          'online','offline','degraded','maintenance','unknown','decommissioned')),
    agent_id          NVARCHAR(255)     NULL,
    agent_version     NVARCHAR(50)      NULL,
    last_seen         DATETIME2         NULL,
    last_check_in     DATETIME2         NULL,
    is_managed        BIT               NOT NULL DEFAULT 0,
    tags              NVARCHAR(MAX)     NULL,
    custom_fields     NVARCHAR(MAX)     NULL,
    notes             NVARCHAR(MAX)     NULL,
    created_at        DATETIME2         NOT NULL DEFAULT GETUTCDATE(),
    updated_at        DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  `));
  console.log('  ✓ assets');

  await q(table('asset_software', `
    id            UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    asset_id      UNIQUEIDENTIFIER  NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    name          NVARCHAR(255)     NOT NULL,
    version       NVARCHAR(100)     NULL,
    publisher     NVARCHAR(255)     NULL,
    install_date  DATE              NULL,
    install_path  NVARCHAR(500)     NULL,
    discovered_at DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  `));
  console.log('  ✓ asset_software');

  await q(table('asset_ports', `
    id            UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    asset_id      UNIQUEIDENTIFIER  NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    port          INT               NOT NULL,
    protocol      NVARCHAR(10)      NOT NULL,
    state         NVARCHAR(20)      NOT NULL,
    service       NVARCHAR(100)     NULL,
    version       NVARCHAR(100)     NULL,
    discovered_at DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  `));
  console.log('  ✓ asset_ports');

  await q(table('asset_dependencies', `
    id            UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    tenant_id     UNIQUEIDENTIFIER  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source_id     UNIQUEIDENTIFIER  NOT NULL REFERENCES assets(id) ON DELETE NO ACTION,
    target_id     UNIQUEIDENTIFIER  NOT NULL REFERENCES assets(id) ON DELETE NO ACTION,
    dep_type      NVARCHAR(50)      NOT NULL,
    protocol      NVARCHAR(50)      NULL,
    port          INT               NULL,
    discovered_at DATETIME2         NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_dep UNIQUE (source_id, target_id, dep_type)
  `));
  console.log('  ✓ asset_dependencies');

  await q(table('metrics', `
    id           BIGINT            IDENTITY(1,1) PRIMARY KEY,
    asset_id     UNIQUEIDENTIFIER  NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    tenant_id    UNIQUEIDENTIFIER  NOT NULL,
    metric_name  NVARCHAR(100)     NOT NULL,
    value        FLOAT             NOT NULL,
    unit         NVARCHAR(30)      NULL,
    tags         NVARCHAR(500)     NULL,
    ts           DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  `));
  console.log('  ✓ metrics');

  await q(table('metric_snapshots', `
    id              UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    asset_id        UNIQUEIDENTIFIER  NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    tenant_id       UNIQUEIDENTIFIER  NOT NULL,
    cpu_pct         FLOAT             NULL,
    mem_pct         FLOAT             NULL,
    disk_pct        FLOAT             NULL,
    net_in_kbps     FLOAT             NULL,
    net_out_kbps    FLOAT             NULL,
    load_avg_1      FLOAT             NULL,
    load_avg_5      FLOAT             NULL,
    load_avg_15     FLOAT             NULL,
    uptime_seconds  BIGINT            NULL,
    process_count   INT               NULL,
    ts              DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  `));
  console.log('  ✓ metric_snapshots');

  await q(table('log_entries', `
    id         BIGINT            IDENTITY(1,1) PRIMARY KEY,
    asset_id   UNIQUEIDENTIFIER  NULL REFERENCES assets(id) ON DELETE SET NULL,
    tenant_id  UNIQUEIDENTIFIER  NOT NULL,
    source     NVARCHAR(255)     NULL,
    severity   NVARCHAR(20)      NOT NULL
                 CHECK (severity IN ('debug','info','warning','error','critical')),
    message    NVARCHAR(MAX)     NOT NULL,
    raw_log    NVARCHAR(MAX)     NULL,
    tags       NVARCHAR(500)     NULL,
    ts         DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  `));
  console.log('  ✓ log_entries');

  await q(table('alert_rules', `
    id                    UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    tenant_id             UNIQUEIDENTIFIER  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name                  NVARCHAR(255)     NOT NULL,
    description           NVARCHAR(MAX)     NULL,
    metric_name           NVARCHAR(100)     NULL,
    condition             NVARCHAR(10)      NOT NULL
                            CHECK (condition IN ('gt','lt','gte','lte','eq','neq','anomaly','absent')),
    threshold             FLOAT             NULL,
    duration_secs         INT               NOT NULL DEFAULT 60,
    severity              NVARCHAR(20)      NOT NULL
                            CHECK (severity IN ('critical','high','medium','low','info')),
    asset_filter          NVARCHAR(MAX)     NULL,
    notification_channels NVARCHAR(MAX)     NULL,
    auto_remediate        BIT               NOT NULL DEFAULT 0,
    remediation_id        UNIQUEIDENTIFIER  NULL,
    is_enabled            BIT               NOT NULL DEFAULT 1,
    created_by            UNIQUEIDENTIFIER  NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at            DATETIME2         NOT NULL DEFAULT GETUTCDATE(),
    updated_at            DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  `));
  console.log('  ✓ alert_rules');

  await q(table('alerts', `
    id               UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    tenant_id        UNIQUEIDENTIFIER  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rule_id          UNIQUEIDENTIFIER  NULL REFERENCES alert_rules(id) ON DELETE SET NULL,
    asset_id         UNIQUEIDENTIFIER  NULL REFERENCES assets(id) ON DELETE SET NULL,
    title            NVARCHAR(500)     NOT NULL,
    description      NVARCHAR(MAX)     NULL,
    severity         NVARCHAR(20)      NOT NULL
                       CHECK (severity IN ('critical','high','medium','low','info')),
    status           NVARCHAR(20)      NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','acknowledged','resolved','suppressed')),
    metric_name      NVARCHAR(100)     NULL,
    metric_value     FLOAT             NULL,
    threshold        FLOAT             NULL,
    triggered_at     DATETIME2         NOT NULL DEFAULT GETUTCDATE(),
    acknowledged_at  DATETIME2         NULL,
    acknowledged_by  UNIQUEIDENTIFIER  NULL REFERENCES users(id) ON DELETE SET NULL,
    resolved_at      DATETIME2         NULL,
    resolved_by      UNIQUEIDENTIFIER  NULL REFERENCES users(id) ON DELETE SET NULL,
    dedup_key        NVARCHAR(255)     NULL,
    ticket_id        NVARCHAR(255)     NULL,
    enrichment       NVARCHAR(MAX)     NULL,
    created_at       DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  `));
  console.log('  ✓ alerts');

  await q(table('incidents', `
    id           UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    tenant_id    UNIQUEIDENTIFIER  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title        NVARCHAR(500)     NOT NULL,
    description  NVARCHAR(MAX)     NULL,
    severity     NVARCHAR(10)      NOT NULL
                   CHECK (severity IN ('p1','p2','p3','p4','p5')),
    status       NVARCHAR(30)      NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','investigating','mitigated','resolved','closed')),
    assigned_to  UNIQUEIDENTIFIER  NULL REFERENCES users(id) ON DELETE SET NULL,
    alert_ids    NVARCHAR(MAX)     NULL,
    asset_ids    NVARCHAR(MAX)     NULL,
    ticket_id    NVARCHAR(255)     NULL,
    rca          NVARCHAR(MAX)     NULL,
    timeline     NVARCHAR(MAX)     NULL,
    opened_at    DATETIME2         NOT NULL DEFAULT GETUTCDATE(),
    resolved_at  DATETIME2         NULL,
    created_by   UNIQUEIDENTIFIER  NULL REFERENCES users(id) ON DELETE NO ACTION,
    created_at   DATETIME2         NOT NULL DEFAULT GETUTCDATE(),
    updated_at   DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  `));
  console.log('  ✓ incidents');

  await q(table('maintenance_windows', `
    id          UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    tenant_id   UNIQUEIDENTIFIER  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        NVARCHAR(255)     NOT NULL,
    asset_ids   NVARCHAR(MAX)     NULL,
    starts_at   DATETIME2         NOT NULL,
    ends_at     DATETIME2         NOT NULL,
    created_by  UNIQUEIDENTIFIER  NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at  DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  `));
  console.log('  ✓ maintenance_windows');

  /* ══════════════════════════════════════════════════════════
     PHASE 3 — AUTOMATION / COMPLIANCE / CERTS
     ══════════════════════════════════════════════════════════ */

  await q(table('automation_playbooks', `
    id                UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    tenant_id         UNIQUEIDENTIFIER  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name              NVARCHAR(255)     NOT NULL,
    description       NVARCHAR(MAX)     NULL,
    trigger_type      NVARCHAR(50)      NOT NULL
                        CHECK (trigger_type IN ('manual','schedule','alert','webhook','policy_violation','event')),
    trigger_config    NVARCHAR(MAX)     NULL,
    steps             NVARCHAR(MAX)     NOT NULL,
    requires_approval BIT               NOT NULL DEFAULT 0,
    approvers         NVARCHAR(MAX)     NULL,
    is_enabled        BIT               NOT NULL DEFAULT 1,
    tags              NVARCHAR(500)     NULL,
    created_by        UNIQUEIDENTIFIER  NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at        DATETIME2         NOT NULL DEFAULT GETUTCDATE(),
    updated_at        DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  `));
  console.log('  ✓ automation_playbooks');

  await q(table('automation_runs', `
    id                  UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    tenant_id           UNIQUEIDENTIFIER  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    playbook_id         UNIQUEIDENTIFIER  NULL REFERENCES automation_playbooks(id) ON DELETE SET NULL,
    playbook_name       NVARCHAR(255)     NULL,
    target_asset_id     UNIQUEIDENTIFIER  NULL REFERENCES assets(id) ON DELETE SET NULL,
    triggered_by        NVARCHAR(100)     NOT NULL,
    triggered_by_user   UNIQUEIDENTIFIER  NULL REFERENCES users(id) ON DELETE SET NULL,
    status              NVARCHAR(30)      NOT NULL DEFAULT 'pending'
                          CHECK (status IN (
                            'pending','awaiting_approval','approved','running',
                            'success','failed','cancelled','rolled_back')),
    steps_total         INT               NOT NULL DEFAULT 0,
    steps_completed     INT               NOT NULL DEFAULT 0,
    output_log          NVARCHAR(MAX)     NULL,
    error_message       NVARCHAR(MAX)     NULL,
    approved_by         UNIQUEIDENTIFIER  NULL REFERENCES users(id) ON DELETE NO ACTION,
    approved_at         DATETIME2         NULL,
    started_at          DATETIME2         NULL,
    completed_at        DATETIME2         NULL,
    created_at          DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  `));
  console.log('  ✓ automation_runs');

  await q(table('compliance_policies', `
    id          UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    tenant_id   UNIQUEIDENTIFIER  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        NVARCHAR(255)     NOT NULL,
    framework   NVARCHAR(100)     NULL,
    description NVARCHAR(MAX)     NULL,
    rules       NVARCHAR(MAX)     NOT NULL,
    is_enabled  BIT               NOT NULL DEFAULT 1,
    created_by  UNIQUEIDENTIFIER  NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at  DATETIME2         NOT NULL DEFAULT GETUTCDATE(),
    updated_at  DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  `));
  console.log('  ✓ compliance_policies');

  await q(table('compliance_results', `
    id          UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    tenant_id   UNIQUEIDENTIFIER  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    policy_id   UNIQUEIDENTIFIER  NULL REFERENCES compliance_policies(id) ON DELETE SET NULL,
    asset_id    UNIQUEIDENTIFIER  NULL REFERENCES assets(id) ON DELETE SET NULL,
    status      NVARCHAR(20)      NOT NULL
                  CHECK (status IN ('pass','fail','warning','skip','error')),
    score       FLOAT             NULL,
    findings    NVARCHAR(MAX)     NULL,
    checked_at  DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  `));
  console.log('  ✓ compliance_results');

  await q(table('certificates', `
    id             UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    tenant_id      UNIQUEIDENTIFIER  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    asset_id       UNIQUEIDENTIFIER  NULL REFERENCES assets(id) ON DELETE SET NULL,
    common_name    NVARCHAR(255)     NOT NULL,
    san            NVARCHAR(MAX)     NULL,
    issuer         NVARCHAR(500)     NULL,
    subject        NVARCHAR(500)     NULL,
    serial_number  NVARCHAR(255)     NULL,
    thumbprint     NVARCHAR(255)     NULL,
    not_before     DATETIME2         NULL,
    not_after      DATETIME2         NULL,
    days_remaining INT               NULL,
    is_expired     BIT               NOT NULL DEFAULT 0,
    is_self_signed BIT               NOT NULL DEFAULT 0,
    port           INT               NULL,
    protocol       NVARCHAR(20)      NULL,
    discovered_at  DATETIME2         NOT NULL DEFAULT GETUTCDATE(),
    last_checked   DATETIME2         NULL
  `));
  console.log('  ✓ certificates');

  /* ══════════════════════════════════════════════════════════
     PHASE 4 — CLOUD / MOBILE / INTEGRATIONS / REPORTS
     ══════════════════════════════════════════════════════════ */

  await q(table('cloud_resources', `
    id             UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    tenant_id      UNIQUEIDENTIFIER  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    asset_id       UNIQUEIDENTIFIER  NULL REFERENCES assets(id) ON DELETE SET NULL,
    provider       NVARCHAR(30)      NOT NULL
                     CHECK (provider IN ('aws','azure','gcp','oracle','other')),
    resource_type  NVARCHAR(100)     NOT NULL,
    resource_id    NVARCHAR(500)     NOT NULL,
    resource_name  NVARCHAR(255)     NULL,
    region         NVARCHAR(100)     NULL,
    account_id     NVARCHAR(255)     NULL,
    status         NVARCHAR(50)      NULL,
    tags           NVARCHAR(MAX)     NULL,
    cost_daily     FLOAT             NULL,
    cost_monthly   FLOAT             NULL,
    last_synced    DATETIME2         NULL,
    raw_metadata   NVARCHAR(MAX)     NULL,
    created_at     DATETIME2         NOT NULL DEFAULT GETUTCDATE(),
    updated_at     DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  `));
  console.log('  ✓ cloud_resources');

  await q(table('mobile_devices', `
    id                  UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    tenant_id           UNIQUEIDENTIFIER  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    asset_id            UNIQUEIDENTIFIER  NULL REFERENCES assets(id) ON DELETE SET NULL,
    device_id           NVARCHAR(255)     NOT NULL,
    name                NVARCHAR(255)     NULL,
    model               NVARCHAR(255)     NULL,
    manufacturer        NVARCHAR(255)     NULL,
    os_type             NVARCHAR(30)      NOT NULL
                          CHECK (os_type IN ('ios','android','windows_mobile','other')),
    os_version          NVARCHAR(100)     NULL,
    mdm_provider        NVARCHAR(100)     NULL,
    mdm_enrolled        BIT               NOT NULL DEFAULT 0,
    mdm_compliant       BIT               NULL,
    mdm_last_sync       DATETIME2         NULL,
    battery_level       INT               NULL,
    battery_health      NVARCHAR(30)      NULL,
    is_charging         BIT               NULL,
    wifi_connected      BIT               NULL,
    cellular_connected  BIT               NULL,
    gps_lat             FLOAT             NULL,
    gps_lng             FLOAT             NULL,
    gps_accuracy_m      FLOAT             NULL,
    gps_timestamp       DATETIME2         NULL,
    security_compliant  BIT               NULL,
    screen_lock_enabled BIT               NULL,
    encryption_enabled  BIT               NULL,
    jailbroken          BIT               NULL,
    assigned_user       NVARCHAR(255)     NULL,
    last_seen           DATETIME2         NULL,
    last_check_in       DATETIME2         NULL,
    metadata            NVARCHAR(MAX)     NULL,
    created_at          DATETIME2         NOT NULL DEFAULT GETUTCDATE(),
    updated_at          DATETIME2         NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_mobile_device UNIQUE (tenant_id, device_id)
  `));
  console.log('  ✓ mobile_devices');

  await q(table('integrations', `
    id           UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    tenant_id    UNIQUEIDENTIFIER  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name         NVARCHAR(255)     NOT NULL,
    type         NVARCHAR(50)      NOT NULL,
    config       NVARCHAR(MAX)     NULL,
    credentials  NVARCHAR(MAX)     NULL,
    is_enabled   BIT               NOT NULL DEFAULT 1,
    last_sync    DATETIME2         NULL,
    sync_status  NVARCHAR(30)      NULL,
    created_by   UNIQUEIDENTIFIER  NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at   DATETIME2         NOT NULL DEFAULT GETUTCDATE(),
    updated_at   DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  `));
  console.log('  ✓ integrations');

  await q(table('reports', `
    id            UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    tenant_id     UNIQUEIDENTIFIER  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name          NVARCHAR(255)     NOT NULL,
    report_type   NVARCHAR(100)     NOT NULL,
    filters       NVARCHAR(MAX)     NULL,
    schedule      NVARCHAR(100)     NULL,
    output_format NVARCHAR(20)      NOT NULL DEFAULT 'json',
    last_run      DATETIME2         NULL,
    last_result   NVARCHAR(MAX)     NULL,
    created_by    UNIQUEIDENTIFIER  NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at    DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  `));
  console.log('  ✓ reports');

  await q(table('dashboards', `
    id          UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID(),
    tenant_id   UNIQUEIDENTIFIER  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id     UNIQUEIDENTIFIER  NULL REFERENCES users(id) ON DELETE SET NULL,
    name        NVARCHAR(255)     NOT NULL,
    layout      NVARCHAR(MAX)     NULL,
    widgets     NVARCHAR(MAX)     NULL,
    is_default  BIT               NOT NULL DEFAULT 0,
    is_shared   BIT               NOT NULL DEFAULT 0,
    created_at  DATETIME2         NOT NULL DEFAULT GETUTCDATE(),
    updated_at  DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  `));
  console.log('  ✓ dashboards');

  /* ══════════════════════════════════════════════════════════
     INDEXES
     ══════════════════════════════════════════════════════════ */
  const indexes = [
    idx('IX_users_email',        'INDEX IX_users_email          ON users(email)'),
    idx('IX_users_tenant',       'INDEX IX_users_tenant         ON users(tenant_id)'),
    idx('IX_sessions_user',      'INDEX IX_sessions_user        ON sessions(user_id, is_revoked)'),
    idx('IX_audit_tenant_ts',    'INDEX IX_audit_tenant_ts      ON audit_log(tenant_id, created_at DESC)'),
    idx('IX_sites_tenant',       'INDEX IX_sites_tenant         ON sites(tenant_id)'),
    idx('IX_assets_tenant',      'INDEX IX_assets_tenant        ON assets(tenant_id)'),
    idx('IX_assets_status',      'INDEX IX_assets_status        ON assets(tenant_id, status)'),
    idx('IX_assets_type',        'INDEX IX_assets_type          ON assets(tenant_id, asset_type)'),
    idx('IX_assets_site',        'INDEX IX_assets_site          ON assets(site_id)'),
    idx('IX_assets_agent',       'UNIQUE INDEX IX_assets_agent  ON assets(agent_id) WHERE agent_id IS NOT NULL'),
    idx('IX_metrics_asset_ts',   'INDEX IX_metrics_asset_ts     ON metrics(asset_id, ts DESC)'),
    idx('IX_metrics_tenant_ts',  'INDEX IX_metrics_tenant_ts    ON metrics(tenant_id, ts DESC)'),
    idx('IX_snaps_asset_ts',     'INDEX IX_snaps_asset_ts       ON metric_snapshots(asset_id, ts DESC)'),
    idx('IX_logs_asset_ts',      'INDEX IX_logs_asset_ts        ON log_entries(asset_id, ts DESC)'),
    idx('IX_logs_tenant_ts',     'INDEX IX_logs_tenant_ts       ON log_entries(tenant_id, ts DESC)'),
    idx('IX_alerts_tenant_stat', 'INDEX IX_alerts_tenant_stat   ON alerts(tenant_id, status)'),
    idx('IX_alerts_asset',       'INDEX IX_alerts_asset         ON alerts(asset_id)'),
    idx('IX_mobile_tenant',      'INDEX IX_mobile_tenant        ON mobile_devices(tenant_id)'),
    idx('IX_cloud_tenant',       'INDEX IX_cloud_tenant         ON cloud_resources(tenant_id, provider)'),
    idx('IX_certs_tenant_exp',   'INDEX IX_certs_tenant_exp     ON certificates(tenant_id, not_after)'),
    idx('IX_agent_tokens_hash',  'INDEX IX_agent_tokens_hash    ON agent_tokens(token_hash)'),
  ];

  for (const i of indexes) await q(i);
  console.log('  ✓ indexes\n');

  console.log('✅  All migrations complete!');
  await pool.close();
}

migrate().catch(err => { console.error('❌  Migration failed:', err); process.exit(1); });
