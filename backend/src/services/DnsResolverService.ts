import dns from 'dns';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const resolve4 = promisify(dns.resolve4);

interface DnsOverride {
    domain: string;
    ip: string;
    resolvedAt: string;
    ttlMs: number;
}

/**
 * Pre-resolves domains and generates Playwright --host-rules flags.
 * Falls back to normal DNS if resolution fails.
 */
export class DnsResolverService {
    private static cachePath = path.join(process.cwd(), 'local_storage', 'cache', 'dns-overrides.json');
    private static defaultTtlMs = 600000; // 10 minutes (reduced from 1 hour)

    /**
     * Resolve a domain and cache the result.
     */
    static async resolveAndCache(domain: string): Promise<string | null> {
        try {
            const addresses = await resolve4(domain);
            if (addresses.length === 0) return null;

            const override: DnsOverride = {
                domain,
                ip: addresses[0],
                resolvedAt: new Date().toISOString(),
                ttlMs: this.defaultTtlMs,
            };

            const overrides = this.loadOverrides();
            const idx = overrides.findIndex(o => o.domain === domain);
            if (idx >= 0) overrides[idx] = override;
            else overrides.push(override);

            this.saveOverrides(overrides);
            console.log(`[DnsResolver] Resolved ${domain} → ${addresses[0]}`);
            return addresses[0];
        } catch (err: any) {
            console.warn(`[DnsResolver] Failed to resolve ${domain}: ${err.message}`);
            return null;
        }
    }

    /**
     * Get cached IP for a domain (if still valid).
     */
    static getCachedIp(domain: string): string | null {
        const overrides = this.loadOverrides();
        const entry = overrides.find(o => o.domain === domain);
        if (!entry) return null;
        return entry.ip;
    }

    /**
     * Generate Playwright --host-rules launch arg from all cached overrides.
     */
    static getHostRulesArg(): string {
        const overrides = this.loadOverrides().filter(o => {
            const age = Date.now() - new Date(o.resolvedAt).getTime();
            return age < o.ttlMs; // Strict expiry
        });

        if (overrides.length === 0) return '';

        const rules = overrides.map(o => `MAP ${o.domain} ${o.ip}`).join(', ');
        return `--host-rules=${rules}`;
    }

    /**
     * Remove an override from cache.
     */
    static deleteOverride(domain: string): void {
        const overrides = this.loadOverrides().filter(o => o.domain !== domain);
        this.saveOverrides(overrides);
        console.log(`[DnsResolver] Cleared cache for ${domain}`);
    }

    /**
     * Pre-flight: Resolve domains needed for a test run.
     */
    static async preflight(baseUrl: string): Promise<void> {
        try {
            const url = new URL(baseUrl);
            await this.resolveAndCache(url.hostname);
        } catch (err: any) {
            console.warn(`[DnsResolver] Preflight failed for ${baseUrl}: ${err.message}`);
        }
    }

    // ── Internal ────────────────────────────────────────────────────────────────

    private static loadOverrides(): DnsOverride[] {
        try {
            if (!fs.existsSync(this.cachePath)) return [];
            return JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
        } catch {
            return [];
        }
    }

    private static saveOverrides(overrides: DnsOverride[]): void {
        const dir = path.dirname(this.cachePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.cachePath, JSON.stringify(overrides, null, 2), 'utf8');
    }
}
