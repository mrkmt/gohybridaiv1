-- ============================================================================
-- Healing Attempt Counters Table
-- Run: psql -U postgres -d ai_testing_platform -f migrations/create_healing_counters.sql
--
-- Persists healing attempt counters so they survive server restarts.
-- Uses TTL-based expiration via a cron job or application-level cleanup.
-- ============================================================================

CREATE TABLE IF NOT EXISTS healing_counters (
    id SERIAL PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    error_signature TEXT NOT NULL,  -- First 100 chars of error message
    count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 hour')
);

-- Unique constraint: one counter per ticket + case + error combo
CREATE UNIQUE INDEX IF NOT EXISTS idx_healing_counters_unique
    ON healing_counters (ticket_id, case_id, error_signature);

-- Index for expiration cleanup
CREATE INDEX IF NOT EXISTS idx_healing_counters_expires_at
    ON healing_counters (expires_at);

-- Index for lookup by ticket + case
CREATE INDEX IF NOT EXISTS idx_healing_counters_ticket_case
    ON healing_counters (ticket_id, case_id);
