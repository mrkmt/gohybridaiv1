import { JiraService } from './JiraService';
import { PageElementDiscoveryService } from '../src/services/discovery/PageElementDiscoveryService';
import { SharedBrowserPool } from '../src/services/discovery/SharedBrowserPool';
import { DiscoveryCacheService } from '../src/services/discovery/DiscoveryCacheService';
import { TestExecutionService } from '../src/services/execution/TestExecutionService';
import { navigateViaMenu } from '../src/services/MenuDrivenNavigationService';
import { config } from './config';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// Load environment variables
dotenv.config();

/**
 * MASTER GT FLOW V2: Real Menu Navigation
 * Flow: Login -> GetMenuData API -> ResolveRealMenuUrl -> Precise Navigation
 */
async function runRealFlow(ticketId: string) {
    console.log(`🚀 [REAL FLOW] Starting Validation for ${ticketId}...\n`);

    const baseUrl = process.env.BASE_URL || 'https://test.globalhr.com.mm/ook';
    const username = process.env.TEST_USERNAME || '';
    const password = process.env.TEST_PASSWORD || '';
    const idNumber = process.env.TEST_IDNUMBER || '';

    try {
        // --- 1. Playbook Generation ---
        console.log(`[1/5] Generating Playbook...`);
        const playbook = await JiraService.generatePlaybook(ticketId, "Test Designation", "Verify Designation module");
        
        let moduleName = 'Designation';
        console.log(`✅ Target: ${moduleName}`);

        // --- 2. Real Menu Navigation ---
        const pool = SharedBrowserPool.getInstance();
        const handle = await pool.acquireContext();
        const { page } = handle;

        try {
            await pool.performLogin(page, `${baseUrl}#/login`, { idNumber, username, password });
            await page.waitForTimeout(5000);

            // --- REAL NAVIGATION FLOW ---
            console.log(`[Navigation] Resolving real URL for "${moduleName}" via API...`);
            const navResult = await navigateViaMenu(page, baseUrl, '#/app.designation', moduleName);
            
            console.log(`✅ Navigation Result: ${navResult.method}`);
            const fullTargetUrl = page.url();
            console.log(`✅ Final Location: ${fullTargetUrl}`);

            // Get relative route for cache
            const realUrl = fullTargetUrl.replace(baseUrl, '').replace(/^\/+/, '');

            // --- 3. Discovery at Real URL ---
            console.log(`[3/5] Scanning UI at real location...`);
            await page.waitForTimeout(10000);

            const inventory = await PageElementDiscoveryService.discoverPage(page, {
                pageName: moduleName,
                section: moduleName,
                deepScan: true
            });
            console.log(`✅ Discovery complete: ${inventory.buttons.length} buttons, ${inventory.inputs.length} inputs.`);
            DiscoveryCacheService.save(inventory, realUrl, ticketId, moduleName);

            // --- 4. Script Compilation (with Real URL) ---
            console.log(`[4/5] Compiling Playwright script...`);
            const tc = playbook.testCases[0];
            const testSpec = {
                id: tc.caseId || 'DESIGNATION_TEST',
                title: `Designation: ${tc.title}`,
                steps: (tc.steps || []).map((s: any) => {
                    const act = s.action.toLowerCase();
                    if (act.includes('add')) return { ...s, selectorHint: "button[ngbtooltip='Add New']" };
                    if (act.includes('save')) return { ...s, selectorHint: "button[type='submit']" };
                    return s;
                }),
                assertions: (tc as any).assertions || [],
                preconditions: (tc as any).preconditions || [],
                tags: ['Real-Flow']
            };

            const script = TestExecutionService.generatePlaywrightScript(
                testSpec as any,
                { stage: 'testing', baseUrl, username, password, idNumber, headless: true, tryDirectFirst: true } as any,
                ticketId
            );

            const testPath = path.join(process.cwd(), 'tests', 'playwright', `${ticketId}_real.spec.ts`);
            fs.writeFileSync(testPath, script);
            console.log(`✅ Script ready: ${testPath}`);

            // --- 5. Execution ---
            console.log(`[5/5] Executing...`);
            const output = execSync(`npx playwright test \"${testPath}\" --project=chromium --reporter=line`, {
                encoding: 'utf8',
                env: { ...process.env, PW_HEADLESS: 'true' }
            });
            console.log(output);
            console.log(`\n🏆 [SUCCESS] Real Flow Validation PASSED for ${ticketId}`);

        } finally {
            await pool.releaseContext(handle);
        }

    } catch (err: any) {
        console.error(`❌ [FAILED] Real Flow Error: ${err.message}`);
        process.exit(1);
    }
    process.exit(0);
}

runRealFlow('AB-20');
