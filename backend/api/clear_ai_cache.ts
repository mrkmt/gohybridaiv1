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
        
        console.log("🧹 PURGING STALE AI CACHE...");
        // Remove all general chat cache to force new personas
        const res = await client.query(`
            DELETE FROM ai_response_cache 
            WHERE task_type = 'chat' 
            OR model = 'auto'
        `);
        
        console.log(`✅ Successfully removed ${res.rowCount} stale cache entries.`);
        console.log("🚀 Personas are now fresh and ready.");

    } catch (err) {
        console.error("Cache Clear Error:", err.message);
    } finally {
        await client.end();
    }
}

run();
