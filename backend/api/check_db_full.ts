
import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function checkDb() {
    const pool = new Pool({
        user: process.env.PG_USER,
        password: process.env.PG_PASSWORD,
        host: process.env.PG_HOST,
        port: parseInt(process.env.PG_PORT || '5432'),
        database: process.env.PG_DATABASE,
    });
    try {
        const { rows } = await pool.query("SELECT * FROM module_element_schemas;");
        console.log(`Found ${rows.length} records in module_element_schemas.`);
        rows.forEach(r => console.log(`- ${r.module_id}`));
        
        const graphRows = await pool.query("SELECT * FROM module_state_graphs;");
        console.log(`Found ${graphRows.rows.length} records in module_state_graphs.`);
        graphRows.rows.forEach(r => console.log(`- ${r.module_id}`));

    } catch (err: any) {
        console.error("DB Error:", err.message);
    } finally {
        await pool.end();
    }
}
checkDb().catch(console.error);
