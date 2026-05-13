import { config } from './config';
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

/**
 * MASTER GT FLOW: Testing Ticket (ATT) -> Backlog (AB) -> Dev (GD)
 * Implements the 3-space logic from "System jira ticket write kmt.docx"
 */
async function runMasterGTFlow(gtTicketId: string) {
    console.log(`🚀 [MASTER GT FLOW] Starting Full Validation for Testing Ticket: ${gtTicketId}\n`);

    const baseUrl = process.env.BASE_URL || 'https://test.globalhr.com.mm/ook';
    const username = process.env.TEST_USERNAME || '';
    const password = process.env.TEST_PASSWORD || '';
    const idNumber = process.env.TEST_IDNUMBER || '';

    try {
        // 1. Ingest Testing Ticket (GT/ATT)
        console.log(`[1/7] Ingesting GT Ticket & Mapping Space Links...`);
        let gtTicket: any;
        try {
            gtTicket = await JiraService.fetchTicket(gtTicketId);
        } catch (err) {
            console.error(`❌ Jira API failed for ${gtTicketId}: ${err.message}`);
            throw err;
        }
        
        // Ensure description is string for matching
        const descText = typeof gtTicket.description === 'string' 
            ? gtTicket.description 
            : JSON.stringify(gtTicket.description);

        // Find linked AB (Backlog) and GD (Dev) tickets
        const linkedIssueKeys = (gtTicket.summary + descText).match(/[A-Z]+-[0-9]+/g) || [];
        
        // Use prefixes from config
        const { backlogPrefix, testingPrefix, developmentPrefix } = config.jira;
        
        const abTicketId = (linkedIssueKeys as string[]).find((k: string) => k.startsWith(`${backlogPrefix}-`)) || `${backlogPrefix}-31`; 
        const gdTicketId = (linkedIssueKeys as string[]).find((k: string) => k.startsWith(`${developmentPrefix}-`));
        
        console.log(`   - Testing Ticket (${testingPrefix}): ${gtTicketId}`);
        console.log(`   - Backlog Ticket (${backlogPrefix}): ${abTicketId}`);
        if (gdTicketId) console.log(`   - Development Ticket (${developmentPrefix}): ${gdTicketId}`);
        
        let abTicket: any = null;
        try {
            abTicket = await JiraService.fetchTicket(abTicketId);
        } catch {
            console.warn(`⚠️ Failed to fetch Backlog Ticket: ${abTicketId}`);
        }

        let gdTicket: any = null;
        if (gdTicketId) {
            try {
                gdTicket = await JiraService.fetchTicket(gdTicketId);
            } catch {
                console.warn(`⚠️ Failed to fetch Development Ticket: ${gdTicketId}`);
            }
        }
        
        // 2. Requirement Extraction (Super Context)
        console.log(`[2/7] Extracting Super Context from Space links...`);
        const abDescText = abTicket ? (typeof abTicket.description === 'string' ? abTicket.description : JSON.stringify(abTicket.description)) : 'N/A';
        const gdDescText = gdTicket ? (typeof gdTicket.description === 'string' ? gdTicket.description : JSON.stringify(gdTicket.description)) : 'N/A';
        
        const combinedDescription = `
            # GT Ticket (${gtTicketId}): ${gtTicket.summary}
            ${descText}
            
            # AB Ticket (${abTicketId}): ${abTicket?.summary || 'N/A'}
            ${abDescText}
            
            ${gdTicketId ? `# GD Ticket (${gdTicketId}): ${gdTicket?.summary || 'N/A'}\n${gdDescText}` : ''}
            
            # Additional Context:
            - System Standard: ${testingPrefix}-Space (Testing), ${backlogPrefix}-Space (Backlog), ${developmentPrefix}-Space (Development)
            - User Roles: System Administrator (Backend), Custom Administrator (Frontend), Approver, Employee.
            - Required Credentials: ID Number (Employee Code), Username, Password.
        `;

        const playbook: any = await JiraService.generatePlaybook(gtTicketId, gtTicket.summary, combinedDescription);
        const cases = playbook.testCases || [];
        const moduleName = playbook.module || 'Department';
        console.log(`✅ [PLAYBOOK] Generated ${cases.length} cases for ${moduleName}.`);

        // 3. Live UI Discovery
        console.log(`[3/7] Discovering actual UI for module "${moduleName}"...`);
        const pool = SharedBrowserPool.getInstance();
        const handle = await pool.acquireContext();
        const { page } = handle;

        try {
            await pool.performLogin(page, `${baseUrl}#/login`, { idNumber, username, password });
            await page.waitForTimeout(5000);
            
            // Reliable Sidebar Navigation
            const masterMenu = page.locator('span.text-truncate.d-inline-block', { hasText: /^Master$/ }).first();
            if (await masterMenu.isVisible()) {
                await masterMenu.click();
                await page.waitForTimeout(1500);
            }
            const subMenu = page.locator('a.list-group-item.text-truncate', { hasText: new RegExp(`^${moduleName}$`, 'i') }).first();
            if (await subMenu.isVisible()) {
                await subMenu.click();
            } else {
                await page.goto(`${baseUrl}/#/app.${moduleName.toLowerCase().replace(/ /g, '')}`);
            }
            await page.waitForTimeout(10000);

            const inventory = await PageElementDiscoveryService.discoverPage(page, {
                pageName: moduleName,
                section: moduleName,
                deepScan: true
            });
            console.log(`✅ Discovery complete: ${inventory.buttons.length + inventory.inputs.length} elements mapped.`);
            DiscoveryCacheService.save(inventory, '#/app.department', gtTicketId, moduleName);
        } finally {
            await pool.releaseContext(handle);
        }

        // 4 & 5. Script Writing & Execution
        console.log(`[4-5/7] Executing Playwright scripts for the suite...`);
        const suiteResults: any[] = [];
        const artifactDir = path.join(process.cwd(), 'test-results', gtTicketId);
        if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });

        for (let i = 0; i < Math.min(cases.length, 3); i++) {
            const tc = cases[i];
            console.log(`\n--- Case ${i+1}/${cases.length}: ${tc.title} ---`);
            
            // Injects stable selectors learned from discovery
            const testSpec = {
                id: tc.caseId || `CASE-${i+1}`,
                title: tc.title,
                steps: (tc.steps || []).map((s: any) => {
                    const act = s.action.toLowerCase();
                    if (act.includes('add')) return { ...s, selectorHint: "button[ngbtooltip='Add New']" };
                    if (act.includes('short code')) return { ...s, selectorHint: "input >> nth=0" };
                    if (act.includes('name')) return { ...s, selectorHint: "input >> nth=1" };
                    if (act.includes('save')) return { ...s, selectorHint: "button[type='submit']" };
                    return s;
                }),
                assertions: tc.assertions || [],
                preconditions: tc.preconditions || [],
                tags: ['GT-Flow']
            };

            const script = TestExecutionService.generatePlaywrightScript(
                testSpec as any, 
                { stage: 'testing', baseUrl, username, password, idNumber, headless: true, tryDirectFirst: true } as any,
                gtTicketId
            );

            const testPath = path.join(process.cwd(), 'tests', 'playwright', `${gtTicketId}_run_${i+1}.spec.ts`);
            fs.writeFileSync(testPath, script);

            try {
                execSync(`npx playwright test \"${testPath}\" --project=chromium --reporter=line`, { encoding: 'utf8', env: { ...process.env, PW_HEADLESS: 'true' } });
                console.log(`✅ PASSED`);
                suiteResults.push({ testCaseId: testSpec.id, title: tc.title, status: 'PASS' });
            } catch (err) {
                console.error(`❌ FAILED`);
                suiteResults.push({ testCaseId: testSpec.id, title: tc.title, status: 'FAIL' });
            }
        }

        // 6. Excel & Evidence Upload
        console.log(`\n[6/7] Finalizing Evidence (Zip + Excel)...`);
        const evidenceId = await JiraService.uploadTestEvidence(gtTicketId, artifactDir);
        console.log(`✅ Upload complete.`);

        // 7. Status Transition (ONLY for GT Ticket)
        console.log(`[7/7] Transitioning GT Ticket Status & Posting Rich Report...`);
        const passedCount = suiteResults.filter(r => r.status === 'PASS').length;
        const failedCount = suiteResults.filter(r => r.status === 'FAIL').length;

        const report = `🚀 GoHybridAI - Master GT Validation Report

Status: ${failedCount === 0 ? '✅ READY' : '⚠️ ISSUES FOUND'}
Testing Space: GTA Testing (GT)
Linked Backlog: ${abTicketId}

VERIFICATION MATRIX:
${suiteResults.map(r => `${r.status === 'PASS' ? '✅' : '❌'} ${r.testCaseId}: ${r.title}`).join('\n')}

Logs & Videos attached.
Reporting Environment: ${baseUrl} (Role: System Admin)`;

        await JiraService.postComment(gtTicketId, report);
        await JiraService.transitionBasedOnResults(gtTicketId, suiteResults as any);

        console.log(`\n✨ [COMPLETE] Master GT Flow Finished.`);
        console.log(`   - Final Status for ${gtTicketId}: ${failedCount === 0 ? 'Resolved/Done' : 'Back to In Progress'}`);

    } catch (err: any) {
        console.error(`❌ Fatal Error: ${err.message}`);
    }
}

// Start for ATT-17
runMasterGTFlow('ATT-17');
