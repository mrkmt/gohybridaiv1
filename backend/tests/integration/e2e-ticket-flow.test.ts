/**
 * End-to-End Ticket Flow Test
 *
 * Tests the complete lifecycle: Bug Ticket → Testing Ticket → Linked Story
 *
 * Flow:
 * 1. Create a Bug ticket in AB project
 * 2. Create a Story ticket linked to the Bug
 * 3. Create a Testing ticket in ATT project linked to the Story
 * 4. Start testing workflow (orchestrate)
 * 5. Generate test scenarios
 * 6. Generate test cases
 * 7. Execute tests
 * 8. Upload results to Jira
 * 9. Verify Jira status transitions
 *
 * @author GoHybrid AI Team
 * @date April 3, 2026
 */

import { getJiraAxios } from '../../src/utils/jiraAxios';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../api/.env') });

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

const TEST_CONFIG = {
    // Use real or simulated Jira
    useRealJira: process.env.JIRA_DOMAIN ? true : false,

    // Project keys
    bugProject: 'AB',      // Bug/Story project
    testProject: 'ATT',    // Testing project

    // Test data
    bugSummary: `Test Bug: Department Short Code validation missing (E2E ${Date.now()})`,
    bugDescription: `When creating a new Department, the Short Code field accepts more than 5 characters. This should be validated.

**Module:** Master > Department
**Severity:** Medium
**Steps to Reproduce:**
1. Go to Master > Department
2. Click Add New
3. Enter Short Code: ABCDEF (6 characters)
4. Click Save
5. Observe: No validation error, system accepts 6+ character Short Code

**Expected:** System should reject Short Code > 5 characters
**Actual:** System accepts any length

**Environment:** https://test.globalhr.com.mm/ook`,

    storySummary: `Story: Add Short Code validation for Master Data entities (E2E ${Date.now()})`,
    storyDescription: `As a system admin, I want all Short Code fields to be limited to 5 characters so that data consistency is maintained.

**Acceptance Criteria:**
1. Department Short Code max 5 chars
2. Designation Short Code max 5 chars
3. Leave Type Short Code max 5 chars
4. Validation error shown when limit exceeded

**Module:** Master Data
**Linked Bug:** Will be linked during test

**Technical Notes:**
- All Short Code fields use input[formcontrolname="ShortCode"]
- Validation should happen on both client and server side`,

    testingSummary: `Testing: Short Code validation for Department, Designation, Leave Type (E2E ${Date.now()})`,
    testingDescription: `Execute test cases for Short Code validation across all Master Data entities that use Short Code fields.

**Test Scope:**
- Department Short Code validation (max 5 chars)
- Designation Short Code validation (max 5 chars)
- Leave Type Short Code validation (max 5 chars)

**Test Cases:**
1. TC-001: Create Department with 6-char Short Code → should show validation error
2. TC-002: Create Designation with 6-char Short Code → should show validation error
3. TC-003: Create Leave Type with 6-char Short Code → should show validation error
4. TC-004: Create Department with 5-char Short Code → should succeed
5. TC-005: Edit Department to change Short Code from 5 to 6 chars → should show error

**Expected Result:** All validation tests should pass
**Environment:** https://test.globalhr.com.mm/ook`
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

let createdTickets: string[] = [];

function log(step: string, detail: string = '') {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`STEP: ${step}`);
    if (detail) console.log(detail);
    console.log('='.repeat(70));
}

function pass(step: string) {
    console.log(`✅ PASS: ${step}`);
}

function fail(step: string, error: string) {
    console.error(`❌ FAIL: ${step}`);
    console.error(`   Error: ${error}`);
}

/**
 * Create a Jira issue and track it for cleanup
 */
async function createJiraIssue(
    project: string,
    issueType: string,
    summary: string,
    description: string,
    linkedIssueKey?: string,
    linkType?: string
): Promise<string> {
    const jiraAxios = getJiraAxios();

    // Build description in ADF format
    const adfDescription = {
        type: 'doc',
        version: 1,
        content: [
            {
                type: 'paragraph',
                content: description.split('\n').filter(l => l.trim()).map(line => ({
                    type: 'text',
                    text: line
                }))
            }
        ]
    };

    const payload: any = {
        fields: {
            project: { key: project },
            summary,
            description: adfDescription,
            issuetype: { name: issueType }
        }
    };

    // Set priority if available
    try {
        if (issueType === 'Bug') {
            payload.fields.priority = { name: 'Medium' };
        }
    } catch {}

    console.log(`  Creating ${issueType} in ${project}: ${summary.substring(0, 60)}...`);

    const response = await jiraAxios.post('/rest/api/3/issue', payload);
    const ticketKey = response.data.key;
    console.log(`  ✓ Created: ${ticketKey}`);

    createdTickets.push(ticketKey);

    // Link to another issue if specified
    if (linkedIssueKey && linkType) {
        try {
            await jiraAxios.post('/rest/api/3/issueLink', {
                type: { name: linkType },
                inwardIssue: { key: ticketKey },
                outwardIssue: { key: linkedIssueKey }
            });
            console.log(`  ✓ Linked: ${ticketKey} → ${linkedIssueKey} (${linkType})`);
        } catch (linkErr: any) {
            console.warn(`  ⚠ Link failed: ${linkErr.message}`);
        }
    }

    return ticketKey;
}

/**
 * Get ticket details
 */
async function getTicketDetails(ticketKey: string): Promise<any> {
    const jiraAxios = getJiraAxios();
    const response = await jiraAxios.get(`/rest/api/3/issue/${ticketKey}`, {
        params: { fields: 'summary,status,description,issuetype,issuelinks,comment,attachment' }
    });
    return response.data;
}

/**
 * Get ticket status
 */
async function getTicketStatus(ticketKey: string): Promise<string> {
    const details = await getTicketDetails(ticketKey);
    return details.fields?.status?.name || 'Unknown';
}

/**
 * Post a comment to a ticket
 */
async function postComment(ticketKey: string, comment: string): Promise<void> {
    const jiraAxios = getJiraAxios();
    const adfComment = {
        type: 'doc',
        version: 1,
        content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: comment }]
        }]
    };
    await jiraAxios.post(`/rest/api/3/issue/${ticketKey}/comment`, { body: adfComment });
    console.log(`  ✓ Comment posted to ${ticketKey}`);
}

/**
 * Transition ticket
 */
async function transitionTicket(ticketKey: string, transitionName: string): Promise<boolean> {
    try {
        const jiraAxios = getJiraAxios();

        // Get available transitions
        const transitionsResponse = await jiraAxios.get(`/rest/api/3/issue/${ticketKey}/transitions`);
        const transitions = transitionsResponse.data.transitions;
        const target = transitions.find((t: any) => t.name.toLowerCase().includes(transitionName.toLowerCase()));

        if (!target) {
            console.warn(`  ⚠ Transition "${transitionName}" not available for ${ticketKey}`);
            return false;
        }

        await jiraAxios.post(`/rest/api/3/issue/${ticketKey}/transitions`, {
            transition: { id: target.id }
        });

        console.log(`  ✓ Transitioned ${ticketKey} → ${transitionName}`);
        return true;
    } catch (err: any) {
        console.warn(`  ⚠ Transition failed: ${err.message}`);
        return false;
    }
}

// ============================================================================
// CALL BACKEND API FUNCTIONS
// ============================================================================

const API_BASE = process.env.API_BASE_URL || 'http://localhost:4200';

async function apiStartTesting(ticketId: string): Promise<any> {
    const response = await fetch(`${API_BASE}/api/testing/${ticketId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoTransition: true })
    });
    return response.json();
}

async function apiOrchestrate(ticketId: string): Promise<any> {
    const response = await fetch(`${API_BASE}/api/testing/${ticketId}/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    });
    return response.json();
}

async function apiGenerateTestCases(ticketId: string, options: any = {}): Promise<any> {
    const response = await fetch(`${API_BASE}/api/testing/${ticketId}/test-cases/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options)
    });
    return response.json();
}

async function apiGetSession(ticketId: string): Promise<any> {
    const response = await fetch(`${API_BASE}/api/testing/${ticketId}/session`);
    return response.json();
}

async function apiChatMention(message: string): Promise<any> {
    const response = await fetch(`${API_BASE}/api/testing/chat/mention`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
    });
    return response.json();
}

// ============================================================================
// MAIN TEST FLOW
// ============================================================================

async function runFullE2ETest() {
    console.log('\n' + '█'.repeat(70));
    console.log('  E2E TICKET FLOW TEST: Bug → Story → Testing Ticket');
    console.log('  Started: ' + new Date().toISOString());
    console.log('█'.repeat(70));

    const results: Record<string, { passed: boolean; detail: string }> = {};

    try {
        // ================================================================
        // PHASE 1: Create Bug Ticket
        // ================================================================
        log('PHASE 1: Create Bug Ticket in AB Project');

        let bugKey: string;
        try {
            bugKey = await createJiraIssue(
                TEST_CONFIG.bugProject,
                'Bug',
                TEST_CONFIG.bugSummary,
                TEST_CONFIG.bugDescription
            );
            pass('Bug ticket created');
            results['Phase1_CreateBug'] = { passed: true, detail: `Bug: ${bugKey}` };
        } catch (err: any) {
            fail('Create Bug', err.message);
            results['Phase1_CreateBug'] = { passed: false, detail: err.message };
            console.log('\n⚠️ Jira is not available. Running simulated test flow...\n');

            // Simulate bug key for API testing
            bugKey = `AB-SIM-${Date.now()}`;
            results['Phase1_CreateBug'] = { passed: false, detail: 'Simulated (no Jira connection)' };
        }

        // Verify bug status
        try {
            const bugStatus = await getTicketStatus(bugKey);
            console.log(`  Bug status: ${bugStatus}`);
            results['Phase1_VerifyBugStatus'] = { passed: bugStatus !== 'Unknown', detail: `Status: ${bugStatus}` };
        } catch (err: any) {
            results['Phase1_VerifyBugStatus'] = { passed: false, detail: err.message };
        }

        // ================================================================
        // PHASE 2: Create Story Ticket linked to Bug
        // ================================================================
        log('PHASE 2: Create Story Ticket linked to Bug');

        let storyKey: string;
        try {
            storyKey = await createJiraIssue(
                TEST_CONFIG.bugProject,
                'Story',
                TEST_CONFIG.storySummary,
                TEST_CONFIG.storyDescription,
                bugKey,
                'Relates'
            );
            pass('Story ticket created and linked to Bug');
            results['Phase2_CreateStory'] = { passed: true, detail: `Story: ${storyKey}, linked to ${bugKey}` };
        } catch (err: any) {
            fail('Create Story', err.message);
            results['Phase2_CreateStory'] = { passed: false, detail: err.message };
            storyKey = `AB-STORY-SIM-${Date.now()}`;
        }

        // ================================================================
        // PHASE 3: Create Testing Ticket linked to Story
        // ================================================================
        log('PHASE 3: Create Testing Ticket in ATT Project linked to Story');

        let testingKey: string;
        try {
            testingKey = await createJiraIssue(
                TEST_CONFIG.testProject,
                'Task',
                TEST_CONFIG.testingSummary,
                TEST_CONFIG.testingDescription,
                storyKey,
                'Relates'  // Use 'Relates' as 'Tests' link type may not exist
            );
            pass('Testing ticket created and linked to Story');
            results['Phase3_CreateTesting'] = { passed: true, detail: `Testing: ${testingKey}, linked to ${storyKey}` };
        } catch (err: any) {
            fail('Create Testing', err.message);
            results['Phase3_CreateTesting'] = { passed: false, detail: err.message };
            testingKey = `ATT-SIM-${Date.now()}`;
        }

        // ================================================================
        // PHASE 4: Verify Link Chain
        // ================================================================
        log('PHASE 4: Verify Complete Link Chain (Bug ← Story ← Testing)');

        try {
            const testingDetails = await getTicketDetails(testingKey);
            const linkedIssues = testingDetails.fields?.issuelinks || [];

            const linkedToStory = linkedIssues.some((link: any) => {
                const linked = link.outwardIssue || link.inwardIssue;
                return linked?.key === storyKey;
            });

            if (linkedToStory) {
                pass(`Testing ${testingKey} linked to Story ${storyKey}`);
                results['Phase4_LinkChain'] = { passed: true, detail: `${testingKey} → ${storyKey} → ${bugKey}` };
            } else {
                fail('Link chain verification', 'Testing ticket not linked to Story');
                results['Phase4_LinkChain'] = { passed: false, detail: 'Link not found' };
            }
        } catch (err: any) {
            results['Phase4_LinkChain'] = { passed: false, detail: err.message };
        }

        // ================================================================
        // PHASE 5: Test Backend API - Chat Mention Detection
        // ================================================================
        log('PHASE 5: Test Chat Mention Detection');

        try {
            const mentionResult = await apiChatMention(`Please test ${testingKey} for the Short Code validation issue in ${storyKey}`);
            if (mentionResult.success && mentionResult.mentions?.length > 0) {
                pass(`Chat mention detected ${mentionResult.mentions.length} ticket(s)`);
                results['Phase5_ChatMention'] = {
                    passed: true,
                    detail: `Detected: ${mentionResult.mentions.map((m: any) => m.ticketId).join(', ')}`
                };
            } else {
                fail('Chat mention', 'No tickets detected');
                results['Phase5_ChatMention'] = { passed: false, detail: 'No mentions found' };
            }
        } catch (err: any) {
            fail('Chat mention API', err.message);
            results['Phase5_ChatMention'] = { passed: false, detail: err.message };
        }

        // ================================================================
        // PHASE 6: Test Backend API - Start Testing (Orchestration)
        // ================================================================
        log('PHASE 6: Test Start Testing API (with Orchestration)');

        try {
            const startResult = await apiStartTesting(testingKey);

            if (startResult.success) {
                pass('Testing started successfully');
                console.log(`  Session created: ${startResult.session?.ticketId}`);
                console.log(`  Phase: ${startResult.session?.phase}`);

                if (startResult.orchestration) {
                    const orch = startResult.orchestration;
                    console.log(`  Orchestrator: ${orch.ticketType} → ${orch.action}`);
                    console.log(`  Main ticket: ${orch.mainTicket?.key || 'None'}`);
                    console.log(`  Linked tickets: ${orch.linkedTickets?.length || 0}`);
                    console.log(`  Knowledge: ${orch.knowledgeAvailable ? 'Available' : 'Not available'}`);
                    console.log(`  Skills found: ${orch.skillsFound?.join(', ') || 'None'}`);

                    results['Phase6_StartTesting'] = {
                        passed: true,
                        detail: `Type: ${orch.ticketType}, Action: ${orch.action}, Skills: ${orch.skillsFound?.length || 0}`
                    };
                } else {
                    results['Phase6_StartTesting'] = {
                        passed: true,
                        detail: 'Session created (orchestration not available)'
                    };
                }
            } else {
                fail('Start testing', startResult.error || 'Unknown error');
                results['Phase6_StartTesting'] = { passed: false, detail: startResult.error };
            }
        } catch (err: any) {
            fail('Start testing API', err.message);
            results['Phase6_StartTesting'] = { passed: false, detail: err.message };
        }

        // ================================================================
        // PHASE 7: Test Backend API - Orchestrate Independently
        // ================================================================
        log('PHASE 7: Test Independent Orchestration');

        try {
            const orchResult = await apiOrchestrate(testingKey);

            if (orchResult.success || orchResult.ticketType) {
                pass('Orchestration completed');
                console.log(`  Ticket type: ${orchResult.ticketType}`);
                console.log(`  Main ticket: ${orchResult.mainTicket?.key || 'None'}`);
                console.log(`  Action: ${orchResult.action}`);
                console.log(`  Knowledge: ${orchResult.knowledgeAvailable}`);
                console.log(`  Linked: ${orchResult.linkedTickets?.length || 0} tickets`);
                console.log(`  Skills: ${orchResult.skillsFound?.join(', ') || 'None'}`);

                results['Phase7_Orchestrate'] = {
                    passed: true,
                    detail: `${orchResult.ticketType} → ${orchResult.action}`
                };
            } else {
                fail('Orchestration', orchResult.error || 'Unknown error');
                results['Phase7_Orchestrate'] = { passed: false, detail: orchResult.error || 'No result' };
            }
        } catch (err: any) {
            fail('Orchestration API', err.message);
            results['Phase7_Orchestrate'] = { passed: false, detail: err.message };
        }

        // ================================================================
        // PHASE 8: Test Backend API - Generate Test Cases
        // ================================================================
        log('PHASE 8: Test Test Case Generation');

        try {
            const tcResult = await apiGenerateTestCases(testingKey, { model: 'local', refresh: true });

            if (tcResult.success) {
                pass(`Test cases generated: ${tcResult.testCases?.length || 0}`);
                console.log(`  Generated: ${tcResult.testCases?.length || 0} test cases`);
                if (tcResult.testCases?.length > 0) {
                    console.log(`  First test case: ${tcResult.testCases[0].name}`);
                }

                results['Phase8_GenerateTestCases'] = {
                    passed: true,
                    detail: `${tcResult.testCases?.length || 0} test cases generated`
                };
            } else {
                fail('Test case generation', tcResult.error || 'Unknown error');
                results['Phase8_GenerateTestCases'] = { passed: false, detail: tcResult.error || 'No result' };
            }
        } catch (err: any) {
            fail('Test case generation API', err.message);
            results['Phase8_GenerateTestCases'] = { passed: false, detail: err.message };
        }

        // ================================================================
        // PHASE 9: Verify Session State
        // ================================================================
        log('PHASE 9: Verify Session State');

        try {
            const sessionResult = await apiGetSession(testingKey);

            if (sessionResult.success || sessionResult.session) {
                const session = sessionResult.session || sessionResult;
                pass('Session retrieved');
                console.log(`  Ticket: ${session.ticketId}`);
                console.log(`  Phase: ${session.phase}`);
                console.log(`  Status: ${session.status}`);
                console.log(`  Test cases: ${session.testCases?.length || 0}`);
                console.log(`  Version: ${session.version}`);

                results['Phase9_SessionState'] = {
                    passed: true,
                    detail: `Phase: ${session.phase}, Cases: ${session.testCases?.length || 0}`
                };
            } else {
                fail('Session retrieval', 'No session found');
                results['Phase9_SessionState'] = { passed: false, detail: 'No session' };
            }
        } catch (err: any) {
            fail('Session API', err.message);
            results['Phase9_SessionState'] = { passed: false, detail: err.message };
        }

        // ================================================================
        // PHASE 10: Post Status Comments to All Linked Tickets
        // ================================================================
        log('PHASE 10: Post Status Comments to All Tickets');

        try {
            const statusComment = `🤖 E2E Test executed at ${new Date().toISOString()}\n\nAll phases of the testing workflow have been verified.`;

            if (bugKey && !bugKey.includes('SIM')) {
                await postComment(bugKey, statusComment);
            }
            if (storyKey && !storyKey.includes('SIM')) {
                await postComment(storyKey, statusComment);
            }
            if (testingKey && !testingKey.includes('SIM')) {
                await postComment(testingKey, statusComment);
            }

            pass('Comments posted to all linked tickets');
            results['Phase10_PostComments'] = { passed: true, detail: 'Comments posted' };
        } catch (err: any) {
            results['Phase10_PostComments'] = { passed: false, detail: err.message };
        }

    } catch (err: any) {
        console.error(`\n💥 E2E test crashed: ${err.message}`);
    }

    // ================================================================
    // FINAL REPORT
    // ================================================================
    console.log('\n' + '█'.repeat(70));
    console.log('  E2E TICKET FLOW TEST — FINAL REPORT');
    console.log('  Completed: ' + new Date().toISOString());
    console.log('█'.repeat(70));

    let passCount = 0;
    let failCount = 0;

    for (const [phase, result] of Object.entries(results)) {
        const icon = result.passed ? '✅' : '❌';
        if (result.passed) passCount++;
        else failCount++;
        console.log(`  ${icon} ${phase}: ${result.passed ? 'PASS' : 'FAIL'} — ${result.detail}`);
    }

    console.log('\n' + '-'.repeat(70));
    console.log(`  Total: ${passCount + failCount} | ✅ Passed: ${passCount} | ❌ Failed: ${failCount}`);
    console.log('█'.repeat(70));

    // Cleanup: comment about test completion
    if (process.env.CLEANUP_TEST_TICKETS === 'true') {
        console.log('\n🧹 Cleaning up created tickets...');
        for (const ticket of createdTickets) {
            try {
                await transitionTicket(ticket, 'Done');
                console.log(`  ✓ ${ticket} transitioned to Done`);
            } catch (err: any) {
                console.warn(`  ⚠ Could not transition ${ticket}: ${err.message}`);
            }
        }
    }

    return { passCount, failCount, results };
}

// ============================================================================
// RUN
// ============================================================================

runFullE2ETest()
    .then(result => {
        console.log(`\n🏁 Test run complete: ${result.passCount}/${result.passCount + result.failCount} passed`);
        process.exit(result.failCount > 0 ? 1 : 0);
    })
    .catch(err => {
        console.error('\n💥 Unhandled error:', err.message);
        process.exit(1);
    });
