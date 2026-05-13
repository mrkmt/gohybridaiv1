import { Pool } from 'pg';
import { config } from './api/config';

const pool = new Pool(config.postgres);

async function main() {
    try {
        const { rows } = await pool.query('SELECT id, email, display_name, role, is_active, password_hash FROM users');
        console.log('=== USERS IN DATABASE ===');
        for (const u of rows) {
            console.log(`  ID: ${u.id} | Email: ${u.email} | Name: ${u.display_name} | Role: ${u.role} | Active: ${u.is_active} | Hash: ${u.password_hash?.substring(0, 20)}...`);
        }
        console.log(`Total: ${rows.length} user(s)`);
    } catch (e: any) {
        console.error('DB Error:', e.message);
    } finally {
        await pool.end();
    }
}

main();
