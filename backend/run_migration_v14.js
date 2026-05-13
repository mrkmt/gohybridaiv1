const { Client } = require('pg');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function runMigration() {
    const client = new Client({
        connectionString: `postgresql://${process.env.PG_USER}:${process.env.PG_PASSWORD}@${process.env.PG_HOST}:${process.env.PG_PORT}/${process.env.PG_DATABASE}`
    });
    try {
        await client.connect();
        const sqlPath = 'D:/KMT/My class/AI/GoHyai_claude/files_2/v14_p0_fixes.sql';
        const sql = fs.readFileSync(sqlPath, 'utf8');
        console.log(`Running migration from ${sqlPath}...`);
        
        // Split by semi-colons, but carefully (this is a simple split)
        // Better: just run the whole thing if pg client allows, or split by blocks
        // Actually, pg client's query() can run multiple statements if they are separated by ;
        
        await client.query(sql);
        console.log('Migration successfully applied.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await client.end();
    }
}
runMigration();
