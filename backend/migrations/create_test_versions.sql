-- ============================================================================
-- Test Versions & Visual Baselines Tables
-- Run: psql -U postgres -d ai_testing_platform -f migrations/create_test_versions.sql
--
-- NOTE: This migration is ALSO managed by MigrationManager (v14+).
-- This file exists for manual database setup reference only.
-- ============================================================================

-- Test Versions: Tracks versioned Playwright test scripts per ticket/case
CREATE TABLE IF NOT EXISTS test_versions (
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
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_test_versions_ticket_id ON test_versions(ticket_id);
CREATE INDEX IF NOT EXISTS idx_test_versions_version ON test_versions(version DESC);

-- Visual Baselines: Stores screenshot baselines for visual regression testing
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
);

-- Index for fast baseline lookups
CREATE INDEX IF NOT EXISTS idx_visual_baselines_ticket_case_step
    ON visual_baselines(ticket_id, case_id, step_number);
