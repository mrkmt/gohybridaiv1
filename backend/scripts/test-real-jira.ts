/**
 * Real Jira Integration Test Script
 *
 * Tests the new Linked Ticket Intelligence + Jira Comment Format
 * against a REAL Jira instance.
 *
 * Usage:
 *   cd backend
 *   npx ts-node scripts/test-real-jira.ts GT-XXX
 *
 * Replace GT-XXX with an actual Testing ticket key that has linked issues.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { LinkedTicketIntelligenceService } from '../src/services/LinkedTicketIntelligenceService';
import { JiraUploadService } from '../src/services/JiraUploadService';
import { FailureClassificationService } from '../src/services/FailureClassificationService';

const TICKET_ID = process.argv[2];

if (!TICKET_ID) {
    console.error('❌ Usage: npx ts-node scripts/test-real-jira.ts <TICKET_ID>');
    console.error('   Example: npx ts-node scripts/test-real-jira.ts GT-100');
    process.exit(1);
}

// Colors for terminal output
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function header(text: string) {
    console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════════════════${RESET}`);
    console.log(`${BOLD}${CYAN}  ${text}${RESET}`);
    console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════════════${RESET}\n`);
}

function pass(text: string) { console.log(`${GREEN}✅ ${text}${RESET}`); }
function warn(text: string) { console.log(`${YELLOW}⚠️  ${text}${RESET}`); }
function fail(text: string) { console.log(`${RED}❌ ${text}${RESET}`); }

async function main() {
    console.log(`${BOLD}🧪 Real Jira Integration Test${RESET}`);
    console.log(`   Ticket: ${BOLD}${TICKET_ID}${RESET}`);
    console.log(`   Jira URL: ${process.env.JIRA_URL || '(not set)'}\n`);

    // ─── TEST 1: Linked Ticket Intelligence ──────────────────────
    header('TEST 1: Linked Ticket Intelligence');

    console.log('Step 1a: Fetching linked issues...');
    try {
        const links = await LinkedTicketIntelligenceService.getLinkedIssues(TICKET_ID);

        if (links.length === 0) {
            warn(`No linked issues found for ${TICKET_ID}`);
            console.log(`   → This ticket has no links in Jira.`);
            console.log(`   → Try a different GT ticket that has links to GB/GD tickets.`);
        } else {
            pass(`Found ${links.length} linked issue(s):`);
            for (const link of links) {
                console.log(`   ${BOLD}${link.key}${RESET} (${link.linkType}) — ${link.summary}`);
                if (link.issueType) console.log(`      Type: ${link.issueType}`);
                if (link.status) console.log(`      Status: ${link.status}`);
            }
        }
    } catch (err: any) {
        fail(`Failed to fetch linked issues: ${err.message}`);
        console.log(`   → Check your JIRA_URL, JIRA_USERNAME, JIRA_API_TOKEN in .env`);
        process.exit(1);
    }

    console.log('\nStep 1b: Fetching full context (descriptions + comments)...');
    try {
        const context = await LinkedTicketIntelligenceService.getFullContext(TICKET_ID);

        if (context.details.length === 0) {
            warn('No details fetched (likely no linked issues)');
        } else {
            pass(`Fetched details for ${context.details.length} linked ticket(s):`);
            for (const detail of context.details) {
                console.log(`\n   ${BOLD}${detail.key}${RESET} (${detail.linkType})`);
                if (detail.description) {
                    const preview = detail.description.length > 150
                        ? detail.description.substring(0, 150) + '...'
                        : detail.description;
                    console.log(`   Description: ${preview}`);
                } else {
                    console.log(`   Description: (none)`);
                }
                console.log(`   Comments: ${detail.comments.length}`);
                for (const c of detail.comments.slice(0, 2)) {
                    const bodyPreview = c.body.length > 100 ? c.body.substring(0, 100) + '...' : c.body;
                    console.log(`     - ${c.author}: ${bodyPreview}`);
                }
                if (detail.comments.length > 2) {
                    console.log(`     ... and ${detail.comments.length - 2} more comment(s)`);
                }
            }
        }
    } catch (err: any) {
        fail(`Failed to fetch context: ${err.message}`);
    }

    console.log('\nStep 1c: Extracting test context hints...');
    try {
        const context = await LinkedTicketIntelligenceService.getFullContext(TICKET_ID);
        const extracted = LinkedTicketIntelligenceService.extractTestContext(context);

        if (context.links.length === 0) {
            warn('No linked tickets to extract hints from');
        } else {
            pass('Extracted context hints:');
            console.log(`   Business Logic Hints: ${extracted.businessLogicHints.length}`);
            extracted.businessLogicHints.forEach(h => console.log(`     - ${h}`));
            console.log(`   New Fields/Features: ${extracted.newFields.length}`);
            extracted.newFields.forEach(f => console.log(`     - ${f}`));
            console.log(`   Selector Hints: ${extracted.selectorHints.length}`);
            extracted.selectorHints.forEach(s => console.log(`     - ${s}`));
            console.log(`   Risk Areas: ${extracted.riskAreas.length}`);
            extracted.riskAreas.forEach(r => console.log(`     - ${r}`));
        }
    } catch (err: any) {
        fail(`Failed to extract context: ${err.message}`);
    }

    console.log('\nStep 1d: Generating AI-ready summary...');
    try {
        const summary = await LinkedTicketIntelligenceService.summarizeForTestGeneration(TICKET_ID);
        console.log(`\n${BOLD}Summary Output:${RESET}\n${summary}`);
        pass('Summary generated successfully');
    } catch (err: any) {
        fail(`Failed to generate summary: ${err.message}`);
    }

    // ─── TEST 2: Jira Comment Format (Enhanced) ─────────────────
    header('TEST 2: Jira Comment Format (Pass / Failed / Code Fault)');

    // Create mock test results to post to Jira
    const mockResults: any[] = [
        {
            testCaseId: 'TC-001',
            testCaseTitle: 'Verify login with valid credentials',
            status: 'PASS',
            duration: 3200,
            steps: [
                { stepNumber: 1, action: 'Enter username', expectedResult: 'Username accepted', status: 'PASS' },
                { stepNumber: 2, action: 'Click Login', expectedResult: 'Redirected to dashboard', status: 'PASS' },
            ],
            errorMessage: null,
            isExecutionFault: false,
            screenshotPaths: [],
        },
        {
            testCaseId: 'TC-002',
            testCaseTitle: 'Verify Save button on Employee form',
            status: 'FAIL',
            duration: 5100,
            steps: [
                { stepNumber: 1, action: 'Open Employee form', expectedResult: 'Form loads', status: 'PASS' },
                { stepNumber: 2, action: 'Click Save', expectedResult: 'Success message', status: 'FAIL' },
            ],
            errorMessage: 'Error: expect(received).toBe(expected)\nExpected: "Record saved successfully"\nReceived: "Page crash - Cannot read properties of null"',
            isExecutionFault: false,
            screenshotPaths: [],
            aiInsight: {
                likelyCause: 'The Employee form crashes when department field is null. This is a real application defect.',
                suggestedFix: 'Add null check for department field before saving.',
                isScriptIssue: false,
            },
        },
        {
            testCaseId: 'TC-003',
            testCaseTitle: 'Verify Kendo grid pagination',
            status: 'FAIL',
            duration: 800,
            steps: [
                { stepNumber: 1, action: 'Navigate to grid', expectedResult: 'Grid loads', status: 'FAIL' },
            ],
            errorMessage: 'TypeError: Cannot read properties of undefined (reading "click")\n    at Object.<anonymous> (test.spec.ts:15:20)',
            isExecutionFault: true,
            screenshotPaths: [],
        },
        {
            testCaseId: 'TC-004',
            testCaseTitle: 'Verify menu navigation',
            status: 'SKIP',
            duration: 0,
            steps: [],
            errorMessage: null,
            isExecutionFault: false,
            screenshotPaths: [],
        },
    ];

    const mockSummary = {
        total: 4,
        passed: 1,
        failed: 2,
        skipped: 1,
        passRate: 25.0,
    };

    console.log('Posting test results to Jira with enhanced format...');
    console.log(`   Results: ${mockResults.length} test cases`);
    console.log(`   Pass: ${mockSummary.passed} | Failed: ${mockSummary.failed} | Skip: ${mockSummary.skipped}`);

    try {
        await JiraUploadService.postTestResultsComment(
            TICKET_ID,
            mockResults,
            mockSummary,
            'testing',
            'TestReport_demo.xlsx'
        );
        pass(`Enhanced results posted to ${TICKET_ID}`);
        console.log(`   → Open Jira to verify the comment format`);
        console.log(`   → Check for: Pass | Failed | Code Fault columns`);
        console.log(`   → Check for: Root cause analysis panels`);
    } catch (err: any) {
        fail(`Failed to post results: ${err.message}`);
        console.log(`   → Check your Jira credentials and ticket permissions`);
    }

    // ─── FINAL SUMMARY ──────────────────────────────────────────
    header('TEST COMPLETE');
    console.log(`${BOLD}Checklist:${RESET}`);
    console.log(`  ☐ Linked issues returned correctly`);
    console.log(`  ☐ Descriptions/comments were readable`);
    console.log(`  ☐ Business logic hints were extracted`);
    console.log(`  ☐ AI summary text is useful for test generation`);
    console.log(`  ☐ Jira comment shows Pass/Failed/Code Fault table`);
    console.log(`  ☐ Root cause panels appear for failed tests`);
    console.log(`\n${BOLD}If any link type names are wrong (e.g., your Jira uses custom names):${RESET}`);
    console.log(`  → Tell me the actual link type names from your Jira`);
    console.log(`  → I'll update the classifier in LinkedTicketIntelligenceService`);
    console.log(`\n${BOLD}Next step after verification:${RESET}`);
    console.log(`  → Wire the linked ticket summary into the AI test generation prompt`);
    console.log(`  → So AI knows what changed, what's blocked, and what to focus on`);
}

main().catch(err => {
    console.error(`\n${RED}💥 Fatal error: ${err.message}${RESET}`);
    process.exit(1);
});
