import { Page } from 'playwright';
import { SharedBrowserPool, BrowserContextHandle } from './discovery/SharedBrowserPool';
import { MultiAgentRouter } from '../../api/MultiAgentRouter';
import { appLogger } from '../utils/logger';
import { DbClient, TelemetryService } from './shared/TelemetryService';

/**
 * AutonomousCrawlerService
 * 
 * Performs "Knowledge-Hardened Autonomous UI Discovery":
 * 1. Persistent Login
 * 2. Right Menu Crawling
 * 3. Targeted Workflow Probing (With Sidebar Expansion)
 * 4. Reusable POM Generation
 */
export class AutonomousCrawlerService {
    private static pool = SharedBrowserPool.getInstance();

    static async crawlApplication(baseUrl: string, credentials: any, db: DbClient): Promise<void> {
        const ticketId = credentials.ticketId || 'GLOBAL-SCAN';
        const broadcast = (msg: string) => {
            appLogger.info(`[AutonomousCrawler] ${msg}`);
            TelemetryService.add({
                category: 'INFO', source: 'AutonomousCrawler', message: msg, metadata: { ticketId }
            });
        };

        broadcast(`🚀 Starting Autonomous Discovery for **${baseUrl}**`);
        let handle: BrowserContextHandle | null = null;

        try {
            handle = await this.pool.acquireContext();
            broadcast("📡 **Live Handshake:** Testing connection...");
            await handle.page.goto(baseUrl, { waitUntil: 'load', timeout: 30000 });
            
            broadcast(`🔑 Authenticating as **${credentials.username}**...`);
            await this.pool.performLogin(handle.page, `${baseUrl}#/login`, credentials);
            broadcast("✅ **Auth Success.** session ready.");
            
            const routes = await this.discoverMenuTree(handle.page, broadcast);
            broadcast(`📍 Discovered **${routes.length}** functional modules.`);

            if (db && typeof db.query === 'function') {
                for (const route of routes) {
                    try {
                        await db.query(`
                            INSERT INTO module_route_map (module_name, parent_menu, full_path, url)
                            VALUES ($1, $2, $3, $4)
                            ON CONFLICT (module_name) DO UPDATE SET last_crawled_at = CURRENT_TIMESTAMP
                        `, [route.name, route.parent, route.fullPath, route.url]);
                    } catch (dbErr: any) {
                        appLogger.error(`[AutonomousCrawler] DB sync error for ${route.name}: ${dbErr.message}`);
                    }
                }
            } else {
                broadcast("⚠️ **Warning:** DB client not available. Skipping persistent module sync.");
            }

            // 🎯 TARGETED DISCOVERY: Match module to Jira ticket
            let targetModule = null;
            if (credentials.ticketId) {
                broadcast(`🧠 **Targeting:** AI is matching module for ticket [${credentials.ticketId}]...`);
                const { JiraService } = require('../../api/JiraService');
                const ticket = await JiraService.fetchTicket(credentials.ticketId);
                
                const searchTerms = [
                    ...ticket.summary.toLowerCase().split(' '),
                    ...(ticket.description?.toLowerCase()?.split(' ') || [])
                ].filter(t => t.length > 3);

                // Priority 1: Exact Match or "Journal" specific
                targetModule = routes.find(r => 
                    ticket.summary.toLowerCase().includes(r.name.toLowerCase()) ||
                    (r.name.toLowerCase().includes('journal') && ticket.summary.toLowerCase().includes('journal'))
                );

                // Priority 2: Keyword match
                if (!targetModule) {
                    targetModule = routes.find(r => 
                        searchTerms.some(term => r.name.toLowerCase().includes(term))
                    );
                }
            }

            if (targetModule) {
                broadcast(`🎯 **Target Found:** Module [${targetModule.name}] matches Jira mission.`);

                // FORCE SIDEBAR EXPANSION
                broadcast(`📡 **Navigation:** Expanding sidebar to reach ${targetModule.name}...`);
                await handle.page.evaluate((moduleName: string) => {
                    const findAndClick = (text: string) => {
                        const els = Array.from(document.querySelectorAll('a, span, .list-group-item'));
                        const match = els.find(el => el.textContent?.trim().toLowerCase() === text.toLowerCase()) as HTMLElement;
                        if (match) {
                            match.click();
                            return true;
                        }
                        return false;
                    };

                    // 1. Try to click Master first (if not expanded)
                    findAndClick('Master');
                    // 2. Click the actual module
                    setTimeout(() => findAndClick(moduleName), 1000);
                }, targetModule.name);

                // Wait for URL change or Grid load
                await handle.page.waitForTimeout(5000);
                await this.probeModuleWorkflow(handle.page, targetModule, db, broadcast, ticketId);
                
                // KNOWLEDGE HARDENING: Generate Reusable POM
                const { POMGeneratorService } = require('./POMGeneratorService');
                const rules = await db.query(`SELECT * FROM workflow_rules WHERE module_name = $1`, [targetModule.name]);
                if (rules.rows.length > 0) {
                    const pomPath = await POMGeneratorService.generate(targetModule.name, rules.rows[0]);
                    broadcast(`📦 **Reusability Enabled:** Generated Page Object: \`${pomPath.split(/[\\/]/).pop()}\`.`);
                }
            } else {
                broadcast("⚠️ **Target Mismatch:** Could not find specific module. Falling back to safety scan...");
                for (const route of routes.slice(0, 2)) { 
                    await this.probeModuleWorkflow(handle.page, route, db, broadcast, ticketId);
                }
            }

            broadcast("🏁 **Mission Complete.** Knowledge Base updated.");
        } catch (err: any) {
            broadcast(`❌ **Discovery Aborted:** ${err.message}`);
        } finally {
            if (handle) await this.pool.releaseContext(handle);
        }
    }

    private static async discoverMenuTree(page: Page, broadcast: (m: string) => void): Promise<any[]> {
        broadcast("🔍 **Scanning Sidebar...**");
        await page.waitForSelector('a, .k-link, [role=\"menuitem\"]', { timeout: 10000 }).catch(() => {});

        return await page.evaluate(async () => {
            const routes: any[] = [];
            const links = document.querySelectorAll('a[href*="#"], .k-link, [role=\"menuitem\"]');
            for (const link of Array.from(links)) {
                const el = link as HTMLElement;
                const name = el.innerText?.trim();
                const url = el.getAttribute('href') || (el.querySelector('a')?.getAttribute('href'));
                if (name && name.length > 2 && url && url.includes('#')) {
                    routes.push({ name, url, fullPath: name });
                }
            }
            return routes;
        });
    }

    private static async probeModuleWorkflow(page: Page, route: any, db: DbClient, broadcast: (m: string) => void, ticketId: string): Promise<void> {
        broadcast(`👁️ **Inspecting:** [${route.name}]...`);
        try {
            const targetUrl = route.url.startsWith('http') ? route.url : `${page.url().split('#')[0].split('/ook')[0]}${route.url}`;
            await page.goto(targetUrl, { waitUntil: 'networkidle' });
            await new Promise(r => setTimeout(r, 5000)); // 5s wait for Grid

            // Find and Click Add New - Enhanced with Force & JS fallbacks
            let addFound = false;
            const addSelectors = [
                '.k-grid-add', 
                'button:has-text("Add")', 
                '.k-button:has-text("Add")', 
                'a.k-button:has-text("Add")',
                '.k-command-cell .k-button',
                'text="Add New"',
                'text="Create"'
            ];

            for (const sel of addSelectors) {
                const locator = page.locator(sel).first();
                if (await locator.isVisible()) {
                    broadcast(`🎯 **Targeting Button:** Found match with selector [\`${sel}\`]. Attempting interaction...`);
                    
                    try {
                        await locator.click({ timeout: 3000 });
                        addFound = true;
                    } catch (e) {
                        broadcast("🛡️ **Bypassing Overlays:** Attempting Force-Click...");
                        await locator.click({ force: true }).then(() => { addFound = true; }).catch(() => {});
                    }

                    if (!addFound) {
                        broadcast("☢️ **Injecting JS Event:** Triggering DOM click directly...");
                        await page.evaluate((selector: string) => {
                            const el = document.querySelector(selector) as HTMLElement;
                            if (el) el.click();
                        }, sel);
                        addFound = true;
                    }
                    break;
                }
            }

            if (!addFound) {
                broadcast("⚠️ **Interaction Failed:** 'Add New' button not reachable. Using static scan.");
            } else {
                broadcast("🛰️ **Action Successful:** 'Add New' clicked. Waiting for form...");
                await page.waitForSelector('.k-window, .modal-content, form, .k-edit-form', { state: 'visible', timeout: 8000 }).catch(() => {});
            }

            // Capture UI Structure
            let ariaSnapshot = {};
            try {
                if ((page as any).accessibility) {
                    ariaSnapshot = await (page as any).accessibility.snapshot();
                }
            } catch (e) {}

            const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 50 });
            const imageBase64 = screenshotBuffer.toString('base64');

            TelemetryService.add({
                category: 'AI', source: 'VisionFeed', message: `Form Probe: ${route.name}`, metadata: { ticketId, screenshot: imageBase64 }
            });

            broadcast("🧠 **AI Analysis:** Identifying required fields and validation rules...");
            
            const isBug = ticketId.toLowerCase().includes('bug') || ticketId.startsWith('BUG-') || ticketId.startsWith('ATT-'); 
            const strategyPrompt = isBug 
                ? 'Identify the specific fields mentioned in the bug report and find the "Save" button. Focus on finding missing validation markers (asterisks).'
                : 'This is a User Story. Map EVERY input, dropdown, and checkbox. Identify the full happy-path flow for this new feature.';

            const analysis = await MultiAgentRouter.route('VISION', JSON.stringify([
                { type: 'text', text: `${strategyPrompt} Output a structured list of fields.` },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
            ]));

            await db.query(`
                INSERT INTO workflow_rules (module_name, action_type, required_fields, restriction_rules)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (module_name, action_type) DO UPDATE SET discovered_at = CURRENT_TIMESTAMP
            `, [route.name, 'ADD_NEW', JSON.stringify(analysis.response), JSON.stringify({ ariaSnapshot })]);
            
            broadcast(`✅ **Knowledge Saved:** ${route.name} workflow mapped.`);

        } catch (err: any) {
            broadcast(`⚠️ **Probe Error:** ${err.message}`);
        }
    }
}
