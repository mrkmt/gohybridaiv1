/**
 * AICache - Cache AI generation results by prompt hash
 *
 * Prevents redundant AI calls when the same prompt is sent multiple times
 * (e.g., user clicks "Generate" twice, or retries with same context).
 *
 * Cache stored in PostgreSQL `cache` table with TTL.
 */

import { createHash } from 'crypto';
import { DbClient } from './TelemetryService';

// Cache TTL: 1 hour for generation results
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Hash a prompt for cache key generation.
 */
export function hashPrompt(prompt: string): string {
    return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

/**
 * Get cached AI response for a prompt.
 * Returns null if not cached or expired.
 */
export async function getCachedResponse(
    pool: DbClient,
    prompt: string,
    model?: string
): Promise<string | null> {
    try {
        const key = `ai:${hashPrompt(prompt)}:${model || 'any'}`;
        const result = await pool.query(
            'SELECT value, expires_at FROM cache WHERE key = $1',
            [key]
        );

        if (result.rows.length === 0) return null;

        const { value, expires_at } = result.rows[0];
        if (new Date(expires_at) < new Date()) {
            // Expired, clean up
            await pool.query('DELETE FROM cache WHERE key = $1', [key]);
            return null;
        }

        return value.response || null;
    } catch {
        return null; // Cache miss on error, let AI call proceed
    }
}

/**
 * Store AI response in cache.
 */
export async function setCachedResponse(
    pool: DbClient,
    prompt: string,
    model: string,
    response: string
): Promise<void> {
    try {
        const key = `ai:${hashPrompt(prompt)}:${model}`;
        const expiresAt = new Date(Date.now() + CACHE_TTL_MS);

        await pool.query(
            `INSERT INTO cache (key, value, expires_at, created_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (key) DO UPDATE SET value = $2, expires_at = $3`,
            [key, JSON.stringify({ response, model }), expiresAt]
        );
    } catch (err) {
        // Cache write failure — don't break the AI call
        console.error('[AICache] Failed to cache response:', err);
    }
}

/**
 * Invalidate all AI cache (for maintenance).
 */
export async function clearAICache(pool: DbClient): Promise<void> {
    try {
        await pool.query("DELETE FROM cache WHERE key LIKE 'ai:%'");
    } catch (err) {
        console.error('[AICache] Failed to clear cache:', err);
    }
}
