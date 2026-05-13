-- ============================================================================
-- Core Tables — DEPRECATED
--
-- THIS FILE IS NO LONGER USED.
-- All core tables are managed by MigrationManager.ts (src/services/MigrationManager.ts).
--
-- MigrationManager applies these migrations at startup:
--   v1  — recordings, ai_logs, cache, object_repository, ai_actions, users, extension_settings
--   v2  — telemetry_logs + indexes
--   v3  — schema normalization (JSON→VARCHAR for recordings columns)
--   v4  — chat_sessions
--   v5  — investigation_drafts
--   v7  — rules
--   v8  — users enhancement, audit_logs, test_sessions
--   v9  — business_rules
--   v10 — test_sessions.is_running
--   v11 — active_tickers table
--   v12 — test_sessions.confidence_assessment
--   v13 — rename active_tickers → active_tickets + additional columns
--
-- Additional tables created by separate migration files:
--   test_versions   — migrations/create_test_versions.sql (also managed by MigrationManager v14)
--   visual_baselines — migrations/create_test_versions.sql (also managed by MigrationManager v14)
--   staging_rules   — migrations/create_business_logic.sql (also managed by MigrationManager v15)
--   test_users      — NOT yet in MigrationManager (see below for schema)
--   jira_config     — NOT yet in MigrationManager (see below for schema)
--   api_keys        — migrations/create_api_keys.sql (also managed by MigrationManager v16)
--
-- If you need to manually create tables NOT in MigrationManager, use the schemas below.
-- ============================================================================

-- Test Users (credential vault) — NOT yet in MigrationManager
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

-- Jira Config — NOT yet in MigrationManager
CREATE TABLE IF NOT EXISTS jira_config (
    id SERIAL PRIMARY KEY,
    domain VARCHAR(128),
    email VARCHAR(128),
    api_token TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Extensions (also managed by MigrationManager at startup)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
