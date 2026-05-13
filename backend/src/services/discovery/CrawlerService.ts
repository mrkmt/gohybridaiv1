import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
import { CliAgentService } from '../../../api/CliAgentService';
import { LocalAIService } from '../../../api/LocalAIService';
import { config } from '../../../api/config';
import { ElementRepositoryService } from '../ElementRepositoryService';
import { UsageTrackerService } from '../shared/UsageTrackerService';
import { buildLoginUrl, DiscoveryMode, DiscoveryRequest, getBlockedTermsForMode, getDiscoveryStorageDir } from './DiscoveryConfig';
import { DiscoveryRunService, DiscoveryCheckpoint } from './DiscoveryRunService';
import { SharedBrowserPool } from './SharedBrowserPool';

type Browser = any;
type Page = any;

interface LoginSession {
    browser: Browser;
    page: Page;
    landingUrl: string;
}

interface DiscoveryPreflightResult {
    success: boolean;
    loginUrl: string;
    landingUrl?: string;
    message: string;
}

interface DiscoveryTask {
    url: string;
    depth: number;
}

export class CrawlerService {
    private activeBrowser: Browser | null = null;
    private visitedUrls = new Set<string>();
    private pendingTasks: DiscoveryTask[] = [];
    private pageHashes = new Map<string, string>();

    private hashSnippet(snippet: string): string {
        let hash = 0;
        for (let i = 0; i < snippet.length; i++) {
            const char = snippet.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(36);
    }

    async preflightLogin(request: DiscoveryRequest): Promise<DiscoveryPreflightResult> {
        let session: LoginSession | null = null;
        const loginUrl = buildLoginUrl(request);

        try {
            session = await this.openAndLogin(request);
            return {
                success: true,
                loginUrl,
                landingUrl: session.landingUrl,
                message: 'Login verified successfully.',
            };
        } catch (error: any) {
            return {
                success: false,
                loginUrl,
                message: error?.message || 'Login failed.',
            };
        } finally {
            if (session) {
                await SharedBrowserPool.getInstance().releaseContext(session.page);
            }
        }
    }

    public async startDiscovery(request: DiscoveryRequest, runId: string): Promise<void> {
        DiscoveryRunService.markRunning(runId);

        // 1. Check for Checkpoint
        const checkpoint = await DiscoveryRunService.getCheckpoint(runId);
        if (checkpoint) {
            this.recordRunEvent(runId, 'info', `Resuming discovery from checkpoint. ${checkpoint.visitedUrls.length} pages already visited.`);
            this.visitedUrls = new Set(checkpoint.visitedUrls);
            this.pendingTasks = checkpoint.pendingUrls;
        } else {
            this.recordRunEvent(runId, 'info', `Starting fresh discovery on ${request.baseUrl} (Depth: ${request.maxDepth})`);
            this.visitedUrls = new Set<string>();
            this.pendingTasks = [];
        }

        let session: LoginSession | null = null;

        try {
            session = await this.openAndLogin(request, runId);
            this.activeBrowser = session.browser;

            if (!checkpoint) {
                this.pendingTasks.push({ url: session.landingUrl, depth: 1 });
            }

            // 2. Main Discovery Loop (Queue-based for better checkpointing)
            while (this.pendingTasks.length > 0) {
                // Check if we hit the global limits
                const maxPages = request.deepCrawl ? config.discovery.deepMaxPages : config.discovery.maxPages;
                if (this.visitedUrls.size >= maxPages) {
                    this.recordRunEvent(runId, 'warn', `Global page limit (${maxPages}) reached. Stopping.`);
                    break;
                }

                const currentTask = this.pendingTasks.shift()!;
                if (this.visitedUrls.has(currentTask.url)) continue;

                await this.processDiscoveryTask(session.page, request, runId, currentTask);

                // Save checkpoint after every successful page
                DiscoveryRunService.saveCheckpoint(runId, {
                    runId,
                    visitedUrls: Array.from(this.visitedUrls),
                    pendingUrls: this.pendingTasks
                });
            }

            DiscoveryRunService.markCompleted(runId);
            this.recordRunEvent(runId, 'info', 'Discovery completed successfully.');
        } catch (error: any) {
            const message = error?.message || 'Unknown discovery failure';
            DiscoveryRunService.markFailed(runId, message);
            this.recordRunEvent(runId, 'error', message);
            throw error;
        } finally {
            if (session) {
                await SharedBrowserPool.getInstance().releaseContext(session.page);
                this.activeBrowser = null;
            }
        }
    }

    private async processDiscoveryTask(
        page: Page,
        request: DiscoveryRequest,
        runId: string,
        task: DiscoveryTask
    ): Promise<void> {
        const { url, depth } = task;
        const maxDepth = request.maxDepth ?? config.discovery.maxDepth;
        if (depth > maxDepth) return;

        this.visitedUrls.add(url);
        const pageNumber = this.visitedUrls.size;
        DiscoveryRunService.updateStats(runId, { pagesDiscovered: pageNumber });

        const maxAttempts = Math.max(1, config.discovery.retryCount + 1);

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                this.recordRunEvent(runId, 'info', `Crawling URL [Depth ${depth}]: ${url}`, url, { attempt }, true);
                
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.discovery.pageTimeoutMs });
                await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                await page.waitForTimeout(1000); // Reduced SPA hydration wait

                // Live Screenshot Capture
                const liveScreenshot = await this.captureLiveScreenshot(page, runId, pageNumber);
                if (liveScreenshot) DiscoveryRunService.addScreenshot(runId, liveScreenshot);

                const htmlSnippet = await this.captureInteractiveElements(page, request.mode);

                // Content Hashing to skip redundant AI analysis if page hasn't changed
                const snippetHash = this.hashSnippet(htmlSnippet);
                const existing = await ElementRepositoryService.getElementsByPage(url);
                const previousHash = this.pageHashes.get(url);

                if (previousHash === snippetHash && existing.length > 0) {
                    this.recordRunEvent(runId, 'info', `Content unchanged: Skipping AI for ${url}`, url, undefined, true);
                    if (depth < maxDepth) {
                        await this.enqueueNewLinks(page, runId, depth, request.mode);
                    }
                    return;
                }

                // Update hash for this page
                this.pageHashes.set(url, snippetHash);

                if (request.incremental && existing.length > 0) {
                    this.recordRunEvent(runId, 'info', `Incremental: Skipping AI for ${url}`, url, undefined, true);
                    if (depth < maxDepth) {
                        await this.enqueueNewLinks(page, runId, depth, request.mode);
                    }
                    return;
                }

                const prompt = this.getDiscoveryPrompt(url, request.mode, htmlSnippet);
                const aiResponse = await this.generateSelectorAnalysis(prompt, request.aiModel);

                if (aiResponse) {
                    await this.processAIAnalysis(aiResponse, url, runId, pageNumber, request.mode);
                }

                // Discover more links
                if (depth < maxDepth) {
                    await this.enqueueNewLinks(page, runId, depth, request.mode);
                }

                return;
            } catch (error: any) {
                if (attempt === maxAttempts) {
                    const screenshot = await this.captureFailureScreenshot(page, runId, pageNumber);
                    if (screenshot) DiscoveryRunService.addScreenshot(runId, screenshot);
                    throw error;
                }
                await page.waitForTimeout(2000);
            }
        }
    }

    private async enqueueNewLinks(page: Page, runId: string, currentDepth: number, mode: DiscoveryMode): Promise<void> {
        const menuLinks = await this.discoverMenus(page, runId, mode);
        const otherLinks = await this.discoverLinksOnPage(page, page.url());
        const allLinks = [...new Set([...menuLinks, ...otherLinks])];

        for (const link of allLinks) {
            if (!this.visitedUrls.has(link) && !this.pendingTasks.some(t => t.url === link)) {
                this.pendingTasks.push({ url: link, depth: currentDepth + 1 });
            }
        }
    }

    public async openAndLogin(request: DiscoveryRequest, runId?: string): Promise<LoginSession> {
        const browserPool = SharedBrowserPool.getInstance();
        const handle = await browserPool.acquireContext();
        const page = handle.page;
        const context = handle.context;
        const browser = handle.browser;
        const loginUrl = buildLoginUrl(request);

        try {
            if (runId) this.recordRunEvent(runId, 'info', `Navigating to login: ${loginUrl}`, undefined, undefined, true);
            await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: config.discovery.pageTimeoutMs });

            // Give extra time for the application to initialize (some SPAs take time)
            await page.waitForTimeout(3000);

            // if runId, scan login page objects
            if (runId) {
                this.recordRunEvent(runId, 'info', `Capturing login page elements: ${loginUrl}`, undefined, undefined, true);
                const htmlSnippet = await this.captureInteractiveElements(page, request.mode, true);

                // Non-blocking AI analysis for the login page
                this.processLoginScanAsync(runId, loginUrl, request.mode, request.aiModel, htmlSnippet).catch(err => {
                    this.recordRunEvent(runId, 'warn', `Login scan background processing failed: ${err.message}`);
                });
            }

            // Resilient idnumber selection
            const idNumberSelectors = [
                'input[name="idnumber"]',
                '[ng-reflect-name="idnumber"]',
                '#idnumber',
                '.k-textbox[name="idnumber"]'
            ];
            const idField = await this.waitForAnySelector(page, idNumberSelectors);
            if (!idField) throw new Error('Could not find idnumber field. The page might still be loading or has a different structure.');
            await this.safeFill(page, idField, request.idNumber);

            // Resilient username selection
            const usernameSelectors = [
                'input[name="username"]',
                '[ng-reflect-name="username"]',
                '#username',
                '.k-textbox[name="username"]'
            ];
            const userField = await this.waitForAnySelector(page, usernameSelectors);
            if (userField) {
                await this.safeFill(page, userField, request.username);
            }

            // Resilient password selection
            const passwordSelectors = [
                'input[type="password"]',
                'input[name="password"]',
                '[ng-reflect-name="password"]',
                '#password'
            ];
            const passField = await this.waitForAnySelector(page, passwordSelectors);
            if (!passField) throw new Error('Could not find password field.');
            await this.safeFill(page, passField, request.password);

            await page.click('button[type="submit"], .btn-primary, .k-button[type="submit"], #btnLogin');

            // Wait for navigation or successful indicator
            await page.waitForLoadState('networkidle', { timeout: config.discovery.pageTimeoutMs });
            await page.waitForTimeout(2000);

            const landingUrl = page.url();
            if (/login/i.test(landingUrl)) {
                // If still on login, check for visible error messages
                const error = await page.evaluate(() => {
                    const el = document.querySelector('.error, .alert-danger, .k-notification-error');
                    return el ? el.textContent?.trim() : null;
                });
                throw new Error(error ? `Login rejected: ${error}` : 'Credentials accepted but still on login screen.');
            }

            return { browser, page, landingUrl };
        } catch (error: any) {
            await browser.close();
            throw error;
        }
    }

    /**
     * Handle fields that might be 'readonly' until focused (anti-autofill logic)
     */
    private async safeFill(page: Page, selector: string, value: string): Promise<void> {
        try {
            // First try to focus/click to trigger any onfocus handlers that remove readonly
            await page.click(selector);
            await page.focus(selector);

            // Force remove readonly via JS if it's still there (fallback)
            await page.evaluate((sel: string) => {
                const el = document.querySelector(sel);
                if (el) {
                    el.removeAttribute('readonly');
                    (el as any).readOnly = false;
                }
            }, selector);

            await page.fill(selector, value);
        } catch (err: any) {
            console.warn(`[Crawler] safeFill warning on ${selector}: ${err.message}`);
            // Last resort: force the value via evaluate
            await page.evaluate(({ sel, val }: { sel: string; val: string }) => {
                const el = document.querySelector(sel) as HTMLInputElement;
                if (el) {
                    el.value = val;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, { sel: selector, val: value });
        }
    }

    private async waitForAnySelector(page: Page, selectors: string[]): Promise<string | null> {
        for (const selector of selectors) {
            try {
                if (await page.locator(selector).isVisible({ timeout: 2000 })) {
                    return selector;
                }
            } catch {
                continue;
            }
        }
        return null;
    }

    private async discoverMenus(page: Page, runId: string, mode: DiscoveryMode): Promise<string[]> {
        const menuSelectors = ['.sidebar-nav', '.menu-item', '.k-panelbar', '.nav-item', '.k-menu', '.main-menu'];
        const blockedTerms = [...getBlockedTermsForMode(mode)];
        
        // Wait for at least one common menu container to appear
        try {
            await Promise.race(menuSelectors.map(s => page.waitForSelector(s, { timeout: 3000 }).catch(() => new Promise(() => {}))));
        } catch {
            // Ignore if no menu containers found within 3s
        }

        const menuItems = await page.$$eval(
            '.sidebar-nav a, .menu-item a, .k-panelbar-item > a, .nav-item a, .k-menu-link, .k-link',
            (links: Element[], dangerousTerms: string[]) => links
                .map((link: Element) => {
                    const anchor = link as HTMLAnchorElement;
                    const href = anchor.href || '';
                    const text = (anchor.textContent || '').trim().toLowerCase();
                    return { href, text };
                })
                .filter((item: { href: string; text: string }) => item.href.includes('#/') && !item.href.includes('/login') && !item.href.includes('/logout'))
                .filter((item: { href: string; text: string }) => !dangerousTerms.some((term: string) => item.href.toLowerCase().includes(term) || item.text.includes(term)))
                .map((item: { href: string; text: string }) => item.href),
            blockedTerms
        );

        const unique = [...new Set(menuItems)] as string[];
        if (unique.length > 0) {
            this.recordRunEvent(runId, 'info', `Discovered ${unique.length} primary menu links.`);
        }
        return unique;
    }

    private async captureInteractiveElements(page: Page, mode: DiscoveryMode, isLoginPage = false): Promise<string> {
        const blockedTerms = [...getBlockedTermsForMode(mode)];

        return page.evaluate(({ dangerousTerms, isLoginPage }: { dangerousTerms: string[]; isLoginPage: boolean }) => {
            const findContext = (element: HTMLElement) => {
                const ctxSelectors = [
                    'kendo-textbox', 'kendo-dropdownlist', 'kendo-combobox',
                    'kendo-datepicker', 'kendo-checkbox', 'kendo-switch',
                    '[ng-reflect-name]', '[formControlName]', '[formcontrolname]'
                ];
                for (const s of ctxSelectors) {
                    const parent = element.closest(s);
                    if (parent) return parent as HTMLElement;
                }
                return null;
            };

            const getBusinessName = (element: HTMLElement, context: HTMLElement | null): string => {
                return context?.getAttribute('ng-reflect-name') ||
                    context?.getAttribute('formControlName') ||
                    context?.getAttribute('formcontrolname') ||
                    element.getAttribute('name') ||
                    element.getAttribute('aria-label') ||
                    element.getAttribute('placeholder') ||
                    (element.tagName === 'BUTTON' ? element.innerText : null) ||
                    '-';
            };

            const getStableSelector = (element: HTMLElement, context: HTMLElement | null): string => {
                // Priority 1: name attribute
                const name = element.getAttribute('name');
                if (name) return `${element.tagName.toLowerCase()}[name="${name}"]`;

                // Priority 2: Angular form controls
                const fc = context?.getAttribute('formControlName') || context?.getAttribute('formcontrolname');
                if (fc) return `[formControlName="${fc}"]`;

                const nr = context?.getAttribute('ng-reflect-name');
                if (nr) return `[ng-reflect-name="${nr}"]`;

                // Priority 3: Stable ID
                if (element.id && !element.id.startsWith('k-')) return `#${element.id}`;

                // Priority 4: Extension's unique path logic simplified
                const tag = element.tagName.toLowerCase();
                const parent = element.parentElement;
                if (!parent) return tag;
                const siblings = Array.from(parent.children).filter(c => c.tagName === element.tagName);
                if (siblings.length > 1) {
                    const index = siblings.indexOf(element) + 1;
                    return `${tag}:nth-child(${index})`;
                }
                return tag;
            };

            const selectors = [
                'button', 'input', 'select', 'textarea', 'a', '[role="button"]',
                'kendo-textbox', 'kendo-dropdownlist', 'kendo-combobox', 'kendo-datepicker',
                'kendo-numerictextbox', 'kendo-grid', 'kendo-checkbox', 'kendo-switch',
                '[ng-reflect-name]', '[formcontrolname]', '[formControlName]', '[data-role]'
            ];

            const elements = Array.from(document.querySelectorAll(selectors.join(',')));

            // Relaxed dangerous terms for login page (must allow 'submit')
            const activeDangerousTerms = isLoginPage
                ? dangerousTerms.filter(t => t !== 'submit' && t !== 'post')
                : dangerousTerms;

            const isDangerous = (text: string) => activeDangerousTerms.some(term => text.toLowerCase().includes(term.toLowerCase()));

            const results = elements.map(el => {
                const element = el as HTMLElement;
                const context = findContext(element);
                const businessName = getBusinessName(element, context);
                const selector = getStableSelector(element, context);

                if (isDangerous(businessName) || isDangerous(element.innerText) || isDangerous(element.getAttribute('aria-label') || '')) {
                    return null;
                }

                return {
                    tag: element.tagName.toLowerCase(),
                    type: element.getAttribute('type') || (context?.tagName?.toLowerCase() || 'other'),
                    name: element.getAttribute('name') || '',
                    businessName: businessName,
                    selector: selector,
                    placeholder: element.getAttribute('placeholder') || '',
                    aria: element.getAttribute('aria-label') || '',
                    text: element.innerText?.trim().substring(0, 50) || '',
                    section: element.closest('section, .card, .panel, .form-group')?.className?.substring(0, 30) || ''
                };
            }).filter(Boolean);

            return JSON.stringify(results.slice(0, 100));
        }, { dangerousTerms: blockedTerms, isLoginPage });
    }

    private getDiscoveryPrompt(url: string, mode: DiscoveryMode, jsonData: string): string {
        const modeGuidance = mode === 'test-create'
            ? 'This is TEST-CREATE mode. Keep create/new/add/save/submit controls when they are part of safe test-data setup, but exclude destructive or irreversible actions like delete/remove/reject/finalize/import/process.'
            : 'This is LIVE-READONLY mode. Exclude controls that can mutate data, including create/add/save/submit/delete/approve/import/process/finalize actions.';

        return [
            `Analyze the following discovered UI elements from ${url} (Mode: ${mode}).`,
            modeGuidance,
            'The input is a JSON array of component metadata (businessName, selector, etc.).',
            'Validate and refine these elements. Return a JSON array of verified objects.',
            'Each object MUST have:',
            '- page (string)',
            '- elementName (descriptive name, refine from metadata)',
            '- selector (Playwright-compatible, refine from metadata)',
            '- type (button|input|select|link|text|other)',
            '- confidence (0-100)',
            '- businessLogicHint (what does this element likely do in terms of HR/Business logic?)',
            '- relatedModule (Leave|Payroll|Attendance|Employee|Other)',
            '',
            'Return ONLY the JSON array.',
            '',
            jsonData
        ].join('\n');
    }

    private async discoverLinksOnPage(page: Page, currentUrl: string): Promise<string[]> {
        const baseUrl = new URL(currentUrl).origin;
        const links = await page.$$eval('a', (anchors: Element[], base: string) => {
            return (anchors as HTMLAnchorElement[])
                .map(a => a.href)
                .filter(href => href.startsWith(base) && !href.includes('/logout') && !href.includes('/login'))
                .filter(href => !href.includes('#') || href.includes('#/')); // Improved SPA hash routing support
        }, baseUrl);
        return [...new Set(links)] as string[];
    }

    private async processAIAnalysis(aiResponse: string, url: string, runId: string, pageNumber: number, mode: DiscoveryMode): Promise<void> {
        try {
            const jsonText = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
            const arrayMatch = jsonText.match(/\[[\s\S]*\]/);
            if (!arrayMatch) return;

            const parsed = JSON.parse(arrayMatch[0]) as Array<Record<string, any>>;
            const safeElements = parsed
                .filter(item => typeof item.selector === 'string' && !this.containsDangerousTerm(`${item.selector} ${item.elementName || ''}`, mode))
                .map(item => ({
                    page: String(item.page || url),
                    elementName: String(item.elementName || 'Unnamed element'),
                    selector: String(item.selector || ''),
                    type: this.normalizeElementType(item.type),
                    confidence: Number(item.confidence || 0),
                    businessLogicHint: String(item.businessLogicHint || ''),
                    relatedModule: String(item.relatedModule || 'Other'),
                    discoveredAt: new Date().toISOString()
                }));

            await ElementRepositoryService.addElements(safeElements as any);

            // Update stats in the run record
            const run = await DiscoveryRunService.getById(runId);
            const newTotal = (run?.elementsExtracted || 0) + safeElements.length;
            DiscoveryRunService.updateStats(runId, { elementsExtracted: newTotal });

            this.recordRunEvent(runId, 'info', `Stored ${safeElements.length} elements from page ${pageNumber}. Total: ${newTotal}`, url);
        } catch (e) {
            console.error('Failed to process AI analysis:', e);
        }
    }

    private async generateSelectorAnalysis(prompt: string, aiModel: string): Promise<string> {
        console.log(`[Crawler] Sending prompt to AI model (${aiModel})...`);
        const startTime = Date.now();
        
        const localResponse = await LocalAIService.simpleGenerate(prompt, aiModel, { 
            timeoutMs: config.ai.scriptGenTimeoutMs
        });
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);

        if (localResponse) {
            console.log(`[Crawler] AI response received in ${duration}s.`);
            await UsageTrackerService.logUsage({
                model: aiModel,
                taskType: 'crawler-generation',
                inputChars: prompt.length,
                outputChars: localResponse.length
            });
            return localResponse;
        }

        if (config.discovery.allowCloudFallback) {
            console.log(`[Crawler] Local AI failed, falling back to cloud AI (gemini)...`);
            const cloudStartTime = Date.now();
            const cloudResponse = await CliAgentService.generateFromCli(prompt, 'gemini');
            const cloudDuration = ((Date.now() - cloudStartTime) / 1000).toFixed(1);
            if (cloudResponse) {
                console.log(`[Crawler] Cloud AI response received in ${cloudDuration}s.`);
                await UsageTrackerService.logUsage({
                    model: 'gemini-1.5-pro',
                    taskType: 'crawler-generation',
                    inputChars: prompt.length,
                    outputChars: cloudResponse.length
                });
                return cloudResponse;
            }
        }

        return '';
    }

    private normalizeElementType(type: unknown): 'button' | 'input' | 'select' | 'link' | 'text' | 'other' {
        const value = String(type || 'other').toLowerCase();
        if (value === 'button' || value === 'input' || value === 'select' || value === 'link' || value === 'text') {
            return value;
        }
        return 'other';
    }

    private containsDangerousTerm(value: string, mode: DiscoveryMode): boolean {
        const lower = value.toLowerCase();
        return getBlockedTermsForMode(mode).some(term => lower.includes(term));
    }

    private recordRunEvent(
        runId: string,
        level: 'info' | 'warn' | 'error',
        message: string,
        page?: string,
        metadata?: Record<string, unknown>,
        broadcastToTelegram = false
    ): void {
        DiscoveryRunService.appendEvent(runId, {
            timestamp: new Date().toISOString(),
            level,
            message,
            page,
            metadata,
        });
    }

    /**
     * Helper to process login page elements in the background to avoid blocking login
     */
    private async processLoginScanAsync(
        runId: string,
        url: string,
        mode: DiscoveryMode,
        aiModel: string,
        htmlSnippet: string
    ): Promise<void> {
        try {
            this.recordRunEvent(runId, 'info', `Analyzing login page components in background...`, url, undefined, true);
            const prompt = this.getDiscoveryPrompt(url, mode, htmlSnippet);
            const aiResponse = await this.generateSelectorAnalysis(prompt, aiModel);
            if (aiResponse) {
                this.recordRunEvent(runId, 'info', `Processing background scan results...`, url, undefined, true);
                await this.processAIAnalysis(aiResponse, url, runId, 0, mode); // 0 for login page
                this.recordRunEvent(runId, 'info', `Background login page scan complete.`, undefined, undefined, true);
            }
        } catch (err: any) {
            this.recordRunEvent(runId, 'warn', `Background scan failed: ${err.message}`);
            console.error('[Crawler] Background login scan error:', err);
        }
    }

    private async captureLiveScreenshot(page: Page, runId: string, pageNumber: number): Promise<string | undefined> {
        try {
            const dir = path.join(getDiscoveryStorageDir(), 'screenshots', runId);
            fs.mkdirSync(dir, { recursive: true });
            const screenshotPath = path.join(dir, `live-${pageNumber}.png`);
            await page.screenshot({ path: screenshotPath });
            return screenshotPath;
        } catch {
            return undefined;
        }
    }

    private async captureFailureScreenshot(page: Page, runId: string, pageNumber: number): Promise<string | undefined> {
        try {
            const dir = path.join(getDiscoveryStorageDir(), 'screenshots');
            fs.mkdirSync(dir, { recursive: true });
            const screenshotPath = path.join(dir, `${runId}-page-${pageNumber}.png`);
            await page.screenshot({ path: screenshotPath, fullPage: true });
            return screenshotPath;
        } catch {
            return undefined;
        }
    }

    public async cleanup(runId?: string): Promise<void> {
        if (runId) {
            this.recordRunEvent(runId, 'warn', 'Discovery interrupted (Manual Stop). Cleaning up...', undefined, undefined, true);
        }

        if (this.activeBrowser) {
            try {
                console.log('[Crawler] Closing active browser...');
                await this.activeBrowser.close();
            } catch (err) {
                // Ignore close errors
            } finally {
                this.activeBrowser = null;
            }
        }

    }
}

export type { DiscoveryPreflightResult };
