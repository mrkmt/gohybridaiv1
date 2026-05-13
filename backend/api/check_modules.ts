
import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function checkModules() {
    const pool = new Pool({
        user: process.env.PG_USER,
        password: process.env.PG_PASSWORD,
        host: process.env.PG_HOST,
        port: parseInt(process.env.PG_PORT || '5432'),
        database: process.env.PG_DATABASE,
    });
    const { rows } = await pool.query("SELECT module_id FROM module_element_schemas;");
    console.log("Available Modules in Schema:", rows.map(r => r.module_id));
    await pool.end();
}
checkModules().catch(console.error);
