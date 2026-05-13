import { Pool } from 'pg';
const p = new Pool({
    user: 'postgres',
    password: 'Global@2026',
    host: 'localhost',
    port: 5432,
    database: 'ai_testing_platform'
});

async function main() {
    try {
        const { rows } = await p.query(
            "SELECT EXISTS(SELECT FROM information_schema.tables WHERE table_name = 'active_tickets')"
        );
        console.log('Table exists:', rows[0].exists);
        
        if (!rows[0].exists) {
            console.log('Creating active_tickets table...');
            await p.query(`
                CREATE TABLE active_tickets (
                    id SERIAL PRIMARY KEY,
                    ticket_id TEXT UNIQUE,
                    summary TEXT,
                    description TEXT,
                    status TEXT DEFAULT 'Unknown',
                    priority TEXT DEFAULT 'Medium',
                    url TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_active_tickets_ticket_id ON active_tickets(ticket_id);
            `);
            console.log('✅ Table created successfully!');
        } else {
            console.log('✅ Table already exists, skipping.');
        }
        
        // Also fix migration tracking so v13 is marked as applied
        const { rows: migRows } = await p.query(
            "SELECT EXISTS(SELECT FROM migrations WHERE version = 13)"
        );
        if (!migRows[0].exists) {
            await p.query("INSERT INTO migrations (version, name) VALUES (13, 'Rename active_tickers to active_tickets (typo fix)')");
            console.log('✅ Migration v13 marked as applied.');
        }
    } catch (err: any) {
        console.error('❌ Error:', err.message);
    } finally {
        await p.end();
    }
}
main();
