/**
 * run-migrations.ts
 * Runs all pending DB migrations via MigrationManager.
 *
 * Run:
 *   npx ts-node --transpile-only --project tsconfig.json scripts/run-migrations.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import { MigrationManager } from '../src/services/shared/MigrationManager';

async function main() {
  const pool = new Pool({
    host:     process.env.PG_HOST     || 'localhost',
    port:     Number(process.env.PG_PORT)   || 5432,
    user:     process.env.PG_USER     || 'postgres',
    password: process.env.PG_PASSWORD || '',
    database: process.env.PG_DATABASE || 'go_hybrid_ai_v1',
  });
  try {
    await MigrationManager.run(pool);
    console.log('✅ All migrations applied successfully.');
  } catch (err: any) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
