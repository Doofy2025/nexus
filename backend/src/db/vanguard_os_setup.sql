-- ============================================================
--  Vanguard OS — Complete SSMS Setup Script
--  Run this entire file against your SQL Server instance.
--  It will:
--    1. Create the vanguard_os database
--    2. Create all tables (idempotent — safe to re-run)
--    3. Create all indexes
--    4. Seed default tenant, users, sites, alert rules,
--       and notification channel
--
--  Default credentials (CHANGE IMMEDIATELY after first login):
--    superadmin@vanguardos.io  / changeme
--    admin@vanguardos.io       / changeme
--    operator@vanguardos.io    / changeme
--    viewer@vanguardos.io      / changeme
--
--  Passwords are bcrypt hashed at 12 rounds.
--  The hashes below correspond to the plaintext: changeme
-- ============================================================

USE master;
GO

-- ============================================================
-- 1. CREATE DATABASE
-- ============================================================
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'vanguard_os')
BEGIN
    CREATE DATABASE vanguard_os;
    PRINT '✓ Database vanguard_os created.';
END
ELSE
    PRINT '  Database vanguard_os already exists — skipping create.';
GO

USE vanguard_os;
GO

-- ============================================================
-- 2. TABLES
-- ============================================================

-- ── tenants ──────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'tenants')
BEGIN
    CREATE TABLE tenants (
        id                        UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        name                      NVARCHAR(255)     NOT NULL,
        slug                      NVARCHAR(100)     NOT NULL  UNIQUE,
        is_active                 BIT               NOT NULL  DEFAULT 1,
        registration_enabled      BIT               NOT NULL  DEFAULT 1,
        session_timeout_minutes   INT               NOT NULL  DEFAULT 30,
        max_failed_attempts       INT               NOT NULL  DEFAULT 5,
        lockout_duration_minutes  INT               NOT NULL  DEFAULT 15,
        logo_url                  NVARCHAR(500)     NULL,
        primary_color             NVARCHAR(20)      NULL,
        created_at                DATETIME2         NOT NULL  DEFAULT GETUTCDATE(),
        updated_at                DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );
    PRINT '✓ tenants';
END
GO

-- ── users ─────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'users')
BEGIN
    CREATE TABLE users (
        id              UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        tenant_id       UNIQUEIDENTIFIER  NOT NULL  REFERENCES tenants(id) ON DELETE CASCADE,
        email           NVARCHAR(255)     NOT NULL,
        display_name    NVARCHAR(255)     NOT NULL,
        password_hash   NVARCHAR(255)     NOT NULL,
        avatar_url      NVARCHAR(500)     NULL,
        is_active       BIT               NOT NULL  DEFAULT 1,
        is_locked       BIT               NOT NULL  DEFAULT 0,
        failed_attempts INT               NOT NULL  DEFAULT 0,
        locked_until    DATETIME2         NULL,
        last_login      DATETIME2         NULL,
        mfa_enabled     BIT               NOT NULL  DEFAULT 0,
        mfa_secret      NVARCHAR(255)     NULL,
        preferences     NVARCHAR(MAX)     NULL,
        created_at      DATETIME2         NOT NULL  DEFAULT GETUTCDATE(),
        updated_at      DATETIME2         NOT NULL  DEFAULT GETUTCDATE(),
        CONSTRAINT UQ_users_email UNIQUE (email)
    );
    PRINT '✓ users';
END
GO

-- ── user_roles ────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'user_roles')
BEGIN
    CREATE TABLE user_roles (
        id          UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        user_id     UNIQUEIDENTIFIER  NOT NULL  REFERENCES users(id)   ON DELETE CASCADE,
        tenant_id   UNIQUEIDENTIFIER  NOT NULL  REFERENCES tenants(id) ON DELETE NO ACTION,
        role        NVARCHAR(50)      NOT NULL
                      CHECK (role IN ('super_admin','tenant_admin','operator','viewer')),
        created_at  DATETIME2         NOT NULL  DEFAULT GETUTCDATE(),
        CONSTRAINT UQ_user_role UNIQUE (user_id, tenant_id, role)
    );
    PRINT '✓ user_roles';
END
GO

-- ── sessions ──────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'sessions')
BEGIN
    CREATE TABLE sessions (
        id          UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        user_id     UNIQUEIDENTIFIER  NOT NULL  REFERENCES users(id) ON DELETE CASCADE,
        token_hash  NVARCHAR(255)     NOT NULL,
        ip_address  NVARCHAR(45)      NULL,
        user_agent  NVARCHAR(500)     NULL,
        expires_at  DATETIME2         NOT NULL,
        is_revoked  BIT               NOT NULL  DEFAULT 0,
        created_at  DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );
    PRINT '✓ sessions';
END
GO

-- ── audit_log ─────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'audit_log')
BEGIN
    CREATE TABLE audit_log (
        id           UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        tenant_id    UNIQUEIDENTIFIER  NULL  REFERENCES tenants(id) ON DELETE SET NULL,
        user_id      UNIQUEIDENTIFIER  NULL,
        user_email   NVARCHAR(255)     NULL,
        action       NVARCHAR(100)     NOT NULL,
        resource     NVARCHAR(100)     NOT NULL,
        resource_id  NVARCHAR(255)     NULL,
        details      NVARCHAR(MAX)     NULL,
        ip_address   NVARCHAR(45)      NULL,
        user_agent   NVARCHAR(500)     NULL,
        severity     NVARCHAR(20)      NOT NULL  DEFAULT 'info'
                       CHECK (severity IN ('info','warning','critical')),
        created_at   DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );
    PRINT '✓ audit_log';
END
GO

-- ── sites ─────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'sites')
BEGIN
    CREATE TABLE sites (
        id          UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        tenant_id   UNIQUEIDENTIFIER  NOT NULL  REFERENCES tenants(id) ON DELETE CASCADE,
        name        NVARCHAR(255)     NOT NULL,
        code        NVARCHAR(50)      NOT NULL,
        type        NVARCHAR(50)      NOT NULL
                      CHECK (type IN ('datacenter','cloud','edge','hybrid')),
        provider    NVARCHAR(100)     NULL,
        location    NVARCHAR(255)     NULL,
        latitude    FLOAT             NULL,
        longitude   FLOAT             NULL,
        is_active   BIT               NOT NULL  DEFAULT 1,
        metadata    NVARCHAR(MAX)     NULL,
        created_at  DATETIME2         NOT NULL  DEFAULT GETUTCDATE(),
        updated_at  DATETIME2         NOT NULL  DEFAULT GETUTCDATE(),
        CONSTRAINT UQ_site_code_tenant UNIQUE (tenant_id, code)
    );
    PRINT '✓ sites';
END
GO

-- ── agent_tokens ──────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'agent_tokens')
BEGIN
    CREATE TABLE agent_tokens (
        id           UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        tenant_id    UNIQUEIDENTIFIER  NOT NULL  REFERENCES tenants(id) ON DELETE CASCADE,
        asset_id     UNIQUEIDENTIFIER  NULL,
        token_hash   NVARCHAR(255)     NOT NULL  UNIQUE,
        description  NVARCHAR(255)     NULL,
        is_revoked   BIT               NOT NULL  DEFAULT 0,
        last_used    DATETIME2         NULL,
        expires_at   DATETIME2         NULL,
        created_by   UNIQUEIDENTIFIER  NULL,
        created_at   DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );
    PRINT '✓ agent_tokens';
END
GO

-- ── notification_channels ─────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'notification_channels')
BEGIN
    CREATE TABLE notification_channels (
        id          UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        tenant_id   UNIQUEIDENTIFIER  NOT NULL  REFERENCES tenants(id) ON DELETE CASCADE,
        name        NVARCHAR(255)     NOT NULL,
        type        NVARCHAR(50)      NOT NULL
                      CHECK (type IN ('email','slack','teams','pagerduty','opsgenie','webhook','sms')),
        config      NVARCHAR(MAX)     NOT NULL,
        is_enabled  BIT               NOT NULL  DEFAULT 1,
        created_at  DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );
    PRINT '✓ notification_channels';
END
GO

-- ── assets ────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'assets')
BEGIN
    CREATE TABLE assets (
        id                UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        tenant_id         UNIQUEIDENTIFIER  NOT NULL  REFERENCES tenants(id) ON DELETE CASCADE,
        site_id           UNIQUEIDENTIFIER  NULL  REFERENCES sites(id) ON DELETE SET NULL,
        name              NVARCHAR(255)     NOT NULL,
        hostname          NVARCHAR(255)     NULL,
        fqdn              NVARCHAR(500)     NULL,
        ip_address        NVARCHAR(45)      NULL,
        mac_address       NVARCHAR(20)      NULL,
        asset_type        NVARCHAR(50)      NOT NULL  DEFAULT 'unknown'
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
                            CHECK (environment IN ('production','staging','development','test','dr','unknown') OR environment IS NULL),
        criticality       NVARCHAR(20)      NOT NULL  DEFAULT 'medium'
                            CHECK (criticality IN ('critical','high','medium','low')),
        status            NVARCHAR(30)      NOT NULL  DEFAULT 'unknown'
                            CHECK (status IN ('online','offline','degraded','maintenance','unknown','decommissioned')),
        agent_id          NVARCHAR(255)     NULL,
        agent_version     NVARCHAR(50)      NULL,
        last_seen         DATETIME2         NULL,
        last_check_in     DATETIME2         NULL,
        is_managed        BIT               NOT NULL  DEFAULT 0,
        tags              NVARCHAR(MAX)     NULL,
        custom_fields     NVARCHAR(MAX)     NULL,
        notes             NVARCHAR(MAX)     NULL,
        created_at        DATETIME2         NOT NULL  DEFAULT GETUTCDATE(),
        updated_at        DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );
    PRINT '✓ assets';
END
GO

-- ── asset_software ────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'asset_software')
BEGIN
    CREATE TABLE asset_software (
        id            UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        asset_id      UNIQUEIDENTIFIER  NOT NULL  REFERENCES assets(id) ON DELETE CASCADE,
        name          NVARCHAR(255)     NOT NULL,
        version       NVARCHAR(100)     NULL,
        publisher     NVARCHAR(255)     NULL,
        install_date  DATE              NULL,
        install_path  NVARCHAR(500)     NULL,
        discovered_at DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );
    PRINT '✓ asset_software';
END
GO

-- ── asset_ports ───────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'asset_ports')
BEGIN
    CREATE TABLE asset_ports (
        id            UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        asset_id      UNIQUEIDENTIFIER  NOT NULL  REFERENCES assets(id) ON DELETE CASCADE,
        port          INT               NOT NULL,
        protocol      NVARCHAR(10)      NOT NULL,
        state         NVARCHAR(20)      NOT NULL,
        service       NVARCHAR(100)     NULL,
        version       NVARCHAR(100)     NULL,
        discovered_at DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );
    PRINT '✓ asset_ports';
END
GO

-- ── asset_dependencies ────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'asset_dependencies')
BEGIN
    CREATE TABLE asset_dependencies (
        id            UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        tenant_id     UNIQUEIDENTIFIER  NOT NULL  REFERENCES tenants(id) ON DELETE CASCADE,
        source_id     UNIQUEIDENTIFIER  NOT NULL  REFERENCES assets(id) ON DELETE NO ACTION,
        target_id     UNIQUEIDENTIFIER  NOT NULL  REFERENCES assets(id) ON DELETE NO ACTION,
        dep_type      NVARCHAR(50)      NOT NULL,
        protocol      NVARCHAR(50)      NULL,
        port          INT               NULL,
        discovered_at DATETIME2         NOT NULL  DEFAULT GETUTCDATE(),
        CONSTRAINT UQ_dep UNIQUE (source_id, target_id, dep_type)
    );
    PRINT '✓ asset_dependencies';
END
GO

-- ── metrics ───────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'metrics')
BEGIN
    CREATE TABLE metrics (
        id           BIGINT            NOT NULL  IDENTITY(1,1)  PRIMARY KEY,
        asset_id     UNIQUEIDENTIFIER  NOT NULL  REFERENCES assets(id) ON DELETE CASCADE,
        tenant_id    UNIQUEIDENTIFIER  NOT NULL,
        metric_name  NVARCHAR(100)     NOT NULL,
        value        FLOAT             NOT NULL,
        unit         NVARCHAR(30)      NULL,
        tags         NVARCHAR(500)     NULL,
        ts           DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );
    PRINT '✓ metrics';
END
GO

-- ── metric_snapshots ──────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'metric_snapshots')
BEGIN
    CREATE TABLE metric_snapshots (
        id              UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        asset_id        UNIQUEIDENTIFIER  NOT NULL  REFERENCES assets(id) ON DELETE CASCADE,
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
        ts              DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );
    PRINT '✓ metric_snapshots';
END
GO

-- ── log_entries ───────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'log_entries')
BEGIN
    CREATE TABLE log_entries (
        id         BIGINT            NOT NULL  IDENTITY(1,1)  PRIMARY KEY,
        asset_id   UNIQUEIDENTIFIER  NULL  REFERENCES assets(id) ON DELETE SET NULL,
        tenant_id  UNIQUEIDENTIFIER  NOT NULL,
        source     NVARCHAR(255)     NULL,
        severity   NVARCHAR(20)      NOT NULL
                     CHECK (severity IN ('debug','info','warning','error','critical')),
        message    NVARCHAR(MAX)     NOT NULL,
        raw_log    NVARCHAR(MAX)     NULL,
        tags       NVARCHAR(500)     NULL,
        ts         DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );
    PRINT '✓ log_entries';
END
GO

-- ── alert_rules ───────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'alert_rules')
BEGIN
    CREATE TABLE alert_rules (
        id                    UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        tenant_id             UNIQUEIDENTIFIER  NOT NULL  REFERENCES tenants(id) ON DELETE CASCADE,
        name                  NVARCHAR(255)     NOT NULL,
        description           NVARCHAR(MAX)     NULL,
        metric_name           NVARCHAR(100)     NULL,
        condition             NVARCHAR(10)      NOT NULL
                                CHECK (condition IN ('gt','lt','gte','lte','eq','neq','anomaly','absent')),
        threshold             FLOAT             NULL,
        duration_secs         INT               NOT NULL  DEFAULT 60,
        severity              NVARCHAR(20)      NOT NULL
                                CHECK (severity IN ('critical','high','medium','low','info')),
        asset_filter          NVARCHAR(MAX)     NULL,
        notification_channels NVARCHAR(MAX)     NULL,
        auto_remediate        BIT               NOT NULL  DEFAULT 0,
        remediation_id        UNIQUEIDENTIFIER  NULL,
        is_enabled            BIT               NOT NULL  DEFAULT 1,
        created_by            UNIQUEIDENTIFIER  NULL  REFERENCES users(id) ON DELETE SET NULL,
        created_at            DATETIME2         NOT NULL  DEFAULT GETUTCDATE(),
        updated_at            DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );
    PRINT '✓ alert_rules';
END
GO

-- ── alerts ────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'alerts')
BEGIN
    CREATE TABLE alerts (
        id               UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        tenant_id        UNIQUEIDENTIFIER  NOT NULL  REFERENCES tenants(id) ON DELETE CASCADE,
        rule_id          UNIQUEIDENTIFIER  NULL  REFERENCES alert_rules(id) ON DELETE SET NULL,
        asset_id         UNIQUEIDENTIFIER  NULL  REFERENCES assets(id) ON DELETE SET NULL,
        title            NVARCHAR(500)     NOT NULL,
        description      NVARCHAR(MAX)     NULL,
        severity         NVARCHAR(20)      NOT NULL
                           CHECK (severity IN ('critical','high','medium','low','info')),
        status           NVARCHAR(20)      NOT NULL  DEFAULT 'open'
                           CHECK (status IN ('open','acknowledged','resolved','suppressed')),
        metric_name      NVARCHAR(100)     NULL,
        metric_value     FLOAT             NULL,
        threshold        FLOAT             NULL,
        triggered_at     DATETIME2         NOT NULL  DEFAULT GETUTCDATE(),
        acknowledged_at  DATETIME2         NULL,
        acknowledged_by  UNIQUEIDENTIFIER  NULL  REFERENCES users(id) ON DELETE SET NULL,
        resolved_at      DATETIME2         NULL,
        resolved_by      UNIQUEIDENTIFIER  NULL  REFERENCES users(id) ON DELETE SET NULL,
        dedup_key        NVARCHAR(255)     NULL,
        ticket_id        NVARCHAR(255)     NULL,
        enrichment       NVARCHAR(MAX)     NULL,
        created_at       DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );
    PRINT '✓ alerts';
END
GO

-- ── incidents ─────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'incidents')
BEGIN
    CREATE TABLE incidents (
        id           UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        tenant_id    UNIQUEIDENTIFIER  NOT NULL  REFERENCES tenants(id) ON DELETE CASCADE,
        title        NVARCHAR(500)     NOT NULL,
        description  NVARCHAR(MAX)     NULL,
        severity     NVARCHAR(10)      NOT NULL
                       CHECK (severity IN ('p1','p2','p3','p4','p5')),
        status       NVARCHAR(30)      NOT NULL  DEFAULT 'open'
                       CHECK (status IN ('open','investigating','mitigated','resolved','closed')),
        assigned_to  UNIQUEIDENTIFIER  NULL  REFERENCES users(id) ON DELETE SET NULL,
        alert_ids    NVARCHAR(MAX)     NULL,
        asset_ids    NVARCHAR(MAX)     NULL,
        ticket_id    NVARCHAR(255)     NULL,
        rca          NVARCHAR(MAX)     NULL,
        timeline     NVARCHAR(MAX)     NULL,
        opened_at    DATETIME2         NOT NULL  DEFAULT GETUTCDATE(),
        resolved_at  DATETIME2         NULL,
        created_by   UNIQUEIDENTIFIER  NULL  REFERENCES users(id) ON DELETE NO ACTION,
        created_at   DATETIME2         NOT NULL  DEFAULT GETUTCDATE(),
        updated_at   DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );
    PRINT '✓ incidents';
END
GO

-- ── maintenance_windows ───────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'maintenance_windows')
BEGIN
    CREATE TABLE maintenance_windows (
        id          UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        tenant_id   UNIQUEIDENTIFIER  NOT NULL  REFERENCES tenants(id) ON DELETE CASCADE,
        name        NVARCHAR(255)     NOT NULL,
        asset_ids   NVARCHAR(MAX)     NULL,
        starts_at   DATETIME2         NOT NULL,
        ends_at     DATETIME2         NOT NULL,
        created_by  UNIQUEIDENTIFIER  NULL  REFERENCES users(id) ON DELETE SET NULL,
        created_at  DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );
    PRINT '✓ maintenance_windows';
END
GO

-- ── automation_playbooks ──────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'automation_playbooks')
BEGIN
    CREATE TABLE automation_playbooks (
        id                UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        tenant_id         UNIQUEIDENTIFIER  NOT NULL  REFERENCES tenants(id) ON DELETE CASCADE,
        name              NVARCHAR(255)     NOT NULL,
        description       NVARCHAR(MAX)     NULL,
        trigger_type      NVARCHAR(50)      NOT NULL
                            CHECK (trigger_type IN ('manual','schedule','alert','webhook','policy_violation','event')),
        trigger_config    NVARCHAR(MAX)     NULL,
        steps             NVARCHAR(MAX)     NOT NULL,
        requires_approval BIT               NOT NULL  DEFAULT 0,
        approvers         NVARCHAR(MAX)     NULL,
        is_enabled        BIT               NOT NULL  DEFAULT 1,
        tags              NVARCHAR(500)     NULL,
        created_by        UNIQUEIDENTIFIER  NULL  REFERENCES users(id) ON DELETE SET NULL,
        created_at        DATETIME2         NOT NULL  DEFAULT GETUTCDATE(),
        updated_at        DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );
    PRINT '✓ automation_playbooks';
END
GO

-- ── automation_runs ───────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'automation_runs')
BEGIN
    CREATE TABLE automation_runs (
        id                  UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        tenant_id           UNIQUEIDENTIFIER  NOT NULL  REFERENCES tenants(id) ON DELETE CASCADE,
        playbook_id         UNIQUEIDENTIFIER  NULL  REFERENCES automation_playbooks(id) ON DELETE SET NULL,
        playbook_name       NVARCHAR(255)     NULL,
        target_asset_id     UNIQUEIDENTIFIER  NULL  REFERENCES assets(id) ON DELETE SET NULL,
        triggered_by        NVARCHAR(100)     NOT NULL,
        triggered_by_user   UNIQUEIDENTIFIER  NULL  REFERENCES users(id) ON DELETE SET NULL,
        status              NVARCHAR(30)      NOT NULL  DEFAULT 'pending'
                              CHECK (status IN ('pending','awaiting_approval','approved','running','success','failed','cancelled','rolled_back')),
        steps_total         INT               NOT NULL  DEFAULT 0,
        steps_completed     INT               NOT NULL  DEFAULT 0,
        output_log          NVARCHAR(MAX)     NULL,
        error_message       NVARCHAR(MAX)     NULL,
        approved_by         UNIQUEIDENTIFIER  NULL  REFERENCES users(id) ON DELETE NO ACTION,
        approved_at         DATETIME2         NULL,
        started_at          DATETIME2         NULL,
        completed_at        DATETIME2         NULL,
        created_at          DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );
    PRINT '✓ automation_runs';
END
GO

-- ── compliance_policies ───────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'compliance_policies')
BEGIN
    CREATE TABLE compliance_policies (
        id          UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        tenant_id   UNIQUEIDENTIFIER  NOT NULL  REFERENCES tenants(id) ON DELETE CASCADE,
        name        NVARCHAR(255)     NOT NULL,
        framework   NVARCHAR(100)     NULL,
        description NVARCHAR(MAX)     NULL,
        rules       NVARCHAR(MAX)     NOT NULL,
        is_enabled  BIT               NOT NULL  DEFAULT 1,
        created_by  UNIQUEIDENTIFIER  NULL  REFERENCES users(id) ON DELETE SET NULL,
        created_at  DATETIME2         NOT NULL  DEFAULT GETUTCDATE(),
        updated_at  DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );
    PRINT '✓ compliance_policies';
END
GO

-- ── compliance_results ────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'compliance_results')
BEGIN
    CREATE TABLE compliance_results (
        id          UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        tenant_id   UNIQUEIDENTIFIER  NOT NULL  REFERENCES tenants(id) ON DELETE CASCADE,
        policy_id   UNIQUEIDENTIFIER  NULL  REFERENCES compliance_policies(id) ON DELETE SET NULL,
        asset_id    UNIQUEIDENTIFIER  NULL  REFERENCES assets(id) ON DELETE SET NULL,
        status      NVARCHAR(20)      NOT NULL
                      CHECK (status IN ('pass','fail','warning','skip','error')),
        score       FLOAT             NULL,
        findings    NVARCHAR(MAX)     NULL,
        checked_at  DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );
    PRINT '✓ compliance_results';
END
GO

-- ── certificates ──────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'certificates')
BEGIN
    CREATE TABLE certificates (
        id             UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        tenant_id      UNIQUEIDENTIFIER  NOT NULL  REFERENCES tenants(id) ON DELETE CASCADE,
        asset_id       UNIQUEIDENTIFIER  NULL  REFERENCES assets(id) ON DELETE SET NULL,
        common_name    NVARCHAR(255)     NOT NULL,
        san            NVARCHAR(MAX)     NULL,
        issuer         NVARCHAR(500)     NULL,
        subject        NVARCHAR(500)     NULL,
        serial_number  NVARCHAR(255)     NULL,
        thumbprint     NVARCHAR(255)     NULL,
        not_before     DATETIME2         NULL,
        not_after      DATETIME2         NULL,
        days_remaining INT               NULL,
        is_expired     BIT               NOT NULL  DEFAULT 0,
        is_self_signed BIT               NOT NULL  DEFAULT 0,
        port           INT               NULL,
        protocol       NVARCHAR(20)      NULL,
        discovered_at  DATETIME2         NOT NULL  DEFAULT GETUTCDATE(),
        last_checked   DATETIME2         NULL
    );
    PRINT '✓ certificates';
END
GO

-- ── cloud_resources ───────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'cloud_resources')
BEGIN
    CREATE TABLE cloud_resources (
        id             UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        tenant_id      UNIQUEIDENTIFIER  NOT NULL  REFERENCES tenants(id) ON DELETE CASCADE,
        asset_id       UNIQUEIDENTIFIER  NULL  REFERENCES assets(id) ON DELETE SET NULL,
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
        created_at     DATETIME2         NOT NULL  DEFAULT GETUTCDATE(),
        updated_at     DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );
    PRINT '✓ cloud_resources';
END
GO

-- ── mobile_devices ────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'mobile_devices')
BEGIN
    CREATE TABLE mobile_devices (
        id                  UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        tenant_id           UNIQUEIDENTIFIER  NOT NULL  REFERENCES tenants(id) ON DELETE CASCADE,
        asset_id            UNIQUEIDENTIFIER  NULL  REFERENCES assets(id) ON DELETE SET NULL,
        device_id           NVARCHAR(255)     NOT NULL,
        name                NVARCHAR(255)     NULL,
        model               NVARCHAR(255)     NULL,
        manufacturer        NVARCHAR(255)     NULL,
        os_type             NVARCHAR(30)      NOT NULL
                              CHECK (os_type IN ('ios','android','windows_mobile','other')),
        os_version          NVARCHAR(100)     NULL,
        mdm_provider        NVARCHAR(100)     NULL,
        mdm_enrolled        BIT               NOT NULL  DEFAULT 0,
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
        created_at          DATETIME2         NOT NULL  DEFAULT GETUTCDATE(),
        updated_at          DATETIME2         NOT NULL  DEFAULT GETUTCDATE(),
        CONSTRAINT UQ_mobile_device UNIQUE (tenant_id, device_id)
    );
    PRINT '✓ mobile_devices';
END
GO

-- ── integrations ──────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'integrations')
BEGIN
    CREATE TABLE integrations (
        id           UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        tenant_id    UNIQUEIDENTIFIER  NOT NULL  REFERENCES tenants(id) ON DELETE CASCADE,
        name         NVARCHAR(255)     NOT NULL,
        type         NVARCHAR(50)      NOT NULL,
        config       NVARCHAR(MAX)     NULL,
        credentials  NVARCHAR(MAX)     NULL,
        is_enabled   BIT               NOT NULL  DEFAULT 1,
        last_sync    DATETIME2         NULL,
        sync_status  NVARCHAR(30)      NULL,
        created_by   UNIQUEIDENTIFIER  NULL  REFERENCES users(id) ON DELETE SET NULL,
        created_at   DATETIME2         NOT NULL  DEFAULT GETUTCDATE(),
        updated_at   DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );
    PRINT '✓ integrations';
END
GO

-- ── reports ───────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'reports')
BEGIN
    CREATE TABLE reports (
        id            UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        tenant_id     UNIQUEIDENTIFIER  NOT NULL  REFERENCES tenants(id) ON DELETE CASCADE,
        name          NVARCHAR(255)     NOT NULL,
        report_type   NVARCHAR(100)     NOT NULL,
        filters       NVARCHAR(MAX)     NULL,
        schedule      NVARCHAR(100)     NULL,
        output_format NVARCHAR(20)      NOT NULL  DEFAULT 'json',
        last_run      DATETIME2         NULL,
        last_result   NVARCHAR(MAX)     NULL,
        created_by    UNIQUEIDENTIFIER  NULL  REFERENCES users(id) ON DELETE SET NULL,
        created_at    DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );
    PRINT '✓ reports';
END
GO

-- ── dashboards ────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'dashboards')
BEGIN
    CREATE TABLE dashboards (
        id          UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        tenant_id   UNIQUEIDENTIFIER  NOT NULL  REFERENCES tenants(id) ON DELETE CASCADE,
        user_id     UNIQUEIDENTIFIER  NULL  REFERENCES users(id) ON DELETE SET NULL,
        name        NVARCHAR(255)     NOT NULL,
        layout      NVARCHAR(MAX)     NULL,
        widgets     NVARCHAR(MAX)     NULL,
        is_default  BIT               NOT NULL  DEFAULT 0,
        is_shared   BIT               NOT NULL  DEFAULT 0,
        created_at  DATETIME2         NOT NULL  DEFAULT GETUTCDATE(),
        updated_at  DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );
    PRINT '✓ dashboards';
END
GO

-- ============================================================
-- 3. INDEXES
-- ============================================================
PRINT '';
PRINT 'Creating indexes...';

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_users_email')
    CREATE INDEX IX_users_email ON users(email);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_users_tenant')
    CREATE INDEX IX_users_tenant ON users(tenant_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_sessions_user')
    CREATE INDEX IX_sessions_user ON sessions(user_id, is_revoked);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_audit_tenant_ts')
    CREATE INDEX IX_audit_tenant_ts ON audit_log(tenant_id, created_at DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_sites_tenant')
    CREATE INDEX IX_sites_tenant ON sites(tenant_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_assets_tenant')
    CREATE INDEX IX_assets_tenant ON assets(tenant_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_assets_status')
    CREATE INDEX IX_assets_status ON assets(tenant_id, status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_assets_type')
    CREATE INDEX IX_assets_type ON assets(tenant_id, asset_type);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_assets_site')
    CREATE INDEX IX_assets_site ON assets(site_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_assets_agent')
    CREATE UNIQUE INDEX IX_assets_agent ON assets(agent_id) WHERE agent_id IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_metrics_asset_ts')
    CREATE INDEX IX_metrics_asset_ts ON metrics(asset_id, ts DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_metrics_tenant_ts')
    CREATE INDEX IX_metrics_tenant_ts ON metrics(tenant_id, ts DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_snaps_asset_ts')
    CREATE INDEX IX_snaps_asset_ts ON metric_snapshots(asset_id, ts DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_logs_asset_ts')
    CREATE INDEX IX_logs_asset_ts ON log_entries(asset_id, ts DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_logs_tenant_ts')
    CREATE INDEX IX_logs_tenant_ts ON log_entries(tenant_id, ts DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_alerts_tenant_stat')
    CREATE INDEX IX_alerts_tenant_stat ON alerts(tenant_id, status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_alerts_asset')
    CREATE INDEX IX_alerts_asset ON alerts(asset_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_mobile_tenant')
    CREATE INDEX IX_mobile_tenant ON mobile_devices(tenant_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_cloud_tenant')
    CREATE INDEX IX_cloud_tenant ON cloud_resources(tenant_id, provider);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_certs_tenant_exp')
    CREATE INDEX IX_certs_tenant_exp ON certificates(tenant_id, not_after);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_agent_tokens_hash')
    CREATE INDEX IX_agent_tokens_hash ON agent_tokens(token_hash);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_compliance_results_policy')
    CREATE INDEX IX_compliance_results_policy ON compliance_results(tenant_id, policy_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_automation_runs_playbook')
    CREATE INDEX IX_automation_runs_playbook ON automation_runs(tenant_id, playbook_id);

PRINT '✓ All indexes created.';
GO

-- ============================================================
-- 4. SEED DATA
-- ============================================================
PRINT '';
PRINT 'Seeding default data...';

DECLARE @tenantId   UNIQUEIDENTIFIER = NEWID();
DECLARE @adminId    UNIQUEIDENTIFIER = NEWID();
DECLARE @taId       UNIQUEIDENTIFIER = NEWID();
DECLARE @opId       UNIQUEIDENTIFIER = NEWID();
DECLARE @viewerId   UNIQUEIDENTIFIER = NEWID();

-- ── Tenant ───────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM tenants WHERE slug = 'vanguard')
BEGIN
    INSERT INTO tenants (id, name, slug)
    VALUES (@tenantId, 'Vanguard Corp', 'vanguard');
    PRINT '✓ Tenant: Vanguard Corp';
END
ELSE
BEGIN
    SELECT @tenantId = id FROM tenants WHERE slug = 'vanguard';
    PRINT '  Tenant already exists — using existing id.';
END

-- ── Users ────────────────────────────────────────────────────
-- bcrypt hash of 'changeme' at 12 rounds
DECLARE @hash NVARCHAR(255) = '$2a$12$emeHCcUMnGbSgMGNp7XVCO2bnBvxAEOV.7Y4cTGX.AWLQB6I3Xrq';

IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'superadmin@vanguardos.io')
BEGIN
    INSERT INTO users (id, tenant_id, email, display_name, password_hash)
    VALUES (@adminId, @tenantId, 'superadmin@vanguardos.io', 'System Administrator', @hash);
    INSERT INTO user_roles (user_id, tenant_id, role)
    VALUES (@adminId, @tenantId, 'super_admin');
    PRINT '✓ User: superadmin@vanguardos.io (super_admin)';
END
ELSE
    SELECT @adminId = id FROM users WHERE email = 'superadmin@vanguardos.io';

IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'admin@vanguardos.io')
BEGIN
    INSERT INTO users (id, tenant_id, email, display_name, password_hash)
    VALUES (@taId, @tenantId, 'admin@vanguardos.io', 'Tenant Administrator', @hash);
    INSERT INTO user_roles (user_id, tenant_id, role)
    VALUES (@taId, @tenantId, 'tenant_admin');
    PRINT '✓ User: admin@vanguardos.io (tenant_admin)';
END

IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'operator@vanguardos.io')
BEGIN
    INSERT INTO users (id, tenant_id, email, display_name, password_hash)
    VALUES (@opId, @tenantId, 'operator@vanguardos.io', 'Demo Operator', @hash);
    INSERT INTO user_roles (user_id, tenant_id, role)
    VALUES (@opId, @tenantId, 'operator');
    PRINT '✓ User: operator@vanguardos.io (operator)';
END

IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'viewer@vanguardos.io')
BEGIN
    INSERT INTO users (id, tenant_id, email, display_name, password_hash)
    VALUES (@viewerId, @tenantId, 'viewer@vanguardos.io', 'Demo Viewer', @hash);
    INSERT INTO user_roles (user_id, tenant_id, role)
    VALUES (@viewerId, @tenantId, 'viewer');
    PRINT '✓ User: viewer@vanguardos.io (viewer)';
END

-- ── Sites ─────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sites WHERE tenant_id = @tenantId AND code = 'ADC')
    INSERT INTO sites (tenant_id, name, code, type, location, latitude, longitude)
    VALUES (@tenantId, 'Austin Datacenter', 'ADC', 'datacenter', 'Austin, TX', 30.2672, -97.7431);

IF NOT EXISTS (SELECT 1 FROM sites WHERE tenant_id = @tenantId AND code = 'SDC')
    INSERT INTO sites (tenant_id, name, code, type, location, latitude, longitude)
    VALUES (@tenantId, 'San Angelo Datacenter', 'SDC', 'datacenter', 'San Angelo, TX', 31.4638, -100.4370);

IF NOT EXISTS (SELECT 1 FROM sites WHERE tenant_id = @tenantId AND code = 'LDC-ANNEX')
    INSERT INTO sites (tenant_id, name, code, type, location, latitude, longitude)
    VALUES (@tenantId, 'LDC Annex', 'LDC-ANNEX', 'datacenter', 'Austin, TX', 30.2730, -97.7401);

IF NOT EXISTS (SELECT 1 FROM sites WHERE tenant_id = @tenantId AND code = 'LDC-MOPAC')
    INSERT INTO sites (tenant_id, name, code, type, location, latitude, longitude)
    VALUES (@tenantId, 'LDC Mopac', 'LDC-MOPAC', 'datacenter', 'Austin, TX', 30.3070, -97.7401);

IF NOT EXISTS (SELECT 1 FROM sites WHERE tenant_id = @tenantId AND code = 'AWS')
    INSERT INTO sites (tenant_id, name, code, type, provider, location)
    VALUES (@tenantId, 'Amazon Web Services', 'AWS', 'cloud', 'AWS', 'us-east-1');

IF NOT EXISTS (SELECT 1 FROM sites WHERE tenant_id = @tenantId AND code = 'AZURE')
    INSERT INTO sites (tenant_id, name, code, type, provider, location)
    VALUES (@tenantId, 'Microsoft Azure', 'AZURE', 'cloud', 'Azure', 'eastus');

IF NOT EXISTS (SELECT 1 FROM sites WHERE tenant_id = @tenantId AND code = 'GCP')
    INSERT INTO sites (tenant_id, name, code, type, provider, location)
    VALUES (@tenantId, 'Google Cloud Platform', 'GCP', 'cloud', 'GCP', 'us-central1');

PRINT '✓ Sites (7)';

-- ── Default Alert Rules ───────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM alert_rules WHERE tenant_id = @tenantId AND name = 'High CPU')
    INSERT INTO alert_rules (tenant_id, name, description, metric_name, condition, threshold, duration_secs, severity, created_by)
    VALUES (@tenantId, 'High CPU', 'Alert when CPU exceeds 90% for 5 minutes', 'cpu_pct', 'gt', 90, 300, 'high', @adminId);

IF NOT EXISTS (SELECT 1 FROM alert_rules WHERE tenant_id = @tenantId AND name = 'Low Disk Space')
    INSERT INTO alert_rules (tenant_id, name, description, metric_name, condition, threshold, duration_secs, severity, created_by)
    VALUES (@tenantId, 'Low Disk Space', 'Alert when disk usage exceeds 85%', 'disk_pct', 'gt', 85, 60, 'critical', @adminId);

IF NOT EXISTS (SELECT 1 FROM alert_rules WHERE tenant_id = @tenantId AND name = 'High Memory')
    INSERT INTO alert_rules (tenant_id, name, description, metric_name, condition, threshold, duration_secs, severity, created_by)
    VALUES (@tenantId, 'High Memory', 'Alert when memory usage exceeds 95%', 'mem_pct', 'gt', 95, 120, 'high', @adminId);

IF NOT EXISTS (SELECT 1 FROM alert_rules WHERE tenant_id = @tenantId AND name = 'Agent Not Reporting')
    INSERT INTO alert_rules (tenant_id, name, description, metric_name, condition, threshold, duration_secs, severity, created_by)
    VALUES (@tenantId, 'Agent Not Reporting', 'Alert when managed agent stops checking in', NULL, 'absent', NULL, 900, 'critical', @adminId);

PRINT '✓ Alert rules (4)';

-- ── Default Notification Channel ─────────────────────────────
IF NOT EXISTS (SELECT 1 FROM notification_channels WHERE tenant_id = @tenantId AND name = 'Default Email')
    INSERT INTO notification_channels (tenant_id, name, type, config)
    VALUES (@tenantId, 'Default Email', 'email', '{"to":"ops@vanguardos.io"}');

PRINT '✓ Notification channel: Default Email';

-- ── Default Dashboard ─────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dashboards WHERE tenant_id = @tenantId AND is_default = 1)
    INSERT INTO dashboards (tenant_id, user_id, name, is_default, is_shared, widgets)
    VALUES (@tenantId, @adminId, 'Operations Overview', 1, 1,
    '{"widgets":[{"id":"w1","type":"asset_summary","position":{"x":0,"y":0,"w":4,"h":2}},{"id":"w2","type":"alert_summary","position":{"x":4,"y":0,"w":4,"h":2}},{"id":"w3","type":"top_cpu","position":{"x":0,"y":2,"w":6,"h":3}},{"id":"w4","type":"recent_alerts","position":{"x":6,"y":2,"w":6,"h":3}}]}');

PRINT '✓ Default dashboard';
GO

-- ============================================================
-- 5. VERIFY
-- ============================================================
PRINT '';
PRINT '============================================================';
PRINT ' VERIFICATION — Table row counts';
PRINT '============================================================';

SELECT 'tenants'               AS [Table], COUNT(*) AS [Rows] FROM tenants              UNION ALL
SELECT 'users',                             COUNT(*)           FROM users                UNION ALL
SELECT 'user_roles',                        COUNT(*)           FROM user_roles           UNION ALL
SELECT 'sites',                             COUNT(*)           FROM sites                UNION ALL
SELECT 'alert_rules',                       COUNT(*)           FROM alert_rules          UNION ALL
SELECT 'notification_channels',             COUNT(*)           FROM notification_channels UNION ALL
SELECT 'dashboards',                        COUNT(*)           FROM dashboards           UNION ALL
SELECT 'assets',                            COUNT(*)           FROM assets               UNION ALL
SELECT 'alerts',                            COUNT(*)           FROM alerts               UNION ALL
SELECT 'incidents',                         COUNT(*)           FROM incidents            UNION ALL
SELECT 'automation_playbooks',              COUNT(*)           FROM automation_playbooks UNION ALL
SELECT 'compliance_policies',               COUNT(*)           FROM compliance_policies  UNION ALL
SELECT 'certificates',                      COUNT(*)           FROM certificates         UNION ALL
SELECT 'cloud_resources',                   COUNT(*)           FROM cloud_resources      UNION ALL
SELECT 'mobile_devices',                    COUNT(*)           FROM mobile_devices       UNION ALL
SELECT 'integrations',                      COUNT(*)           FROM integrations;

PRINT '';
PRINT '============================================================';
PRINT ' SETUP COMPLETE';
PRINT ' Login: superadmin@vanguardos.io / changeme';
PRINT ' WARNING: Change all passwords before going to production!';
PRINT '============================================================';
GO
