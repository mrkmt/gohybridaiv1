import { DbClient, TelemetryService } from './TelemetryService';

export class MigrationManager {
    private static migrations: { version: number, name: string, sql: string | ((pool: DbClient) => Promise<void>) }[] = [
        {
            version: 1,
            name: 'Initial Schema',
            sql: `
                CREATE TABLE IF NOT EXISTS recordings (
                    id UUID PRIMARY KEY,
                    session_id VARCHAR(255),
                    app_version VARCHAR(50),
                    environment JSONB,
                    steps JSONB,
                    network_requests JSONB,
                    video_url TEXT,
                    screenshot_url TEXT,
                    manual_snapshot_url TEXT,
                    annotations JSONB DEFAULT '[]',
                    expected_results JSONB DEFAULT '{}',
                    is_admin BOOLEAN DEFAULT false,
                    jira_id VARCHAR(50),
                    test_url TEXT,
                    user_id VARCHAR(255) DEFAULT 'public',
                    status VARCHAR(20) DEFAULT 'passed',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS ai_logs (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(255),
                    recording_id UUID REFERENCES recordings(id) ON DELETE CASCADE,
                    model VARCHAR(50),
                    prompt TEXT,
                    response TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS cache (
                    key VARCHAR(255) PRIMARY KEY,
                    value JSONB,
                    expires_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS object_repository (
                    id VARCHAR(255) PRIMARY KEY,
                    name VARCHAR(255),
                    app_profile VARCHAR(50) DEFAULT 'default',
                    platform VARCHAR(50) DEFAULT 'web',
                    selector_primary TEXT NOT NULL,
                    selector_fallbacks JSONB DEFAULT '[]',
                    locator_type VARCHAR(50) DEFAULT 'css',
                    confidence FLOAT DEFAULT 0.8,
                    reliability_score FLOAT DEFAULT 1.0,
                    last_verified_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS ai_actions (
                    id SERIAL PRIMARY KEY,
                    recording_id UUID REFERENCES recordings(id) ON DELETE CASCADE,
                    action_type VARCHAR(50),
                    params JSONB,
                    result JSONB,
                    status VARCHAR(20),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS users (
                    id VARCHAR(255) PRIMARY KEY,
                    owner_id VARCHAR(255),
                    display_name VARCHAR(255),
                    role VARCHAR(50) DEFAULT 'owner',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS extension_settings (
                    owner_id VARCHAR(255) PRIMARY KEY,
                    active_user_id VARCHAR(255),
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `
        },
        {
            version: 2,
            name: 'Telemetry and Indexes',
            sql: `
                CREATE TABLE IF NOT EXISTS telemetry_logs (
                    id VARCHAR(255) PRIMARY KEY,
                    timestamp TIMESTAMP,
                    category VARCHAR(20),
                    source VARCHAR(255),
                    message TEXT,
                    metadata JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_recordings_created_at ON recordings(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_recordings_user_id ON recordings(user_id);
                CREATE INDEX IF NOT EXISTS idx_ai_logs_recording_id ON ai_logs(recording_id);
                CREATE INDEX IF NOT EXISTS idx_ai_logs_created_at ON ai_logs(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_telemetry_logs_created_at ON telemetry_logs(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_telemetry_logs_category ON telemetry_logs(category);
                CREATE INDEX IF NOT EXISTS idx_telemetry_logs_source ON telemetry_logs(source);
            `
        },
        {
            version: 3,
            name: 'Schema Normalization',
            sql: async (pool: DbClient) => {
                try {
                    const { rows } = await pool.query(`
                        SELECT column_name, data_type
                        FROM information_schema.columns
                        WHERE table_name = 'recordings'
                          AND column_name IN ('environment', 'status', 'test_url', 'steps')
                    `);

                    const columnTypes = new Map<string, string>();
                    rows.forEach((row: any) => columnTypes.set(row.column_name, row.data_type));

                    if (columnTypes.get('environment') === 'json' || columnTypes.get('environment') === 'jsonb') {
                        await pool.query(`
                            ALTER TABLE recordings
                            ALTER COLUMN environment TYPE VARCHAR(20)
                            USING trim(both '"' from environment::text)
                        `);
                    }

                    if (columnTypes.get('status') === 'json' || columnTypes.get('status') === 'jsonb') {
                        await pool.query(`
                            ALTER TABLE recordings
                            ALTER COLUMN status TYPE VARCHAR(20)
                            USING trim(both '"' from status::text)
                        `);
                    }

                    if (columnTypes.get('test_url') === 'json' || columnTypes.get('test_url') === 'jsonb') {
                        await pool.query(`
                            ALTER TABLE recordings
                            ALTER COLUMN test_url TYPE TEXT
                            USING trim(both '"' from test_url::text)
                        `);
                    }

                    if (columnTypes.get('steps') && columnTypes.get('steps') !== 'jsonb') {
                        await pool.query(`
                            ALTER TABLE recordings
                            ALTER COLUMN steps TYPE JSONB
                            USING CASE
                                WHEN steps IS NULL THEN '{}'::jsonb
                                ELSE steps::jsonb
                            END
                        `);
                    }
                } catch (e) {
                    process.stdout.write(`[DB] Schema normalization warning: ${e}\n`);
                }
            }
        },
        {
            version: 4,
            name: 'Chat Sessions',
            sql: `
                CREATE TABLE IF NOT EXISTS chat_sessions (
                    id VARCHAR(255) PRIMARY KEY,
                    title VARCHAR(255) NOT NULL,
                    messages JSONB DEFAULT '[]',
                    jira_id VARCHAR(50),
                    last_modified BIGINT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `
        },
        {
            version: 5,
            name: 'Investigation Drafts',
            sql: `
                CREATE TABLE IF NOT EXISTS investigation_drafts (
                    jira_id VARCHAR(50) PRIMARY KEY,
                    phase INTEGER DEFAULT 1,
                    steps JSONB DEFAULT '[]',
                    credentials JSONB DEFAULT '{}',
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `
        },
        {
            version: 7,
            name: 'Autonomous Rules Engine',
            sql: `
                CREATE TABLE IF NOT EXISTS rules (
                    id SERIAL PRIMARY KEY,
                    module_name VARCHAR(255) UNIQUE NOT NULL,
                    description TEXT,
                    keywords JSONB DEFAULT '[]',
                    mandatory_fields JSONB DEFAULT '[]',
                    navigation_id VARCHAR(255),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_rules_module_name ON rules(module_name);
            `
        },
        {
            version: 8,
            name: 'Multi-User Auth & Audit',
            sql: `
                -- Enhance users table for authentication
                ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
                ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
                ALTER TABLE users ALTER COLUMN role SET DEFAULT 'tester';
                ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
                ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
                CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;

                -- Audit log table
                CREATE TABLE IF NOT EXISTS audit_logs (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
                    action VARCHAR(100) NOT NULL,
                    resource_type VARCHAR(50),
                    resource_id VARCHAR(255),
                    details JSONB,
                    ip_address VARCHAR(45),
                    user_agent TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON audit_logs(user_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

                -- DB-backed test sessions (replaces in-memory cache)
                CREATE TABLE IF NOT EXISTS test_sessions (
                    id UUID PRIMARY KEY,
                    ticket_id VARCHAR(50) NOT NULL,
                    user_id VARCHAR(255) REFERENCES users(id),
                    summary TEXT,
                    description TEXT,
                    status VARCHAR(20) DEFAULT 'in_progress',
                    phase VARCHAR(30) DEFAULT 'init',
                    test_cases JSONB DEFAULT '[]',
                    results JSONB DEFAULT '[]',
                    environment JSONB,
                    jira_snapshot JSONB,
                    artifacts_path TEXT,
                    version INTEGER DEFAULT 1,
                    history JSONB DEFAULT '[]',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_test_sessions_user ON test_sessions(user_id);
                CREATE INDEX IF NOT EXISTS idx_test_sessions_ticket ON test_sessions(ticket_id);
                CREATE INDEX IF NOT EXISTS idx_test_sessions_status ON test_sessions(status);
            `
        },
        {
            version: 9,
            name: 'Business Rules Table',
            sql: `
                CREATE TABLE IF NOT EXISTS business_rules (
                    id VARCHAR(64) PRIMARY KEY,
                    module VARCHAR(128) NOT NULL,
                    sub_module VARCHAR(128),
                    keywords TEXT[] DEFAULT '{}',
                    formula_rule TEXT,
                    expected_ui_behavior TEXT,
                    confidence_score DECIMAL(3,2) DEFAULT 0.9,
                    status VARCHAR(32),
                    jira_id VARCHAR(32),
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_business_rules_module ON business_rules(module);
                CREATE INDEX IF NOT EXISTS idx_business_rules_jira ON business_rules(jira_id);
                CREATE INDEX IF NOT EXISTS idx_business_rules_keywords ON business_rules USING GIN(keywords);
            `
        },
        {
            version: 10,
            name: 'Test Sessions Running Flag',
            sql: `
                ALTER TABLE test_sessions ADD COLUMN IF NOT EXISTS is_running BOOLEAN DEFAULT false;
            `
        },
        {
            version: 11,
            name: 'Active Tickers Columns',
            sql: `
                CREATE TABLE IF NOT EXISTS active_tickers (
                    id SERIAL PRIMARY KEY,
                    ticker VARCHAR(50) NOT NULL,
                    name VARCHAR(255),
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                ALTER TABLE active_tickers ADD COLUMN IF NOT EXISTS url TEXT;
                ALTER TABLE active_tickers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
            `
        },
        {
            version: 12,
            name: 'Test Sessions Confidence Assessment',
            sql: `
                ALTER TABLE test_sessions ADD COLUMN IF NOT EXISTS confidence_assessment JSONB;
            `
        },
        {
            version: 13,
            name: 'Rename active_tickers to active_tickets (typo fix)',
            sql: `
                ALTER TABLE IF EXISTS active_tickers RENAME TO active_tickets;
                ALTER TABLE active_tickets ADD COLUMN IF NOT EXISTS ticket_id TEXT;
                ALTER TABLE active_tickets ADD COLUMN IF NOT EXISTS summary TEXT;
                ALTER TABLE active_tickets ADD COLUMN IF NOT EXISTS description TEXT;
                ALTER TABLE active_tickets ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Unknown';
                ALTER TABLE active_tickets ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'Medium';
                ALTER TABLE active_tickets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
                CREATE UNIQUE INDEX IF NOT EXISTS idx_active_tickets_ticket_id ON active_tickets(ticket_id);
            `
        },
        {
            version: 14,
            name: 'Test Versions & Visual Baselines',
            sql: async (pool: DbClient) => {
                // Drop old test_versions table from v6 (different schema) and recreate
                await pool.query(`DROP TABLE IF EXISTS test_versions CASCADE`);
                await pool.query(`
                    CREATE TABLE test_versions (
                        id SERIAL PRIMARY KEY,
                        ticket_id TEXT NOT NULL,
                        case_id TEXT NOT NULL,
                        version INTEGER NOT NULL,
                        script_content TEXT NOT NULL,
                        artifacts JSONB,
                        status VARCHAR(10) NOT NULL DEFAULT 'PASS',
                        baseline_screenshot TEXT,
                        execution_time_ms INTEGER,
                        error_message TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                await pool.query(`CREATE INDEX IF NOT EXISTS idx_test_versions_ticket_id ON test_versions(ticket_id)`);
                await pool.query(`CREATE INDEX IF NOT EXISTS idx_test_versions_version ON test_versions(version)`);

                await pool.query(`
                    CREATE TABLE IF NOT EXISTS visual_baselines (
                        id SERIAL PRIMARY KEY,
                        ticket_id TEXT NOT NULL,
                        case_id TEXT NOT NULL,
                        step_number INTEGER NOT NULL,
                        baseline_path TEXT NOT NULL,
                        baseline_hash VARCHAR(64) NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(ticket_id, case_id, step_number)
                    )
                `);
            }
        },
        {
            version: 15,
            name: 'Staging Rules & Test Users & Jira Config',
            sql: `
                CREATE TABLE IF NOT EXISTS staging_rules (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    module VARCHAR(128) NOT NULL,
                    sub_module VARCHAR(128),
                    keywords TEXT[],
                    formula_rule TEXT,
                    expected_ui_behavior TEXT,
                    confidence_score DECIMAL(3,2),
                    status VARCHAR(32),
                    jira_id VARCHAR(32),
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_staging_rules_status ON staging_rules(status);
                CREATE INDEX IF NOT EXISTS idx_staging_rules_keywords ON staging_rules USING GIN(keywords);

                -- Test Users (credential vault)
                CREATE TABLE IF NOT EXISTS test_users (
                    id SERIAL PRIMARY KEY,
                    role VARCHAR(32) NOT NULL,
                    environment VARCHAR(16) NOT NULL,
                    id_number VARCHAR(64),
                    username VARCHAR(128) NOT NULL,
                    password TEXT NOT NULL,
                    base_url TEXT,
                    customer_id VARCHAR(64),
                    is_default BOOLEAN DEFAULT false,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE(role, environment)
                );

                -- Jira Config
                CREATE TABLE IF NOT EXISTS jira_config (
                    id SERIAL PRIMARY KEY,
                    domain VARCHAR(128),
                    email VARCHAR(128),
                    api_token TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
            `
        },
        {
            version: 16,
            name: 'API Keys',
            sql: `
                CREATE TABLE IF NOT EXISTS api_keys (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    key_hash VARCHAR(255) NOT NULL UNIQUE,
                    display_name VARCHAR(128),
                    active BOOLEAN DEFAULT true,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    last_used_at TIMESTAMPTZ
                );
                CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
            `
        },
        {
            version: 17,
            name: 'Test Execution Analytics',
            sql: `
                CREATE TABLE IF NOT EXISTS test_executions (
                    id SERIAL PRIMARY KEY,
                    ticket_id VARCHAR(50) NOT NULL,
                    test_case_id VARCHAR(100),
                    module_name VARCHAR(100),
                    status VARCHAR(20) NOT NULL,
                    duration_ms INTEGER,
                    error_category VARCHAR(50),
                    error_message TEXT,
                    is_flaky BOOLEAN DEFAULT false,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_test_exec_ticket ON test_executions(ticket_id);
                CREATE INDEX IF NOT EXISTS idx_test_exec_module ON test_executions(module_name);
                CREATE INDEX IF NOT EXISTS idx_test_exec_status ON test_executions(status);
                CREATE INDEX IF NOT EXISTS idx_test_exec_created ON test_executions(created_at DESC);
            `
        },
        {
            version: 18,
            name: 'Healing Counters',
            sql: `
                CREATE TABLE IF NOT EXISTS healing_counters (
                    id SERIAL PRIMARY KEY,
                    ticket_id TEXT NOT NULL,
                    case_id TEXT NOT NULL,
                    error_signature TEXT NOT NULL,
                    count INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 hour')
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_healing_counters_unique
                    ON healing_counters (ticket_id, case_id, error_signature);
                CREATE INDEX IF NOT EXISTS idx_healing_counters_expires_at
                    ON healing_counters (expires_at);
                CREATE INDEX IF NOT EXISTS idx_healing_counters_ticket_case
                    ON healing_counters (ticket_id, case_id);
            `
        },
        {
            version: 19,
            name: 'Vector Knowledge Base',
            sql: `
                CREATE EXTENSION IF NOT EXISTS vector;
                CREATE TABLE IF NOT EXISTS knowledge_vectors (
                    id SERIAL PRIMARY KEY,
                    content TEXT NOT NULL,
                    category VARCHAR(50),
                    metadata JSONB,
                    embedding vector(768), -- 768 dimensions for nomic-embed-text-v1.5
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_category ON knowledge_vectors(category);
            `
        },
        {
            version: 20,
            name: 'Skill Patterns Storage',
            sql: `
                CREATE TABLE IF NOT EXISTS skill_patterns (
                    id VARCHAR(255) PRIMARY KEY,
                    type VARCHAR(50) NOT NULL,
                    module VARCHAR(100),
                    issue_type VARCHAR(50),
                    selectors JSONB,
                    workflow JSONB,
                    checklist JSONB,
                    learned_patterns JSONB,
                    version INTEGER DEFAULT 1,
                    success_rate NUMERIC(5,4) DEFAULT 1.0,
                    change_log JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_skill_patterns_module ON skill_patterns(module);
                CREATE INDEX IF NOT EXISTS idx_skill_patterns_type ON skill_patterns(type);
            `
        },
        {
            version: 21,
            name: 'Autonomous Navigation & Workflow Mapping',
            sql: `
                -- Stores the results of the Right Menu Crawler
                CREATE TABLE IF NOT EXISTS module_route_map (
                    id SERIAL PRIMARY KEY,
                    module_name VARCHAR(255) UNIQUE NOT NULL,
                    parent_menu VARCHAR(255),
                    full_path TEXT NOT NULL,
                    url TEXT NOT NULL,
                    is_kendo BOOLEAN DEFAULT true,
                    last_crawled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                -- Stores pre-scanned workflow states (Required fields, Toast triggers)
                CREATE TABLE IF NOT EXISTS workflow_rules (
                    id SERIAL PRIMARY KEY,
                    module_name VARCHAR(255) REFERENCES module_route_map(module_name) ON DELETE CASCADE,
                    action_type VARCHAR(50) NOT NULL, -- e.g. 'ADD_NEW', 'EDIT', 'DELETE'
                    required_fields JSONB DEFAULT '[]',
                    optional_fields JSONB DEFAULT '[]',
                    success_toast_pattern TEXT,
                    error_toast_pattern TEXT,
                    restriction_rules JSONB DEFAULT '[]',
                    discovered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(module_name, action_type)
                );

                CREATE INDEX IF NOT EXISTS idx_route_map_name ON module_route_map(module_name);
                CREATE INDEX IF NOT EXISTS idx_workflow_rules_module ON workflow_rules(module_name);
            `
        },
        {
            version: 22,
            name: 'Add comments to test_sessions',
            sql: `ALTER TABLE test_sessions ADD COLUMN IF NOT EXISTS comments JSONB DEFAULT '[]';`
        },
        {
            version: 23,
            name: 'Performance Optimization Indexes',
            sql: `
                -- Recommended indexes from System Audit
                CREATE INDEX IF NOT EXISTS idx_test_executions_created_at ON test_executions(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_recordings_status_created ON recordings(status, created_at);
                CREATE INDEX IF NOT EXISTS idx_test_sessions_ticket_user ON test_sessions(ticket_id, user_id);
                CREATE INDEX IF NOT EXISTS idx_skill_patterns_module_type_rate ON skill_patterns(module, type, success_rate);

                -- Additional missing indexes for stability
                CREATE INDEX IF NOT EXISTS idx_test_executions_error_cat ON test_executions(error_category) WHERE error_category IS NOT NULL;
                CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created ON audit_logs(action, created_at DESC);
            `
        },
        {
            version: 24,
            name: 'Jira Settings — Multi-Space & Per-User Config',
            sql: `
                -- Extend jira_config for per-user multi-space support
                ALTER TABLE jira_config
                    ADD COLUMN IF NOT EXISTS user_id         VARCHAR(255) DEFAULT 'admin',
                    ADD COLUMN IF NOT EXISTS site_name       VARCHAR(255),
                    ADD COLUMN IF NOT EXISTS gt_project_key  VARCHAR(50),
                    ADD COLUMN IF NOT EXISTS gb_project_key  VARCHAR(50),
                    ADD COLUMN IF NOT EXISTS gd_project_key  VARCHAR(50),
                    ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ DEFAULT NOW();

                -- Unique config per user (one Jira connection per user)
                CREATE UNIQUE INDEX IF NOT EXISTS jira_config_user_idx ON jira_config(user_id);

                -- Migrate existing env-sourced row if present (best-effort)
                UPDATE jira_config SET user_id = 'admin', updated_at = NOW()
                WHERE user_id IS NULL OR user_id = '';

                -- Stale session auto-reclaim: index for efficient cleanup queries
                CREATE INDEX IF NOT EXISTS idx_test_sessions_phase_updated
                    ON test_sessions(phase, updated_at)
                    WHERE phase IN ('in_progress', 'executing', 'generating');
            `
        },
        {
            version: 25,
            name: 'Script Library — saved test scripts',
            sql: `
                -- Stores passing Playwright scripts for reuse without re-running AI
                CREATE TABLE IF NOT EXISTS test_scripts (
                    id            SERIAL PRIMARY KEY,
                    ticket_id     VARCHAR(50)  NOT NULL,
                    scenario_id   VARCHAR(100) NOT NULL,
                    module_name   VARCHAR(128),
                    script        TEXT         NOT NULL,
                    selector_hash VARCHAR(64),   -- SHA-256 of the discovery snapshot; detect UI drift
                    status        VARCHAR(10)  NOT NULL DEFAULT 'PASS', -- PASS | FAIL
                    run_count     INTEGER      NOT NULL DEFAULT 1,
                    last_run_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                    UNIQUE (ticket_id, scenario_id)
                );
                CREATE INDEX IF NOT EXISTS idx_test_scripts_ticket ON test_scripts(ticket_id);
                CREATE INDEX IF NOT EXISTS idx_test_scripts_module ON test_scripts(module_name);
                CREATE INDEX IF NOT EXISTS idx_test_scripts_status ON test_scripts(status);
                CREATE INDEX IF NOT EXISTS idx_test_scripts_selector_hash ON test_scripts(selector_hash);
            `
        },
        {
            version: 26,
            name: 'Sprint Regression — runs and results',
            sql: `
                -- Tracks a single sprint regression run (all tickets in a sprint)
                CREATE TABLE IF NOT EXISTS sprint_runs (
                    id              SERIAL PRIMARY KEY,
                    sprint_id       VARCHAR(128)  NOT NULL,  -- Jira sprint ID (numeric string)
                    sprint_name     VARCHAR(255),             -- human-readable, from Jira API
                    project_key     VARCHAR(50),              -- e.g. "GT" — configurable
                    jira_board_id   VARCHAR(50),
                    total_tickets   INTEGER NOT NULL DEFAULT 0,
                    passed          INTEGER NOT NULL DEFAULT 0,
                    failed          INTEGER NOT NULL DEFAULT 0,
                    skipped         INTEGER NOT NULL DEFAULT 0,
                    status          VARCHAR(20) NOT NULL DEFAULT 'running', -- running|done|error
                    jira_comment_id VARCHAR(100),  -- ID of the posted Jira comment (for updates)
                    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    completed_at    TIMESTAMPTZ
                );
                CREATE INDEX IF NOT EXISTS idx_sprint_runs_sprint ON sprint_runs(sprint_id);
                CREATE INDEX IF NOT EXISTS idx_sprint_runs_project ON sprint_runs(project_key);
                CREATE INDEX IF NOT EXISTS idx_sprint_runs_status ON sprint_runs(status);

                -- Per-ticket result within a sprint run
                CREATE TABLE IF NOT EXISTS sprint_run_results (
                    id              SERIAL PRIMARY KEY,
                    sprint_run_id   INTEGER NOT NULL REFERENCES sprint_runs(id) ON DELETE CASCADE,
                    ticket_id       VARCHAR(50) NOT NULL,
                    ticket_summary  VARCHAR(512),
                    module_name     VARCHAR(128),
                    status          VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|pass|fail|skip|error
                    used_saved_script  BOOLEAN NOT NULL DEFAULT false,
                    failure_category   VARCHAR(50),  -- CODE_FAULT | REAL_FAIL | UI_CHANGED
                    error_message      TEXT,
                    duration_ms        INTEGER,
                    script_path        TEXT,
                    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_sprint_results_run ON sprint_run_results(sprint_run_id);
                CREATE INDEX IF NOT EXISTS idx_sprint_results_ticket ON sprint_run_results(ticket_id);
                CREATE INDEX IF NOT EXISTS idx_sprint_results_status ON sprint_run_results(status);
            `
        },
        {
            version: 27,
            name: 'Script Library — add McpStep[] steps column + scenario metadata',
            sql: `
                -- Add McpStep[] storage: replaces compiled script text for new saves.
                -- Keeping script column for backward compat with existing rows.
                ALTER TABLE test_scripts
                    ADD COLUMN IF NOT EXISTS steps         JSONB,
                    ADD COLUMN IF NOT EXISTS scenario_name TEXT,
                    ADD COLUMN IF NOT EXISTS pass_count    INTEGER NOT NULL DEFAULT 0,
                    ADD COLUMN IF NOT EXISTS last_pass_at  TIMESTAMPTZ;

                -- Make script nullable so new rows can omit it when using steps only
                ALTER TABLE test_scripts
                    ALTER COLUMN script DROP NOT NULL;

                -- Index on scenario_name for Script Library panel queries
                CREATE INDEX IF NOT EXISTS idx_test_scripts_scenario_name ON test_scripts(scenario_name);
            `
        },
        {
            version: 29,
            name: 'MCP Execution — scenario_type + heal_history on test_scripts',
            sql: `
                -- scenario_type: drives heal strategy in McpHealingService
                --   'happy_path' → healAction() only
                --   'negative'   → healAction() + healAssertion()
                --   'edge_case'  → constraints extract + healAction() + healAssertion()
                --   'regression' → replay only, no AI regenerate
                ALTER TABLE test_scripts
                    ADD COLUMN IF NOT EXISTS scenario_type TEXT NOT NULL DEFAULT 'happy_path',
                    ADD COLUMN IF NOT EXISTS heal_history  JSONB NOT NULL DEFAULT '[]';
                -- heal_history shape: [{step_index, original, healed, healed_at, success}]

                CREATE INDEX IF NOT EXISTS idx_test_scripts_scenario_type ON test_scripts(scenario_type);
            `
        },
        {
            version: 28,
            name: 'Jira Context Cache + Module Skills (Phase 3.5 / 3.6)',
            sql: `
                -- ── jira_context_cache ─────────────────────────────────────────────────
                -- Caches JiraContextBuilder output per ticket for 30 minutes.
                -- Avoids repeated Jira API calls within a single test generation session.
                CREATE TABLE IF NOT EXISTS jira_context_cache (
                    ticket_id  VARCHAR(50)  PRIMARY KEY,
                    context    JSONB        NOT NULL,
                    cached_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                    expires_at TIMESTAMPTZ  NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_jira_ctx_expires ON jira_context_cache(expires_at);

                -- ── module_skills ───────────────────────────────────────────────────────
                -- Per-module persistent knowledge: business rules, navigation paths,
                -- known selectors, and test patterns learned from passing runs.
                -- Used by SkillStore to build compact (<500 token) prompt context.
                CREATE TABLE IF NOT EXISTS module_skills (
                    id              SERIAL       PRIMARY KEY,
                    module_name     VARCHAR(128) NOT NULL UNIQUE,
                    business_rules  JSONB        NOT NULL DEFAULT '[]',
                    navigation_path JSONB        NOT NULL DEFAULT '[]',
                    known_selectors JSONB        NOT NULL DEFAULT '{}',
                    test_patterns   JSONB        NOT NULL DEFAULT '[]',
                    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
                );

                CREATE INDEX IF NOT EXISTS idx_module_skills_name ON module_skills(module_name);
            `
        },
        {
            version: 30,
            name: 'Module Element Schema (Phase 2 — UI Contract Layer)',
            sql: `
                -- Persisted UI element registry per module.
                -- Built from live Playwright accessibility snapshots after each discovery crawl.
                -- Used by McpTestExecutor to validate step targets before execution
                -- (anti-hallucination: if element not seen in schema → CODE_FAULT, not false PASS).
                CREATE TABLE IF NOT EXISTS module_element_schemas (
                    module_id     VARCHAR(50)  PRIMARY KEY,
                    captured_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                    visited_url   TEXT         NOT NULL DEFAULT '',
                    snapshot_hash VARCHAR(16)  NOT NULL DEFAULT '',
                    pages         JSONB        NOT NULL DEFAULT '{}'
                );

                CREATE INDEX IF NOT EXISTS idx_mes_captured ON module_element_schemas(captured_at);
            `
        },
        {
            version: 31,
            name: 'Module State Graph (Phase 3 — HSM + Dijkstra)',
            sql: `
                -- HSM state graph per module derived from ModuleElementSchema.
                -- States = UI pages + child modal/dialog states (parent/child hierarchy).
                -- Transitions = button/link interactions with Dijkstra edge costs.
                -- Used by ModuleStateGraphService.generatePaths() for structured test paths.
                CREATE TABLE IF NOT EXISTS module_state_graphs (
                    module_id    VARCHAR(50)  PRIMARY KEY,
                    captured_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                    states       JSONB        NOT NULL DEFAULT '[]',
                    transitions  JSONB        NOT NULL DEFAULT '[]',
                    entry        TEXT         NOT NULL DEFAULT '',
                    terminals    JSONB        NOT NULL DEFAULT '[]',
                    dependencies JSONB        NOT NULL DEFAULT '[]'
                );

                CREATE INDEX IF NOT EXISTS idx_msg_captured ON module_state_graphs(captured_at);
            `
        },
    ];

    static async run(pool: any): Promise<void> {
        // Ensure migration table exists
        await pool.query(`
            CREATE TABLE IF NOT EXISTS migrations (
                version INTEGER PRIMARY KEY,
                name VARCHAR(255),
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        const { rows } = await pool.query('SELECT version FROM migrations ORDER BY version DESC LIMIT 1');
        const currentVersion = rows.length > 0 ? rows[0].version : 0;

        for (const migration of this.migrations) {
            if (migration.version > currentVersion) {
                console.log(`[DB] Applying migration v${migration.version}: ${migration.name}`);
                
                // Use a single client for the transaction
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    
                    if (typeof migration.sql === 'string') {
                        await client.query(migration.sql);
                    } else {
                        // Pass the client to the function so it uses the same transaction
                        await (migration.sql as any)(client);
                    }
                    
                    await client.query('INSERT INTO migrations (version, name) VALUES ($1, $2)', [migration.version, migration.name]);
                    await client.query('COMMIT');
                    console.log(`[DB] Migration v${migration.version} successfully applied.`);
                } catch (err) {
                    await client.query('ROLLBACK');
                    console.error(`[DB] Migration v${migration.version} failed. Transaction rolled back.`, err);
                    throw err;
                } finally {
                    client.release();
                }
            }
        }

        // Ensure system user exists
        try {
            await pool.query(`INSERT INTO users (id, owner_id, display_name, role) VALUES ('public', 'system', 'Public User', 'owner') ON CONFLICT (id) DO NOTHING;`);
        } catch (e) {}
    }
}
