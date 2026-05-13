import { JiraService } from './JiraService';
import { PageElementDiscoveryService } from '../src/services/discovery/PageElementDiscoveryService';
import { SharedBrowserPool } from '../src/services/discovery/SharedBrowserPool';
import { DiscoveryCacheService } from '../src/services/discovery/DiscoveryCacheService';
import { TestExecutionService } from '../src/services/execution/TestExecutionService';
import { navigateViaMenu } from '../src/services/MenuDrivenNavigationService';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

dotenv.config();

async function runTicket(ticketId: string, moduleName: string) {
    console.log(`\n================================================================`);
    console.log(`🚀 PROCESSING TICKET: ${ticketId} (${moduleName})`);
    console.log(`================================================================\n`);

    const baseUrl = process.env.BASE_URL || 'https://test.globalhr.com.mm/ook';
    const username = process.env.TEST_USERNAME || '';
    const password = process.env.TEST_PASSWORD || '';
    const idNumber = process.env.TEST_IDNUMBER || '';

    try {
        console.log(`[1/5] Generating BDD Playbook for ${ticketId}...`);
        const playbook = await JiraService.generatePlaybook(ticketId, moduleName, `Verify ${moduleName} functionality`);
        console.log(`✅ Playbook generated with ${playbook.testCases.length} scenarios.`);

        const pool = SharedBrowserPool.getInstance();
        const handle = await pool.acquireContext();
        const { page } = handle;

        try {
            console.log(`[2/5] Performing Login and Smart Navigation...`);
            await pool.performLogin(page, `${baseUrl}#/login`, { idNumber, username, password });
            
            // Using the new Smart Navigation logic
            const navResult = await navigateViaMenu(page, baseUrl, `#/app.${moduleName.toLowerCase().replace(/\s+/g, '')}`, moduleName);
            console.log(`✅ Navigation Success: ${navResult.method} -> ${page.url()}`);

            console.log(`[3/5] Scanning UI elements for ${moduleName}...`);
            await page.waitForTimeout(5000);
            const inventory = await PageElementDiscoveryService.discoverPage(page, {
                pageName: moduleName,
                section: moduleName,
                deepScan: true
            });
            console.log(`✅ UI Discovery: Found ${inventory.buttons.length} buttons, ${inventory.inputs.length} inputs.`);

            console.log(`[4/5] Compiling Playwright test script...`);
            const tc = playbook.testCases[0];
            const script = TestExecutionService.generatePlaywrightScript(
                { ...tc, id: `${ticketId}_TEST`, tags: ['Real-Flow'] } as any,
                { stage: 'testing', baseUrl, username, password, idNumber, headless: true } as any,
                ticketId
            );

            const testPath = path.join(process.cwd(), 'tests', 'playwright', `${ticketId}_auto.spec.ts`);
            fs.writeFileSync(testPath, script);
            console.log(`✅ Test script saved: ${testPath}`);

            console.log(`[5/5] Executing Playwright Test...`);
            try {
                // Point to the exact file and use full path or relative to project root
                const output = execSync(`npx playwright test \"tests/playwright/${ticketId}_auto.spec.ts\" --project=chromium --reporter=list`, {
                    encoding: 'utf8',
                    env: { ...process.env, PW_HEADLESS: 'true' }
                });
                console.log(output);
                console.log(`\n🏆 [PASS] ${ticketId} Validation Successful!`);
            } catch (execErr: any) {
                console.error(`❌ [FAIL] Playwright execution failed for ${ticketId}`);
                console.error(execErr.stdout || execErr.message);
            }

        } finally {
            await pool.releaseContext(handle);
        }
    } catch (err: any) {
        console.error(`❌ [ERROR] Failed to process ${ticketId}: ${err.message}`);
    }
}

async function main() {
    // ATT-15 is Journal Entry, ATT-22 is typically Attendance related in this project
    await runTicket('ATT-15', 'Journal Entry');
    await runTicket('ATT-22', 'Attendance Request');
    process.exit(0);
}

main();
