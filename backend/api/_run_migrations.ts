
import { Pool } from 'pg';
import { config } from './config';
import { MigrationManager } from '../src/services/shared/MigrationManager';

async function run() {
    const pool = new Pool(config.postgres);
    try {
        console.log('🚀 Running all migrations via MigrationManager...');
        await MigrationManager.run(pool as any);
        console.log('✅ All migrations applied successfully!');
    } catch (err: any) {
        console.error('❌ Migration failed:', err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

run();
