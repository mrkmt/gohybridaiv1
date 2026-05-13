import { Pool } from 'pg';
import { config } from './config';

/**
 * Database Migration Script
 * Run with: npm run db:migrate
 * 
 * This script creates/updates the database schema with proper indexes.
 */

async function migrate() {
    const pool = new Pool(config.postgres);

    console.log('Starting database migration...');

    try {
        // Create recordings table
        await pool.query(`
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
        `);
        console.log('✓ recordings table created/verified');

        // Update existing recordings table if columns are missing
        try {
            await pool.query(`ALTER TABLE recordings ADD COLUMN IF NOT EXISTS video_url TEXT;`);
            await pool.query(`ALTER TABLE recordings ADD COLUMN IF NOT EXISTS screenshot_url TEXT;`);
            await pool.query(`ALTER TABLE recordings ADD COLUMN IF NOT EXISTS manual_snapshot_url TEXT;`);
            await pool.query(`ALTER TABLE recordings ADD COLUMN IF NOT EXISTS annotations JSONB DEFAULT '[]';`);
            await pool.query(`ALTER TABLE recordings ADD COLUMN IF NOT EXISTS expected_results JSONB DEFAULT '{}';`);
            await pool.query(`ALTER TABLE recordings ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;`);
            await pool.query(`ALTER TABLE recordings ADD COLUMN IF NOT EXISTS jira_id VARCHAR(50);`);
            await pool.query(`ALTER TABLE recordings ADD COLUMN IF NOT EXISTS test_url TEXT;`);
            await pool.query(`ALTER TABLE recordings ADD COLUMN IF NOT EXISTS environment JSONB;`);
            await pool.query(`ALTER TABLE recordings ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'passed';`);
            await pool.query(`ALTER TABLE recordings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
            console.log('✓ recordings table columns updated (if missing)');
        } catch (err: any) {
            console.warn('⚠ Failed to update recordings columns:', err.message);
        }

        // Create ai_logs table with foreign key
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ai_logs (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(255),
                recording_id UUID REFERENCES recordings(id) ON DELETE CASCADE,
                model VARCHAR(50),
                prompt TEXT,
                response TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✓ ai_logs table created/verified');

        // Create cache table for response caching
        await pool.query(`
            CREATE TABLE IF NOT EXISTS cache (
                key VARCHAR(255) PRIMARY KEY,
                value JSONB,
                expires_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✓ cache table created/verified');

        // Create indexes for performance
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_recordings_created_at 
            ON recordings(created_at DESC);
        `);
        console.log('✓ idx_recordings_created_at index created');

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_recordings_user_id 
            ON recordings(user_id);
        `);
        console.log('✓ idx_recordings_user_id index created');

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_ai_logs_recording_id 
            ON ai_logs(recording_id);
        `);
        console.log('✓ idx_ai_logs_recording_id index created');

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_ai_logs_created_at 
            ON ai_logs(created_at DESC);
        `);
        console.log('✓ idx_ai_logs_created_at index created');

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_cache_expires_at 
            ON cache(expires_at);
        `);
        console.log('✓ idx_cache_expires_at index created');

        // Ensure user_id default is set
        try {
            await pool.query(`
                ALTER TABLE recordings ALTER COLUMN user_id SET DEFAULT 'public';
            `);
            console.log('✓ recordings.user_id default set to "public"');
        } catch (err) {
            console.log('⚠ recordings.user_id default may already be set');
        }

        console.log('\n✅ Migration completed successfully!');
    } catch (err: any) {
        console.error('❌ Migration failed:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

migrate();
