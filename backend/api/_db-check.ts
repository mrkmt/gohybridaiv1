const { Client } = require('pg');

async function run() {
    const client = new Client({
        user: 'postgres',
        password: 'Global@2026',
        host: 'localhost',
        database: 'ai_testing_platform',
        port: 5432
    });

    try {
        await client.connect();
        
        console.log("📊 SEARCHING FOR CACHE TABLES...");
        const res = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_name ILIKE '%ai%' 
            OR table_name ILIKE '%cache%'
        `);
        console.table(res.rows);

    } catch (err: any) {
        console.error("DB Error:", err.message);
    } finally {
        await client.end();
    }
}

run();
