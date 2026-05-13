/**
 * Database Verification Helper
 * 
 * Provides direct database verification for test cases.
 * Use this to confirm records are actually created in the database.
 * 
 * @author GoHybrid AI Team
 * @date April 1, 2026
 */

import { Pool, QueryResult } from 'pg';

// Database connection pool
let dbPool: Pool | null = null;

/**
 * Initialize database connection pool
 * Call this once at the start of your test suite
 */
export function initDbPool() {
    if (dbPool) return dbPool;

    dbPool = new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'globalhr',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
    });

    console.log('✓ Database pool initialized');
    return dbPool;
}

/**
 * Close database connection pool
 * Call this at the end of your test suite
 */
export async function closeDbPool() {
    if (dbPool) {
        await dbPool.end();
        dbPool = null;
        console.log('✓ Database pool closed');
    }
}

/**
 * Verify designation exists in database
 * 
 * @param designationName - The designation name to search for
 * @returns Object with found status and record data
 * 
 * Usage in test:
 * ```typescript
 * const dbResult = await verifyDesignationInDB(testName);
 * if (!dbResult.found) {
 *     throw new Error('Record not in database - API lied!');
 * }
 * console.log(`✓ Record found in DB: ${dbResult.data?.DesignationId}`);
 * ```
 */
export async function verifyDesignationInDB(
    designationName: string
): Promise<{ found: boolean; data?: any; error?: string }> {
    try {
        const pool = initDbPool();
        
        const query = `
            SELECT 
                "DesignationId",
                "ShortCode",
                "Designation",
                "GradeID",
                "CreatedDate",
                "ModifiedDate"
            FROM "Designations"
            WHERE "Designation" = $1
            ORDER BY "CreatedDate" DESC
            LIMIT 1
        `;
        
        const result: QueryResult = await pool.query(query, [designationName]);
        
        if (result.rows.length > 0) {
            console.log(`✓ Designation found in DB: ${result.rows[0].DesignationId}`);
            return {
                found: true,
                data: result.rows[0]
            };
        } else {
            console.log(`❌ Designation NOT found in DB: ${designationName}`);
            return {
                found: false,
                error: `Record "${designationName}" not found in Designations table`
            };
        }
    } catch (error: any) {
        console.error('❌ Database verification error:', error.message);
        return {
            found: false,
            error: error.message
        };
    }
}

/**
 * Verify designation was deleted from database
 * 
 * @param designationName - The designation name to search for
 * @returns true if NOT found (successfully deleted)
 */
export async function verifyDesignationDeletedFromDB(
    designationName: string
): Promise<{ deleted: boolean; error?: string }> {
    try {
        const pool = initDbPool();
        
        const query = `
            SELECT "DesignationId"
            FROM "Designations"
            WHERE "Designation" = $1
            LIMIT 1
        `;
        
        const result: QueryResult = await pool.query(query, [designationName]);
        
        if (result.rows.length === 0) {
            console.log(`✓ Designation confirmed deleted from DB: ${designationName}`);
            return { deleted: true };
        } else {
            console.log(`❌ Designation still exists in DB: ${designationName}`);
            return {
                deleted: false,
                error: `Record "${designationName}" still exists in Designations table`
            };
        }
    } catch (error: any) {
        console.error('❌ Database deletion verification error:', error.message);
        return {
            deleted: false,
            error: error.message
        };
    }
}

/**
 * Get count of designations created in last N minutes
 * Useful for cleanup
 * 
 * @param minutes - Minutes to look back (default: 60)
 * @returns Count of recent designations
 */
export async function getRecentDesignationsCount(minutes: number = 60): Promise<number> {
    try {
        const pool = initDbPool();
        
        const query = `
            SELECT COUNT(*) as count
            FROM "Designations"
            WHERE "CreatedDate" >= NOW() - INTERVAL '${minutes} minutes'
        `;
        
        const result: QueryResult = await pool.query(query);
        const count = parseInt(result.rows[0].count);
        
        console.log(`📊 Designations created in last ${minutes} minutes: ${count}`);
        return count;
    } catch (error: any) {
        console.error('❌ Error counting recent designations:', error.message);
        return 0;
    }
}

/**
 * Cleanup test designations by name pattern
 * 
 * @param namePattern - Pattern to match (e.g., "Design_%")
 * @returns Number of records deleted
 */
export async function cleanupDesignationsByName(
    namePattern: string
): Promise<{ deleted: number; error?: string }> {
    try {
        const pool = initDbPool();
        
        const query = `
            DELETE FROM "Designations"
            WHERE "Designation" LIKE $1
            RETURNING "DesignationId"
        `;
        
        const result: QueryResult = await pool.query(query, [`%${namePattern}%`]);
        const deletedCount = result.rowCount || 0;
        
        console.log(`✓ Cleaned up ${deletedCount} test designations matching "${namePattern}"`);
        return { deleted: deletedCount };
    } catch (error: any) {
        console.error('❌ Error cleaning up designations:', error.message);
        return {
            deleted: 0,
            error: error.message
        };
    }
}

/**
 * Cleanup designations created in last N minutes
 * 
 * @param minutes - Minutes to look back (default: 60)
 * @returns Number of records deleted
 */
export async function cleanupRecentDesignations(
    minutes: number = 60
): Promise<{ deleted: number; error?: string }> {
    try {
        const pool = initDbPool();
        
        const query = `
            DELETE FROM "Designations"
            WHERE "CreatedDate" >= NOW() - INTERVAL '${minutes} minutes'
            RETURNING "DesignationId"
        `;
        
        const result: QueryResult = await pool.query(query);
        const deletedCount = result.rowCount || 0;
        
        console.log(`✓ Cleaned up ${deletedCount} designations from last ${minutes} minutes`);
        return { deleted: deletedCount };
    } catch (error: any) {
        console.error('❌ Error cleaning up recent designations:', error.message);
        return {
            deleted: 0,
            error: error.message
        };
    }
}

/**
 * Execute custom SQL query (for advanced users)
 * 
 * @param query - SQL query with placeholders
 * @param params - Query parameters
 * @returns Query result
 */
export async function executeDbQuery(
    query: string,
    params: any[] = []
): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
        const pool = initDbPool();
        const result: QueryResult = await pool.query(query, params);
        
        return {
            success: true,
            data: result.rows
        };
    } catch (error: any) {
        console.error('❌ Custom query error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Test database connection
 * Call this at the start of tests to verify DB is accessible
 */
export async function testDbConnection(): Promise<{ connected: boolean; error?: string }> {
    try {
        const pool = initDbPool();
        await pool.query('SELECT NOW()');
        console.log('✓ Database connection successful');
        return { connected: true };
    } catch (error: any) {
        console.error('❌ Database connection failed:', error.message);
        return {
            connected: false,
            error: error.message
        };
    }
}
