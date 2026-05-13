const { Client } = require('pg');
require('dotenv').config();

async function fixSchema() {
    const client = new Client({
        connectionString: `postgresql://${process.env.PG_USER}:${process.env.PG_PASSWORD}@${process.env.PG_HOST}:${process.env.PG_PORT}/${process.env.PG_DATABASE}`
    });
    try {
        await client.connect();
        console.log('Fixing active_tickets table...');
        
        // 1. If ticker exists and ticket_id has no data, we could migrate. 
        // But here we see ticket_id is already there.
        // Let's make ticket_id the primary unique key and remove ticker.
        
        await client.query('ALTER TABLE active_tickets DROP COLUMN IF EXISTS ticker CASCADE');
        await client.query('ALTER TABLE active_tickets DROP COLUMN IF EXISTS name CASCADE'); // 'name' also looks legacy
        
        // Ensure ticket_id is NOT NULL
        await client.query('UPDATE active_tickets SET ticket_id = id::text WHERE ticket_id IS NULL');
        await client.query('ALTER TABLE active_tickets ALTER COLUMN ticket_id SET NOT NULL');
        
        // Ensure ticket_id is unique
        try {
            await client.query('ALTER TABLE active_tickets ADD CONSTRAINT active_tickets_ticket_id_key UNIQUE (ticket_id)');
        } catch (e) {
            console.log('Constraint already exists or could not be added:', e.message);
        }

        console.log('Schema fix completed.');
    } catch (err) {
        console.error('Schema fix failed:', err);
    } finally {
        await client.end();
    }
}
fixSchema();
