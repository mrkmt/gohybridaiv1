import { Client, Pool } from 'pg';
import { config } from './config';

async function initDatabase() {
    // 1. Create Database if not exists
    const adminClient = new Client({
        user: config.postgres.user,
        host: config.postgres.host,
        database: 'postgres', // Connect to default admin DB
        password: config.postgres.password,
        port: config.postgres.port,
    });

    const dbName = config.postgres.database;

    try {
        await adminClient.connect();
        const res = await adminClient.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
        if (res.rowCount === 0) {
            console.log(`[Init] Creating database: ${dbName}...`);
            await adminClient.query(`CREATE DATABASE ${dbName}`);
            console.log('[Init] Database created successfully.');
        } else {
            console.log(`[Init] Database ${dbName} already exists.`);
        }
    } catch (err: any) {
        console.warn('[Init] DB Creation Warning (likely permission related):', err.message);
    } finally {
        await adminClient.end();
    }

    // 2. Initialize Tables
    const pool = new Pool({
        user: config.postgres.user,
        host: config.postgres.host,
        database: dbName,
        password: config.postgres.password,
        port: config.postgres.port,
    });

    try {
        console.log(`[Init] Connecting to ${dbName} to initialize tables...`);

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

        await pool.query(`
            CREATE TABLE IF NOT EXISTS cache (
                key VARCHAR(255) PRIMARY KEY,
                value JSONB,
                expires_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
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
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS ai_actions (
                id SERIAL PRIMARY KEY,
                recording_id UUID REFERENCES recordings(id) ON DELETE CASCADE,
                action_type VARCHAR(50),
                params JSONB,
                result JSONB,
                status VARCHAR(20),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('[Init] All forensic tables initialized successfully!');
    } catch (err) {
        console.error('[Init] Error initializing tables:', err);
        throw err;
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    initDatabase()
        .then(() => {
            console.log('Database initialization completed.');
            process.exit(0);
        })
        .catch((err) => {
            console.error('Database initialization failed:', err);
            process.exit(1);
        });
}
