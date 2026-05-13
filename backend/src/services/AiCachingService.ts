import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { LRUCache } from 'lru-cache';

interface CacheEntry {
    data: any;
    createdAt: string;
    ttlMs: number;
}

export class AiCachingService {
    private static cacheDir = path.join(process.cwd(), 'local_storage', 'cache', 'ai');
    private static defaultTtlMs = 24 * 60 * 60 * 1000; // 24 hours
    private static hits = 0;
    private static misses = 0;
    private static lruCache = new LRUCache<string, any>({
        max: 100, // Maximum 100 entries (lru-cache v7+)
        ttl: 24 * 60 * 60 * 1000, // 24 hours default TTL (lru-cache v7+ uses 'ttl' instead of 'maxAge')
        updateAgeOnGet: true, // Refresh TTL on access
        updateAgeOnHas: true, // Refresh TTL on has checks
        allowStale: false, // Do not return stale entries
    });

    private static ensureCacheDir() {
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    private static generateKey(params: any): string {
        const json = JSON.stringify(params);
        return crypto.createHash('sha256').update(json).digest('hex');
    }

    static getCache<T>(params: any, category: 'plan' | 'script'): T | null {
        this.ensureCacheDir();
        const key = this.generateKey(params);
        const filePath = path.join(this.cacheDir, `${category}_${key}.json`);

        if (fs.existsSync(filePath)) {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const entry: CacheEntry = JSON.parse(content);

                // TTL check
                if (entry.createdAt && entry.ttlMs) {
                    const age = Date.now() - new Date(entry.createdAt).getTime();
                    if (age > entry.ttlMs) {
                        console.log(`[AiCache] Expired: ${category} (key: ${key.slice(0, 8)}, age: ${Math.round(age / 1000)}s)`);
                        try { fs.unlinkSync(filePath); } catch {}
                        this.misses++;
                        return null;
                    }
                }

                console.log(`[AiCache] Hit: ${category} (key: ${key.slice(0, 8)})`);
                this.hits++;
                return (entry.data !== undefined ? entry.data : entry) as T;
            } catch (e) {
                console.warn(`[AiCache] Failed to read cache: ${filePath}`, e);
            }
        }
        this.misses++;
        return null;
    }

    static setCache(params: any, category: 'plan' | 'script', data: any, ttlMs?: number): void {
        this.ensureCacheDir();
        const key = this.generateKey(params);
        const filePath = path.join(this.cacheDir, `${category}_${key}.json`);

        const entry: CacheEntry = {
            data,
            createdAt: new Date().toISOString(),
            ttlMs: ttlMs || this.defaultTtlMs,
        };

        try {
            fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf8');
            console.log(`[AiCache] Saved: ${category} (key: ${key.slice(0, 8)}, ttl: ${Math.round(entry.ttlMs / 1000)}s)`);
        } catch (e) {
            console.error(`[AiCache] Failed to write cache: ${filePath}`, e);
        }
    }

    static invalidateForJiraId(jiraId: string): number {
        this.ensureCacheDir();
        let removed = 0;
        const files = fs.readdirSync(this.cacheDir);
        for (const file of files) {
            const filePath = path.join(this.cacheDir, file);
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                if (content.includes(`"${jiraId}"`)) {
                    fs.unlinkSync(filePath);
                    removed++;
                }
            } catch {}
        }
        if (removed > 0) console.log(`[AiCache] Invalidated ${removed} entries for ${jiraId}`);
        return removed;
    }

    static getStats(): { hits: number; misses: number; hitRate: string; entries: number; sizeBytes: number } {
        this.ensureCacheDir();
        const files = fs.readdirSync(this.cacheDir).filter(f => f.endsWith('.json'));
        let sizeBytes = 0;
        for (const file of files) {
            try { sizeBytes += fs.statSync(path.join(this.cacheDir, file)).size; } catch {}
        }
        const total = this.hits + this.misses;
        return {
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? `${((this.hits / total) * 100).toFixed(1)}%` : '0%',
            entries: files.length,
            sizeBytes,
        };
    }

    static clearCache(): void {
        if (fs.existsSync(this.cacheDir)) {
            const files = fs.readdirSync(this.cacheDir);
            for (const file of files) {
                fs.unlinkSync(path.join(this.cacheDir, file));
            }
            this.hits = 0;
            this.misses = 0;
            console.log('[AiCache] Cache cleared.');
        }
    }
}
