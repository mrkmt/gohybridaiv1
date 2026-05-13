-- ============================================================================
-- Business Logic Matrix Tables
-- Run: psql -U postgres -d ai_testing_platform -f migrations/create_business_logic.sql
--
-- NOTE: The business_rules table is created by MigrationManager v9 with this schema:
--   id VARCHAR(64) PRIMARY KEY
--   module VARCHAR(128) NOT NULL
--   sub_module VARCHAR(128)
--   keywords TEXT[] DEFAULT '{}'
--   formula_rule TEXT
--   expected_ui_behavior TEXT
--   confidence_score DECIMAL(3,2) DEFAULT 0.9
--   status VARCHAR(32)
--   jira_id VARCHAR(32)
--   created_at TIMESTAMPTZ DEFAULT NOW()
--   updated_at TIMESTAMPTZ DEFAULT NOW()
--
-- This file ONLY creates the staging_rules table (not in MigrationManager).
-- DO NOT run this file if MigrationManager has already been applied —
-- staging_rules will be added as MigrationManager v14+.
-- ============================================================================

-- Staging rules table (replaces staging-matrix.json)
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_staging_rules_status ON staging_rules(status);
CREATE INDEX IF NOT EXISTS idx_staging_rules_keywords ON staging_rules USING GIN(keywords);

-- Align business_rules indexes with MigrationManager v9
CREATE INDEX IF NOT EXISTS idx_business_rules_module ON business_rules(module);
CREATE INDEX IF NOT EXISTS idx_business_rules_jira ON business_rules(jira_id);
CREATE INDEX IF NOT EXISTS idx_business_rules_keywords ON business_rules USING GIN(keywords);
CREATE INDEX IF NOT EXISTS idx_business_rules_status ON business_rules(status);
