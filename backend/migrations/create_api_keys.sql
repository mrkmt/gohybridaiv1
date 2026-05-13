-- ============================================================================
-- Per-user API keys
-- Run: psql -U postgres -d ai_testing_platform -f migrations/create_api_keys.sql
--
-- NOTE: This migration is ALSO managed by MigrationManager (v16+).
-- This file exists for manual database setup reference only.
-- ============================================================================

-- API Keys table: One key per user for X-API-Key header authentication
CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_hash VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(128),
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

-- Index for fast key lookup during auth
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- Note: is_running on test_sessions is already added by MigrationManager v10
-- Do NOT add it here (would be redundant)
