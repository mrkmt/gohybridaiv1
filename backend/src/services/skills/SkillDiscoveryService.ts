import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface PlaywrightSnippet {
    name: string;
    prefix: string;
    body: string[];
    description: string;
    category?: string;
}

export class SkillDiscoveryService {
    private static userProfile = os.homedir();
    private static extensionPaths = [
        path.join(SkillDiscoveryService.userProfile, '.vscode', 'extensions'),
        path.join(SkillDiscoveryService.userProfile, '.antigravity', 'extensions'),
        path.join(process.cwd(), '.antigravity', 'extensions'),
        // AI Specialist Paths
        path.join(SkillDiscoveryService.userProfile, '.gemini'),
        path.join(SkillDiscoveryService.userProfile, '.qwen'),
        path.join(SkillDiscoveryService.userProfile, '.antigravity'),
        path.join(SkillDiscoveryService.userProfile, '.appium'),
        path.join(SkillDiscoveryService.userProfile, '.claude'),
        path.join(SkillDiscoveryService.userProfile, '.cline'),
        path.join(SkillDiscoveryService.userProfile, '.codex')
    ];

    private static specificExtensions = [
        'angular.ng-template-21.2.3',
        'csbun.playwright-extend-0.16.1',
        'jaktestowac-pl.vsc-playwright-snippets-1.0.3',
        'jaktestowac-pl.vsc-playwright-snippets-ui-1.0.1',
        'ms-playwright.playwright-1.1.17',
        'yzhang.markdown-all-in-one-3.6.3'
    ];

    // Directories to skip entirely (recursive)
    private static readonly SKIP_DIRS = new Set([
        'node_modules', '.git', 'sessions', 'logs', 'log',
        '.vscode', '.gemini', '.cline', '.qwen', '.codex',
        '.antigravity', '.claude', 'globalStorage', 'workspaceStorage',
        'CachedData', 'Crashpad', 'GPUCache', 'DawnGraphiteCache',
        'DawnWebGPUCache', 'blob_storage', 'Partitions', 'Service Worker',
        'Local Storage', 'Session Storage', 'IndexedDB', 'CacheStorage',
        'Code Cache', 'Visited Links', 'Network Persistent State',
        'TransportSecurity', 'SSLErrorAssistant', 'Subresource Filter'
    ]);

    // Files to skip entirely (exact name match)
    private static readonly SKIP_FILES = new Set([
        // VS Code / Chrome extension internals
        'manifest.json', 'messages.json', 'package.json', 'package-lock.json',
        'verified_contents.json', 'computed_hashes.json', 'blocklist.json',
        'marketplace.json', 'plugin.json', 'mcp.json', 'hooks.json',
        'config.json', 'settings.json', 'tsconfig.json', 'opencode.json',
        'statusline.json', 'dasherSettingSchema.json', 'captcha_providers.json',
        'oauth_creds.json', 'google_accounts.json', 'projects.json', 'state.json',
        'board.json', 'meta.json', 'sessions-index.json', 'index.json',
        // AI tool session/state files
        'workspaceState.json', 'globalState.json', 'secrets.json',
        'trustedFolders.json', 'package-manager.json',
        // Log/state files
        'logs.json', 'metadata.json', 'timestamps.json', 'listdata.json',
        '.markdownlint.json', 'hooks.schema.json', 'package-manager.schema.json',
        'plugin.schema.json',
        // Cline/Gemini session files (pattern match handled separately)
    ]);

    // File name patterns that ARE actual VS Code snippet files (whitelist)
    private static readonly SNIPPET_FILE_PATTERNS = [
        'snippets.json',
        'tool.json',
        'playwright-snippets.json',
        'playwright-extend-snippets.json',
    ];

    // File name patterns that should NEVER be parsed (regex patterns for suffixes)
    private static readonly SKIP_FILE_PATTERNS = [
        /\.metadata\.json$/,      // AI analysis artifacts
        /^session-\d{4}-\d{2}-\d{2}T/, // AI session history
        /^agent-a[a-f0-9]+\.meta\.json$/, // AI agent metadata
        /^1p_failed_events\./,    // Error event logs
        /^checkpoint-/,           // Checkpoint files
    ];

    // Cache to avoid repeated filesystem scans
    private static _cachedSnippets: PlaywrightSnippet[] | null = null;
    private static _cacheTimestamp = 0;
    private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

    /**
     * Scans local extension directories for Playwright snippets.
     * Results are cached for 5 minutes to avoid repeated filesystem scans.
     */
    static async discoverPlaywrightSkills(): Promise<PlaywrightSnippet[]> {
        const now = Date.now();
        if (this._cachedSnippets !== null && (now - this._cacheTimestamp) < this.CACHE_TTL_MS) {
            return this._cachedSnippets;
        }

        const allSnippets: PlaywrightSnippet[] = [];
        console.log(`[SkillDiscovery] Starting discovery across ${this.extensionPaths.length} locations...`);

        for (const basePath of this.extensionPaths) {
            if (!fs.existsSync(basePath)) continue;

            // If it's a directory itself (like .gemini), scan it for snippets directly
            if (basePath.includes('.gemini') || basePath.includes('.qwen') || basePath.includes('.claude') || basePath.includes('.cline')) {
                this.scanDirectoryForSnippets(basePath, allSnippets);
                continue;
            }

            const extensions = fs.readdirSync(basePath);
            for (const extDir of extensions) {
                // Focus on Playwright related extensions OR specific requested ones
                const isTarget = extDir.toLowerCase().includes('playwright') || 
                                extDir.toLowerCase().includes('jaktestowac') ||
                                this.specificExtensions.some(se => extDir.includes(se));

                if (isTarget) {
                    const snippetsDir = path.join(basePath, extDir, 'snippets');
                    if (fs.existsSync(snippetsDir)) {
                        this.scanDirectoryForSnippets(snippetsDir, allSnippets, `${extDir}`);
                    }
                }
            }
        }

        // Cache results
        this._cachedSnippets = this.deduplicateSnippets(allSnippets);
        this._cacheTimestamp = Date.now();

        return this._cachedSnippets;
    }

    /**
     * Clears the discovery cache. Call when extensions are updated or manually to force re-discovery.
     */
    static clearCache(): void {
        this._cachedSnippets = null;
        this._cacheTimestamp = 0;
    }

    private static scanDirectoryForSnippets(dirPath: string, bucket: PlaywrightSnippet[], context: string = ''): void {
        if (!fs.existsSync(dirPath)) return;
        const files = fs.readdirSync(dirPath);
        for (const sFile of files) {
            const fullPath = path.join(dirPath, sFile);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                // Skip blacklisted directories
                if (this.SKIP_DIRS.has(sFile)) continue;
                this.scanDirectoryForSnippets(fullPath, bucket, context);
                continue;
            }

            if (!sFile.endsWith('.json')) continue;
            if (!this.shouldInspectFile(sFile)) continue;

            // Skip blacklisted files (exact name match)
            if (this.SKIP_FILES.has(sFile)) continue;

            // Skip files matching regex patterns
            if (this.SKIP_FILE_PATTERNS.some(pattern => pattern.test(sFile))) continue;

            try {
                const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                // Check if file is a snippet file (contains objects with prefix/body)
                let foundSnippets = false;
                Object.entries(content).forEach(([name, data]: [string, any]) => {
                    if (data && data.prefix && data.body) {
                        bucket.push({
                            name,
                            prefix: data.prefix,
                            body: Array.isArray(data.body) ? data.body : [data.body],
                            description: data.description || '',
                            category: data.category
                        });
                        foundSnippets = true;
                    }
                });
                if (foundSnippets) {
                    console.log(`[SkillDiscovery] Ingested snippets from ${context}/${sFile}`);
                }
            } catch (err) {
                // Silently ignore non-snippet JSONs
            }
        }
    }

    /**
     * Formats snippets into a condensed system prompt fragment for AI injection.
     */
    static formatSnippetsForAI(snippets: PlaywrightSnippet[]): string {
        if (snippets.length === 0) return '';

        let fragment = "\n### PLAYWRIGHT PROFESSIONAL SKILLS (Injected from local environment)\n";
        fragment += "Use the following established patterns and snippets for high-quality Playwright code:\n";

        // Focus on relevant snippets for the prompt
        const filtered = snippets.slice(0, 50);

        filtered.forEach(s => {
            fragment += `- **${s.name}** (prefix: ${s.prefix}): ${s.description}\n`;
            fragment += `  Example Code Structure: \`${s.body.join(' ').replace(/\$\d+/g, '...')}\`\n`;
        });

        return fragment;
    }

    private static shouldInspectFile(fileName: string): boolean {
        const lower = fileName.toLowerCase();
        return this.SNIPPET_FILE_PATTERNS.some(pattern => lower.endsWith(pattern));
    }

    private static deduplicateSnippets(snippets: PlaywrightSnippet[]): PlaywrightSnippet[] {
        const seen = new Set<string>();
        const deduped: PlaywrightSnippet[] = [];

        for (const snippet of snippets) {
            const key = [
                snippet.name.trim().toLowerCase(),
                snippet.prefix.trim().toLowerCase(),
                snippet.body.join('\n').trim().toLowerCase(),
            ].join('::');

            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(snippet);
        }

        return deduped;
    }
}
