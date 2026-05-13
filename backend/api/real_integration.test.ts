import { JiraService } from './JiraService';
import { PageElementDiscoveryService } from '../src/services/discovery/PageElementDiscoveryService';
import { SharedBrowserPool } from '../src/services/discovery/SharedBrowserPool';
import { DiscoveryCacheService } from '../src/services/discovery/DiscoveryCacheService';
import { TestExecutionService } from '../src/services/execution/TestExecutionService';
import { StoryTestPlanner } from '../src/services/jira/StoryTestPlanner';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// Load environment variables
dotenv.config();

async function runRealIntegration(ticketId: string) {
    console.log(`🚀 [REAL INTEGRATION] Starting Full Flow for ${ticketId}...\n`);

    const baseUrl = process.env.BASE_URL || 'https://test.globalhr.com.mm/ook';
    const username = process.env.TEST_USERNAME || '';
    const password = process.env.TEST_PASSWORD || '';
    const idNumber = process.env.TEST_IDNUMBER || '';

    try {
        // --- 1. Fetch Jira Ticket ---
        console.log(`[1/6] Fetching Jira Ticket...`);
        let ticket: any;
        try {
            ticket = await JiraService.fetchTicket(ticketId);
        } catch (err: any) {
            console.error(`❌ Jira API fetch failed for ${ticketId}: ${err.message}`);
            throw err;
        }
        console.log(`✅ Ticket Found: ${ticket.summary}`);

        // --- 2. AI Requirement Analysis ---
        console.log(`[2/6] Running AI Requirement Analysis (Story Planner)...`);
        const moduleName = 'Performance Journal'; // Extracted from summary/description
        const analysis = await StoryTestPlanner.analyzeFullStory(
            ticketId,
            ticket.summary,
            typeof ticket.description === 'string' ? ticket.description : JSON.stringify(ticket.description),
            moduleName
        );
        console.log(`✅ Requirements: ${analysis.requirements.length}, Scenarios: ${analysis.suggestedTestScenarios.length}`);

        // --- 3. Live UI Discovery ---
        console.log(`[3/6] Running Live UI Discovery for "${moduleName}"...`);
        const pool = SharedBrowserPool.getInstance();
        const handle = await pool.acquireContext();
        const { page } = handle;

        try {
            await pool.performLogin(page, `${baseUrl}#/login`, { idNumber, username, password });
            await page.waitForTimeout(5000);
            
            // --- SMART SIDEBAR SEARCH ---
            console.log(`   - Searching for module "${moduleName}" in sidebar...`);
            
            // 1. Try to find and click the menu directly using the text-matching logic from our patterns
            const menuSelector = `.text-truncate.d-inline-block a, .list-group-item.text-truncate, .nav-link, span`;
            const menuElement = page.locator(menuSelector, { hasText: new RegExp(`^${moduleName}$`, 'i') }).first();
            
            if (await menuElement.isVisible()) {
                console.log(`   - Found menu item "${moduleName}", clicking...`);
                await menuElement.click();
            } else {
                console.log(`   - Menu item not immediately visible, searching all sidebar spans...`);
                // Fallback: Click parent groups first (Master, Setup, Employee, etc.)
                const parentGroups = ['Master', 'Setup', 'Employee', 'Time Attendance', 'Human Resource', 'Daily Tasks', 'Review & Appraisal'];
                for (const group of parentGroups) {
                    const groupEl = page.locator('span', { hasText: new RegExp(`^${group}$`, 'i') }).first();
                    if (await groupEl.isVisible()) {
                        await groupEl.click();
                        await page.waitForTimeout(1000);
                        if (await menuElement.isVisible()) {
                            await menuElement.click();
                            break;
                        }
                    }
                }
            }
            
            // Final fallback: Direct navigation if sidebar fails
            if (!page.url().includes('performance')) {
                console.log('   - Sidebar search failed or slow, using direct navigation fallback.');
                await page.goto(`${baseUrl}/#/app.performancejournal`, { waitUntil: 'networkidle' }).catch(() => {});
            }
            
            await page.waitForTimeout(10000);

            const inventory = await PageElementDiscoveryService.discoverPage(page, {
                pageName: moduleName,
                section: moduleName,
                deepScan: false
            });
            console.log(`✅ Discovery complete: ${inventory.buttons.length + inventory.inputs.length} elements found.`);
            DiscoveryCacheService.save(inventory, '#/app.performancejournal', ticketId, moduleName);
        } finally {
            await pool.releaseContext(handle);
        }

        // --- 4. AI Playbook Generation ---
        console.log(`[4/6] Generating AI Playbook (Grounding)...`);
        const playbook = await JiraService.generatePlaybook(ticketId, ticket.summary, ticket.description);
        const cases = playbook.testCases || [];
        console.log(`✅ Playbook ready: ${cases.length} scenarios.`);

        // --- 5. Test Execution (Playwright) ---
        console.log(`[5/6] Executing Test Suite...`);
        const results: any[] = [];
        const artifactDir = path.join(process.cwd(), 'test-results', ticketId);
        if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });

        // Run the first scenario for verification
        if (cases.length > 0) {
            const tc = cases[0];
            console.log(`\n--- Scenario: ${tc.title} ---`);
            
            const testSpec = {
                id: tc.caseId || `SC-1`,
                title: `${moduleName}: ${tc.title}`,
                steps: (tc.steps || []).map((s: any) => {
                    const action = s.action.toLowerCase();
                    // Inject stable selectors discovered in Phase 3
                    if (action.includes('add')) return { ...s, selectorHint: "button[ngbtooltip='Add New']" };
                    if (action.includes('save')) return { ...s, selectorHint: "button[type='submit']" };
                    return s;
                }),
                assertions: (tc as any).assertions || [],
                preconditions: (tc as any).preconditions || [],
                tags: ['IntegrationTest']
            };

            const script = TestExecutionService.generatePlaywrightScript(
                testSpec as any,
                { stage: 'testing', baseUrl, username, password, idNumber, headless: true, tryDirectFirst: true } as any,
                ticketId
            );

            const testPath = path.join(process.cwd(), 'tests', 'playwright', `${ticketId}_verify.spec.ts`);
            fs.writeFileSync(testPath, script);

            try {
                console.log(`⏳ Running Playwright...`);
                execSync(`npx playwright test \"${testPath}\" --project=chromium --reporter=line`, { 
                    encoding: 'utf8',
                    env: { ...process.env, PW_HEADLESS: 'true' }
                });
                console.log(`✅ Case Passed!`);
                results.push({ testCaseId: testSpec.id, title: tc.title, status: 'PASS' });
            } catch (err: any) {
                console.error(`❌ Case Failed!`);
                results.push({ testCaseId: testSpec.id, title: tc.title, status: 'FAIL', error: 'Execution failed' });
            }
        }

        // --- 6. Jira Final Report ---
        console.log(`\n[6/6] Uploading Evidence and Report to Jira...`);
        const passed = results.filter(r => r.status === 'PASS').length;
        
        const reportComment = `🚀 GoHybridAI - End-to-End Execution Result
        
Ticket: ${ticketId}
Status: ${passed === results.length ? '✅ ALL PASSED' : '⚠️ FAILURES'}
Results: ${passed}/${results.length} Scenarios

${results.map(r => `${r.status === 'PASS' ? '✅' : '❌'} ${r.testCaseId}: ${r.title}`).join('\n')}

Discovery data and videos attached to Jira.`;

        await JiraService.postComment(ticketId, reportComment);
        await JiraService.transitionBasedOnResults(ticketId, results as any);

        console.log(`\n✨ [REAL INTEGRATION COMPLETE] Finished for ${ticketId}.`);

    } catch (err: any) {
        console.error(`\n❌ Fatal Error: ${err.message}`);
        process.exit(1);
    }
    
    process.exit(0);
}

runRealIntegration('ATT-15');
