import { JiraService } from './JiraService';
import { PageElementDiscoveryService } from '../src/services/discovery/PageElementDiscoveryService';
import { SharedBrowserPool } from '../src/services/discovery/SharedBrowserPool';
import { DiscoveryCacheService } from '../src/services/discovery/DiscoveryCacheService';
import { TestExecutionService } from '../src/services/execution/TestExecutionService';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// Load environment variables
dotenv.config();

async function runBaseline() {
    console.log('🏁 [BASELINE] Starting GoHybridAI Full Execution Validation...\n');

    const tickets = [
        {
            id: 'AB-31',
            type: 'Story',
            summary: 'Story: Add Short Code validation for Master Data entities',
            description: 'As a system admin, I want all Short Code fields to be limited to 5 characters so that data consistency is maintained.'
        },
        {
            id: 'AB-30',
            type: 'Bug',
            summary: 'Test Bug: Department Short Code validation missing',
            description: 'When creating a new Department, the Short Code field accepts more than 5 characters. This should be validated.'
        }
    ];

    const results = [];
    const baseUrl = process.env.BASE_URL || 'https://test.globalhr.com.mm/ook';
    const username = process.env.TEST_USERNAME || '';
    const password = process.env.TEST_PASSWORD || '';
    const idNumber = process.env.TEST_IDNUMBER || '';

    for (const ticket of tickets) {
        console.log(`\n--- Processing ${ticket.id} (${ticket.type}) ---`);

        try {
            // 1. Playbook
            const playbook: any = await JiraService.generatePlaybook(ticket.id, ticket.summary, ticket.description);
            const cases = playbook.testCases || playbook.scenarios || [];
            console.log(`✅ [1/4] Playbook generated: ${cases.length} cases`);

            // 2. Discovery
            const moduleName = playbook.module || 'Department';
            const hashRoute = '#/app.department';
            const pool = SharedBrowserPool.getInstance();
            const handle = await pool.acquireContext();
            const { page } = handle;

            try {
                await pool.performLogin(page, `${baseUrl}#/login`, { idNumber, username, password });
                await page.waitForTimeout(10000);

                // Sidebar Navigation
                console.log('   - Navigating via sidebar...');
                const masterMenu = page.locator('span.text-truncate.d-inline-block', { hasText: /^Master$/ }).first();
                if (await masterMenu.isVisible()) {
                    await masterMenu.click();
                    await page.waitForTimeout(2000);
                }
                const deptSubMenu = page.locator('a.list-group-item.text-truncate', { hasText: /^Department$/ }).first();
                if (await deptSubMenu.isVisible()) {
                    await deptSubMenu.click();
                } else {
                    await page.goto(`${baseUrl}/#/app.department`, { waitUntil: 'networkidle' });
                }
                await page.waitForTimeout(10000);

                const inventory = await PageElementDiscoveryService.discoverPage(page, {
                    pageName: moduleName,
                    section: moduleName,
                    deepScan: true
                });
                console.log(`✅ [2/4] UI Discovery complete: ${inventory.buttons.length + inventory.inputs.length} elements found`);
                DiscoveryCacheService.save(inventory, hashRoute, ticket.id, moduleName);
// Wrap in TestSpecification format
const testSpec = {
    ticketId: ticket.id,
    feature: playbook.module || 'Master',
    scenarios: cases.map((tc: any, i: number) => ({
        id: tc.caseId || `SC-${i+1}`,
        caseId: tc.caseId || `SC-${i+1}`,
        title: `Department: ${tc.title || `Scenario ${i+1}`}`,
        priority: tc.priority || 'medium',
        steps: (tc.steps || []).map((s: any) => {
            const action = s.action.toLowerCase();
            // HEALING: 'Add New' button
            if (action.includes('click') && action.includes('add')) {
                return { ...s, selectorHint: "button[ngbtooltip='Add New']" };
            }
            // HEALING: 'Name' field (usually second input)
            if (action.includes('fill') && action.includes('name')) {
                return { ...s, selectorHint: "input >> nth=1" };
            }
            // HEALING: 'Short Code' field (usually first input in Department modal)
            if (action.includes('short code')) {
                return { ...s, selectorHint: "input >> nth=0" };
            }            // HEALING: 'Save' button
            if (action.includes('click') && action.includes('save')) {
                return { ...s, selectorHint: "button[type='submit']" };
            }
            return s;
        }),        assertions: tc.assertions || [],
        preconditions: tc.preconditions || [],
        tags: []
    }))
};

const script = TestExecutionService.generatePlaywrightScript(
    testSpec.scenarios[0] as any, 
    { stage: 'testing', baseUrl, username, password, idNumber, headless: true, tryDirectFirst: true } as any,
    ticket.id
);
                
                const testDir = path.join(process.cwd(), 'tests', 'playwright');
                if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
                const testPath = path.join(testDir, `${ticket.id}_baseline.spec.ts`);
                fs.writeFileSync(testPath, script);
                
                console.log(`✅ [3/4] Playwright script saved: ${testPath}`);

                // 4. Execution
                console.log(`[4/4] Triggering Playwright Execution...`);
                try {
                    const relativeTestPath = `./tests/playwright/${ticket.id}_baseline.spec.ts`;
                    console.log(`   - Executing: npx playwright test \"${relativeTestPath}\"`);
                    
                    const output = execSync(`npx playwright test \"${relativeTestPath}\" --project=chromium --reporter=line`, {
                        encoding: 'utf8',
                        cwd: process.cwd(),
                        env: { ...process.env, PW_HEADLESS: 'true' }
                    });
                    console.log(output);
                    console.log(`✅ [4/4] Execution Passed!`);
                    results.push({ ticketId: ticket.id, status: 'PASS', elements: inventory.buttons.length + inventory.inputs.length });
                } catch (execErr: any) {
                    console.error(`❌ Execution Failed!`);
                    console.error(execErr.stdout || execErr.message);
                    results.push({ ticketId: ticket.id, status: 'FAIL', error: 'Playwright execution failed' });
                }

            } finally {
                await pool.releaseContext(handle);
            }
        } catch (err: any) {
            console.error(`❌ Failed: ${err.message}`);
            results.push({ ticketId: ticket.id, status: 'ERROR', error: err.message });
        }
    }

    console.log('\n--- 📊 FULL VALIDATION REPORT ---');
    console.table(results);
    process.exit(0);
}

runBaseline();
