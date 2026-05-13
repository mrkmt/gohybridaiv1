-- ============================================================================
-- Create Extensions
-- Run: psql -U postgres -d ai_testing_platform -f migrations/create_extensions.sql
-- ============================================================================
-- Create pgcrypto for password hashing and crypto functions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Create uuid-ossp for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- Verify extensions
SELECT extname,
    extversion
FROM pg_extension
WHERE extname IN ('pgcrypto', 'uuid-ossp');