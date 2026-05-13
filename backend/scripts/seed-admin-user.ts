/**
 * Seed Admin User
 *
 * Creates the main administrator account.
 * Run: npm run seed:admin
 */

import bcrypt from 'bcrypt';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
    user: process.env.PG_USER || 'postgres',
    host: process.env.PG_HOST || 'localhost',
    database: process.env.PG_DATABASE || 'ai_testing_platform',
    password: process.env.PG_PASSWORD || '',
    port: parseInt(process.env.PG_PORT || '5432'),
});

async function seedAdminUser() {
    const ADMIN_ID = 'admin';
    const ADMIN_EMAIL = 'admin@go.ai';
    const ADMIN_PASSWORD = 'admin@2026';
    const ADMIN_DISPLAY_NAME = 'Administrator';
    const ADMIN_ROLE = 'admin';

    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);

    // Check if already exists
    const { rows } = await pool.query(`SELECT id FROM users WHERE id = $1`, [ADMIN_ID]);

    if (rows.length > 0) {
        // Update existing admin user
        await pool.query(
            `UPDATE users SET email = $1, password_hash = $2, display_name = $3, role = $4, is_active = true WHERE id = $5`,
            [ADMIN_EMAIL, hash, ADMIN_DISPLAY_NAME, ADMIN_ROLE, ADMIN_ID]
        );
        console.log('✅ Admin user updated successfully.');
    } else {
        await pool.query(
            `INSERT INTO users (id, email, password_hash, display_name, role, owner_id, is_active, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, true, NOW())`,
            [ADMIN_ID, ADMIN_EMAIL, hash, ADMIN_DISPLAY_NAME, ADMIN_ROLE, 'system']
        );
        console.log('✅ Admin user created successfully.');
    }

    console.log(`\n   Email: ${ADMIN_EMAIL}`);
    console.log(`   Password: ${ADMIN_PASSWORD}`);
    console.log(`   Role: ${ADMIN_ROLE}`);
    console.log('\nUse these credentials to log in at http://localhost:${process.env.PORT || 3000}/login.html');

    await pool.end();
    process.exit(0);
}

seedAdminUser().catch((err) => {
    console.error('❌ Failed to seed admin user:', err.message);
    pool.end();
    process.exit(1);
});
