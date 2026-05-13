import { Pool } from 'pg';
import { config } from './config';
import * as fs from 'fs';

async function exportLastLog() {
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
            fs.writeFileSync('last_ai_log.txt', res.rows[0].response);
            console.log("✅ Exported last AI log to last_ai_log.txt");
        } else {
            console.log("❌ No logs found.");
        }
    } catch (err) {
        console.error("❌ Export failed:", err);
    } finally {
        await pool.end();
    }
}

exportLastLog();
