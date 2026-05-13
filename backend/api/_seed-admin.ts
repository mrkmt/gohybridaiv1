import { Pool } from 'pg';
import bcrypt from 'bcrypt';
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
    const ADMIN_EMAIL = 'gohybrid@ai.com';
    const ADMIN_PASSWORD = 'Global@2026';
    const ADMIN_ID = 'admin';
    const saltRounds = 10;

    const hash = await bcrypt.hash(ADMIN_PASSWORD, saltRounds);

    await pool.query(
        `INSERT INTO users (id, owner_id, display_name, email, password_hash, role, is_active)
         VALUES ($1, 'system', 'Admin', $2, $3, 'admin', true)
         ON CONFLICT (id) DO UPDATE SET
            email = $2,
            password_hash = $3,
            role = 'admin',
            display_name = 'Admin',
            is_active = true`,
        [ADMIN_ID, ADMIN_EMAIL, hash]
    );

    console.log(`Admin user seeded:
  ID: ${ADMIN_ID}
  Email: ${ADMIN_EMAIL}
  Password: ${ADMIN_PASSWORD}
  ⚠️  CHANGE PASSWORD IN PRODUCTION!`);

    await pool.end();
}

if (require.main === module) {
    seedAdminUser()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('Failed:', err);
            process.exit(1);
        });
}
