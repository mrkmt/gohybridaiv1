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

async function runFullWorkflow(jiraId: string) {
    console.log(`🚀 [FULL WORKFLOW] Starting End-to-End Validation for ${jiraId}...\n`);

    const baseUrl = process.env.BASE_URL || 'https://test.globalhr.com.mm/ook';
    const username = process.env.TEST_USERNAME || '';
    const password = process.env.TEST_PASSWORD || '';
    const idNumber = process.env.TEST_IDNUMBER || '';

    try {
        // 1. Fetch Ticket & Generate Playbook
        console.log(`[1/6] Ingesting Jira Ticket & Generating AI Playbook...`);
        let ticket: any;
        try {
            ticket = await JiraService.fetchTicket(jiraId);
        } catch (err: any) {
            console.error(`❌ Jira API fetch failed for ${jiraId}: ${err.message}`);
            throw err;
        }
        console.log(`✅ Jira Ticket: ${ticket.summary}`);

        const playbook: any = await JiraService.generatePlaybook(jiraId, ticket.summary, typeof ticket.description === 'string' ? ticket.description : JSON.stringify(ticket.description));
        const cases = playbook.testCases || playbook.scenarios || [];
        console.log(`✅ Playbook ready: ${cases.length} scenarios detected.`);

        // 2. Live UI Discovery (Learn the module)
        const moduleName = playbook.module || 'Department';
        const hashRoute = '#/app.department';
        console.log(`[2/6] Running Live UI Discovery for "${moduleName}" to find stable selectors...`);
        
        const pool = SharedBrowserPool.getInstance();
        const handle = await pool.acquireContext();
        const { page } = handle;

        try {
            await pool.performLogin(page, `${baseUrl}#/login`, { idNumber, username, password });
            await page.waitForTimeout(10000);
            
            // Sidebar Navigation (Expanding Master)
            const masterMenu = page.locator('span.text-truncate.d-inline-block', { hasText: /^Master$/ }).first();
            if (await masterMenu.isVisible()) {
                await masterMenu.click();
                await page.waitForTimeout(2000);
            }
            const deptSubMenu = page.locator('a.list-group-item.text-truncate', { hasText: /^Department$/ }).first();
            if (await deptSubMenu.isVisible()) await deptSubMenu.click();
            else await page.goto(`${baseUrl}/#/app.department`, { waitUntil: 'networkidle' });
            
            await page.waitForTimeout(15000);

            const inventory = await PageElementDiscoveryService.discoverPage(page, {
                pageName: moduleName,
                section: moduleName,
                deepScan: true
            });
            console.log(`✅ Discovery complete: ${inventory.buttons.length + inventory.inputs.length} elements mapped.`);
            DiscoveryCacheService.save(inventory, hashRoute, jiraId, moduleName);
        } finally {
            await pool.releaseContext(handle);
        }

        // 3 & 4. Script Writing & Execution (For Each Case)
        console.log(`[3-4/6] Writing & Executing Playwright scripts for each case...`);
        const suiteResults: any[] = [];
        const artifactDir = path.join(process.cwd(), 'test-results', jiraId);
        if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });

        for (let i = 0; i < cases.length; i++) {
            const tc = cases[i];
            console.log(`\n--- Scenario ${i + 1}/${cases.length}: ${tc.title} ---`);
            
            // Apply "Best Approach" Healing/Selectors
            const testSpec = {
                id: tc.caseId || `SC-${i + 1}`,
                title: `${moduleName}: ${tc.title}`,
                steps: (tc.steps || []).map((s: any) => {
                    const action = s.action.toLowerCase();
                    // HEALING: 'Add New'
                    if (action.includes('click') && action.includes('add')) return { ...s, selectorHint: "button[ngbtooltip='Add New']" };
                    // HEALING: 'Short Code'
                    if (action.includes('short code')) return { ...s, selectorHint: "input >> nth=0" };
                    // HEALING: 'Name'
                    if (action.includes('name') && !action.includes('head')) return { ...s, selectorHint: "input >> nth=1" };
                    // HEALING: 'Save'
                    if (action.includes('click') && action.includes('save')) return { ...s, selectorHint: "button[type='submit']" };
                    return s;
                }),
                assertions: tc.assertions || [],
                preconditions: tc.preconditions || [],
                tags: []
            };

            const script = TestExecutionService.generatePlaywrightScript(
                testSpec as any, 
                { stage: 'testing', baseUrl, username, password, idNumber, headless: true, tryDirectFirst: true } as any,
                jiraId
            );

            const testPath = path.join(process.cwd(), 'tests', 'playwright', `${jiraId}_case_${i+1}.spec.ts`);
            fs.writeFileSync(testPath, script);
            console.log(`📝 Script written to: ${testPath}`);

            try {
                console.log(`⏳ Executing...`);
                const output = execSync(`npx playwright test \"${testPath}\" --project=chromium --reporter=line`, {
                    encoding: 'utf8',
                    env: { ...process.env, PW_HEADLESS: 'true' }
                });
                console.log(output);
                console.log(`✅ Case ${i+1} PASSED.`);
                suiteResults.push({ testCaseId: testSpec.id, title: tc.title, status: 'PASS', duration: 0 });
            } catch (err: any) {
                console.error(`❌ Case ${i+1} FAILED.`);
                suiteResults.push({ testCaseId: testSpec.id, title: tc.title, status: 'FAIL', error: 'Playwright execution failed', duration: 0 });
            }
        }

        // 5. Jira Upload Result (Evidence)
        console.log(`\n[5/6] Finalizing artifacts and uploading evidence to Jira...`);
        // Note: In real flow, Playwright saves to test-results/output. We'll zip the 'test-results' folder content.
        const evidenceId = await JiraService.uploadTestEvidence(jiraId, artifactDir);
        console.log(`✅ Evidence uploaded (ID: ${evidenceId || 'LOCAL_ONLY'}).`);

        // 6. Jira Comment & Status Update
        console.log(`[6/6] Posting final report to Jira...`);
        const total = suiteResults.length;
        const passed = suiteResults.filter(r => r.status === 'PASS').length;
        const failed = suiteResults.filter(r => r.status === 'FAIL').length;
        
        const summaryComment = `🚀 GoHybridAI - Automated Validation Report
        
Status: ${failed === 0 ? '✅ ALL PASSED' : '⚠️ FAILURES DETECTED'}
Total Scenarios: ${total}
Passed: ${passed}
Failed: ${failed}

${suiteResults.map(r => `${r.status === 'PASS' ? '✅' : '❌'} ${r.testCaseId}: ${r.title}`).join('\n')}

Validation performed on: ${baseUrl}
Evidence attached as ZIP.`;

        await JiraService.postComment(jiraId, summaryComment);
        await JiraService.transitionBasedOnResults(jiraId, suiteResults as any);
        
        console.log(`\n✨ [COMPLETE] Full flow verification finished for ${jiraId}.`);
        console.log(`   - Passed: ${passed}/${total}`);
        console.log(`   - Status: ${failed === 0 ? 'Ready for Review' : 'Back to In Progress'}`);

    } catch (err: any) {
        console.error(`\n❌ Fatal Workflow Error: ${err.message}`);
        process.exit(1);
    }
    
    process.exit(0);
}

// Run for a known valid ticket
runFullWorkflow('GB-5238');
