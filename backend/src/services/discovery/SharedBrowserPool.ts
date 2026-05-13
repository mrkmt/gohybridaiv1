/**
 * SharedBrowserPool
 *
 * Manages a pool of reusable Playwright browser instances.
 * 
 * Refactored for Concurrency:
 * - Uses a single Browser instance but multiple BrowserContexts.
 * - Each caller gets a private Context and Page.
 * - No more "inUse" global lock — allows multiple discovery/execution sessions.
 *
 * Benefits:
 * - Resource Efficiency: One browser process, multiple lightweight contexts.
 * - Concurrency: Multiple users can run discovery/tests simultaneously.
 * - Isolation: Cookies/Storage are isolated per context.
 */

import { appLogger } from '../../utils/logger';

type Browser = any;
type BrowserContext = any;
type Page = any;

export interface BrowserContextHandle {
    browser: Browser;
    context: BrowserContext;
    page: Page;
}

export class SharedBrowserPool {
    private static _instance: SharedBrowserPool | null = null;

    private browser: Browser | null = null;
    private activeContexts = 0;
    private launchCount = 0;
    private reuseCount = 0;
    private lastUsedAt = 0;

    // Configuration
    private static readonly IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    private static readonly MAX_REUSES = 100; // Restart after 100 uses
    private static readonly HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    /** Hard ceiling on simultaneous browser contexts — prevents OOM under concurrent users */
    private static readonly MAX_CONTEXTS = parseInt(process.env.MAX_BROWSER_CONTEXTS || '4', 10);

    private healthCheckTimer: NodeJS.Timeout | null = null;
    private idleTimer: NodeJS.Timeout | null = null;

    private constructor() {}

    /**
     * Get singleton instance.
     */
    static getInstance(): SharedBrowserPool {
        if (!SharedBrowserPool._instance) {
            SharedBrowserPool._instance = new SharedBrowserPool();
        }
        return SharedBrowserPool._instance;
    }

    /**
     * Acquire a browser context for discovery or execution.
     * Launches a new browser if none exists.
     */
    async acquireContext(): Promise<BrowserContextHandle> {
        // Enforce concurrency ceiling before doing anything else
        if (this.activeContexts >= SharedBrowserPool.MAX_CONTEXTS) {
            throw new Error(
                `[SharedBrowserPool] Pool full — ${this.activeContexts}/${SharedBrowserPool.MAX_CONTEXTS} contexts active. ` +
                `Increase MAX_BROWSER_CONTEXTS env var or wait for a slot to free.`
            );
        }

        // Check if we need a fresh browser (only if no active contexts are running)
        const needsFresh = !this.browser ||
            !this.browser.isConnected() ||
            (this.activeContexts === 0 && this.reuseCount >= SharedBrowserPool.MAX_REUSES);

        if (needsFresh) {
            if (this.browser?.isConnected() && this.activeContexts === 0) {
                appLogger.info(`[SharedBrowserPool] Browser reuse limit reached (${this.reuseCount}), launching fresh instance`);
                await this.closeCurrent();
            } else if (this.browser && !this.browser.isConnected()) {
                appLogger.warn('[SharedBrowserPool] Browser disconnected, recreating');
                await this.closeCurrent();
            }

            if (!this.browser || !this.browser.isConnected()) {
                appLogger.info('[SharedBrowserPool] Launching browser...');
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { chromium } = require('playwright');
                const start = Date.now();
                this.browser = await chromium.launch({
                    headless: true, // BACK TO SILENT MODE
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-gpu',
                        '--window-size=1920,1080'
                    ],
                });
                const launchTime = Date.now() - start;
                appLogger.info(`[SharedBrowserPool] Browser launched in ${launchTime}ms`);
                this.launchCount++;
                this.reuseCount = 0;
            }
        }

        this.reuseCount++;
        this.activeContexts++;
        this.lastUsedAt = Date.now();

        // Create a PRIVATE context for this caller
        const context = await this.browser!.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        });

        const page = await context.newPage();
        
        appLogger.info(`[SharedBrowserPool] Context acquired (Active: ${this.activeContexts}, Reuse: ${this.reuseCount})`);

        // Reset idle timer
        this.resetIdleTimer();

        return {
            browser: this.browser!,
            context,
            page,
        };
    }

    /**
     * Release the browser context after use.
     */
    async releaseContext(handle: BrowserContextHandle): Promise<void> {
        try {
            if (handle.page) await handle.page.close().catch(() => {});
            if (handle.context) await handle.context.close().catch(() => {});
        } catch (e) {
            appLogger.warn(`[SharedBrowserPool] Error releasing context: ${e}`);
        }

        this.activeContexts = Math.max(0, this.activeContexts - 1);
        this.lastUsedAt = Date.now();
        appLogger.info(`[SharedBrowserPool] Context released (Remaining Active: ${this.activeContexts})`);
        
        if (this.activeContexts === 0) {
            this.resetIdleTimer();
        }
    }

    /**
     * Perform login on the current page.
     */
    async performLogin(page: Page, loginUrl: string, credentials: { idNumber: string; username: string; password: string }): Promise<void> {
        const start = Date.now();
        await page.goto(loginUrl, { waitUntil: 'commit', timeout: 30000 });
        await page.waitForTimeout(2000);

        // Check if already logged in
        if (!page.url().includes('/login')) {
            appLogger.info(`[SharedBrowserPool] Already logged in (skipped login, ${Date.now() - start}ms)`);
            return;
        }

        // Fill credentials - Using human-like interaction to bypass readonly/event-listener blockers
        const idField = page.locator('input[name="idnumber"]').first();
        await idField.click({ timeout: 10000 });
        await page.waitForTimeout(200);
        await idField.fill(credentials.idNumber);
        await page.keyboard.press('Tab');
        
        const userField = page.locator('input[name="username"]').first();
        await userField.click({ timeout: 10000 });
        await page.waitForTimeout(200);
        await userField.fill(credentials.username);
        await page.keyboard.press('Tab');
        
        const passField = page.locator('input[type="password"]').first();
        await passField.click({ timeout: 10000 });
        await page.waitForTimeout(200);
        await passField.fill(credentials.password);
        await page.keyboard.press('Enter');

        // Wait for navigation away from login
        await page.waitForURL((url: URL) => !url.href.includes('/login'), { timeout: 30000 });
        await page.waitForTimeout(3000); // Wait for app bootstrap after login redirect

        appLogger.info(`[SharedBrowserPool] Login completed in ${Date.now() - start}ms`);
    }

    /**
     * Wait for Angular to stabilize on the current page.
     */
    async waitForAngularStable(page: Page, timeoutMs: number = 8000): Promise<void> {
        try {
            await page.evaluate(async (timeout: number) => {
                const checkForLoading = () => !document.querySelector('.k-loading-mask, .loading-overlay, .spinner-border');
                if (!checkForLoading()) {
                    await new Promise<void>((resolve) => {
                        const observer = new MutationObserver(() => {
                            if (checkForLoading()) { observer.disconnect(); resolve(); }
                        });
                        observer.observe(document.body, { childList: true, subtree: true });
                        setTimeout(() => { observer.disconnect(); resolve(); }, 4000);
                    });
                }
            }, timeoutMs);
        } catch {
            await page.waitForTimeout(1500);
        }
    }

    /**
     * Shutdown the browser pool.
     */
    async shutdown(): Promise<void> {
        appLogger.info('[SharedBrowserPool] Shutting down...');
        if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
        if (this.idleTimer) clearTimeout(this.idleTimer);
        await this.closeCurrent();
        SharedBrowserPool._instance = null;
    }

    /**
     * Start periodic health checks (Placeholder for API compatibility).
     */
    startHealthMonitoring(): void {
        appLogger.info('[SharedBrowserPool] Health monitoring started.');
        // Implementation can be added here if needed
    }

    /**
     * Check if the browser pool is healthy.
     */
    async isHealthy(): Promise<boolean> {
        if (!this.browser) return true; // Healthy if not yet launched
        try {
            return this.browser.isConnected();
        } catch {
            return false;
        }
    }

    /**
     * Get pool usage statistics.
     */
    getStats() {
        const idleMs = this.lastUsedAt > 0 ? Date.now() - this.lastUsedAt : 0;
        const isHealthy = !this.browser || this.browser.isConnected();

        return {
            launchCount: this.launchCount,
            reuseCount: this.reuseCount,
            activeContexts: this.activeContexts,
            inUse: this.activeContexts > 0,
            isHealthy: isHealthy,
            idleSeconds: Math.floor(idleMs / 1000),
            lastUsedAt: this.lastUsedAt > 0 ? new Date(this.lastUsedAt).toISOString() : 'never'
        };
    }

    private async closeCurrent(): Promise<void> {
        if (this.browser) {
            await this.browser.close().catch(() => {});
            this.browser = null;
        }
        this.activeContexts = 0;
    }

    private resetIdleTimer(): void {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(async () => {
            if (this.activeContexts === 0 && this.browser) {
                appLogger.info('[SharedBrowserPool] Idle timeout — closing browser');
                await this.closeCurrent();
            }
        }, SharedBrowserPool.IDLE_TIMEOUT_MS);
    }
}
