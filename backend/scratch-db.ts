import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'Global@2026',
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432', 10),
  database: process.env.PG_DATABASE || 'ai_testing_platform'
});

async function run() {
  try {
    // Check if test_versions table exists and its columns
    const { rows: cols } = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'test_versions' 
      ORDER BY ordinal_position
    `);
    console.log('test_versions columns:', cols);

    // Check current migration version
    const { rows: mig } = await pool.query('SELECT version, name FROM migrations ORDER BY version DESC');
    console.log('Migrations applied:', mig);
  } catch(e: any) {
    console.error('Error:', e.message);
  }
  process.exit(0);
}
run();
