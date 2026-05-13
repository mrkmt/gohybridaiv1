/**
 * Database Diagnostic Script
 * 
 * Checks if designation data is being persisted to the database
 * 
 * Run: npx ts-node backend/scripts/diagnose-designation-db.ts
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const pool = new Pool({
    user: process.env.PG_USER || 'postgres',
    host: process.env.PG_HOST || 'localhost',
    database: process.env.PG_DATABASE || 'ai_testing_platform',
    password: process.env.PG_PASSWORD || 'Global@2026',
    port: parseInt(process.env.PG_PORT || '5432'),
});

async function diagnose() {
    console.log('\n' + '='.repeat(70));
    console.log('🔍 DATABASE DIAGNOSTIC - Designation Data');
    console.log('='.repeat(70));

    let client;
    try {
        client = await pool.connect();
        console.log('✓ Database connected\n');

        // Check if designations table exists
        console.log('  [1] Checking if designations table exists...');
        const tableCheck = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'designations'
            );
        `);
        
        const tableExists = tableCheck.rows[0].exists;
        console.log(`  ${tableExists ? '✅' : '❌'} Designations table ${tableExists ? 'exists' : 'NOT FOUND'}\n`);

        if (!tableExists) {
            console.log('  ⚠️  Designations table does not exist!');
            console.log('  Checking for similar tables...\n');
            
            const similarTables = await client.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name ILIKE '%designation%'
                OR table_name ILIKE '%design%'
            `);
            
            if (similarTables.rows.length > 0) {
                console.log('  Found similar tables:');
                similarTables.rows.forEach(row => {
                    console.log(`    - ${row.table_name}`);
                });
            } else {
                console.log('  No similar tables found.');
            }
            console.log();
        }

        // List all tables in public schema
        console.log('  [2] All tables in public schema:');
        const allTables = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        `);
        
        allTables.rows.forEach(row => {
            console.log(`    - ${row.table_name}`);
        });
        console.log();

        // Check recent designations
        if (tableExists) {
            console.log('  [3] Recent designations (last 10):');
            const recentDesignations = await client.query(`
                SELECT * FROM designations 
                ORDER BY created_at DESC NULLS LAST, id DESC 
                LIMIT 10
            `);
            
            if (recentDesignations.rows.length === 0) {
                console.log('  ⚠️  No designations found in database!\n');
            } else {
                console.log(`  Found ${recentDesignations.rows.length} designations:\n`);
                recentDesignations.rows.forEach((row, i) => {
                    console.log(`    ${i + 1}. ID: ${row.id}, Name: ${row.designation_name || row.name || row.title || 'N/A'}, Created: ${row.created_at || 'N/A'}`);
                });
                console.log();
            }

            // Check for test designations (Diagnose_, Design_, etc.)
            console.log('  [4] Searching for test designations...');
            const testPatterns = ['Diagnose_%', 'Design_%', 'Test_%', 'Auto_%'];
            
            for (const pattern of testPatterns) {
                const testRecords = await client.query(`
                    SELECT * FROM designations 
                    WHERE designation_name ILIKE $1 
                    OR name ILIKE $1 
                    OR title ILIKE $1
                    ORDER BY created_at DESC NULLS LAST
                    LIMIT 5
                `, [pattern]);
                
                if (testRecords.rows.length > 0) {
                    console.log(`  ✅ Found ${testRecords.rows.length} records matching '${pattern}':`);
                    testRecords.rows.forEach(row => {
                        console.log(`    - ${row.designation_name || row.name || row.title || 'N/A'} (Created: ${row.created_at})`);
                    });
                } else {
                    console.log(`  ❌ No records matching '${pattern}'`);
                }
            }
            console.log();

            // Count total designations
            console.log('  [5] Total designation count:');
            const countResult = await client.query('SELECT COUNT(*) FROM designations');
            console.log(`  Total: ${countResult.rows[0].count}\n`);
        }

        // Check for recent API activity in logs (if logging table exists)
        console.log('  [6] Checking for API request logs...');
        const logTables = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND (table_name ILIKE '%log%' OR table_name ILIKE '%audit%' OR table_name ILIKE '%request%')
        `);
        
        if (logTables.rows.length > 0) {
            console.log('  Found potential log tables:');
            logTables.rows.forEach(row => {
                console.log(`    - ${row.table_name}`);
            });
        } else {
            console.log('  No log tables found.');
        }
        console.log();

    } catch (error: any) {
        console.error('\n❌ ERROR:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        if (client) {
            client.release();
        }
        await pool.end();
        
        console.log('\n' + '='.repeat(70));
        console.log('✓ Database connection closed');
        console.log('='.repeat(70) + '\n');
    }
}

diagnose();
