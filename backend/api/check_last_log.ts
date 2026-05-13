import { Pool } from 'pg';
import { config } from './config';

async function checkLastLog() {
    const pool = new Pool({
        user: config.postgres.user,
        password: config.postgres.password,
        host: config.postgres.host,
        database: config.postgres.database,
        port: config.postgres.port,
    });

    try {
        const res = await pool.query('SELECT response FROM ai_logs ORDER BY created_at DESC LIMIT 1');
        if (res.rows.length > 0) {
            console.log("--- LAST AI LOG ---");
            console.log(res.rows[0].response);
        } else {
            console.log("No logs found.");
        }
    } catch (err) {
        console.error("Query failed:", err);
    } finally {
        await pool.end();
    }
}

checkLastLog();
