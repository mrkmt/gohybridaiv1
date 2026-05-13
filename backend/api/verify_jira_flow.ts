import { JiraService } from './JiraService';
import { SystemAuditorService } from './SystemAuditorService';
import { KnowledgeService } from './KnowledgeService';
import { ReproductionPlanService } from './ReproductionPlanService';
import { ReportingService, TestCaseResult } from './ReportingService';
import { TestExecutionService } from './TestExecutionService';
import { config } from './config';

/**
 * SIMULATED E2E REPRODUCTION LOOP
 * Jira ID: GB-5238 (Leave Approve Single/Multi Reject Issue)
 */
async function verifyJiraFlow(jiraId: string) {
    console.log(`\n🚀 [ORCHESTRATOR] Starting Full Loop for: ${jiraId}`);

    // 1. CLEANUP: Kill zombie browsers
    await SystemAuditorService.cleanupZombieProcesses();

    // 2. INGEST: Fetch Jira Ticket (Simulated for this demo)
    console.log(`[ORCHESTRATOR] Fetching details for ${jiraId}...`);
    // In a real run, we'd use JiraService.fetchIssue(jiraId)
    const mockTicket = {
        id: jiraId,
        summary: "Issue with Leave Approve Single/Multi Reject",
        description: "Issue 1: Leave Approve မှာ Single Approve/ Single Reject လုပ်ပြီးသွားရင် Multi Approve, Multi Reject တွေ လုပ်လို မရတော့ပါ။ Refresh လုပ်ပြီးမှသာလျှင် Multi Approve, Multi Reject ပြန်လုပ်လို ရပါသည်။"
    };

    // 3. ENRICH: Get Knowledge from User Guide
    console.log(`[ORCHESTRATOR] Consulting User Guide for "Leave Approval" policies...`);
    const knowledge = await KnowledgeService.findSemanticDocs("Leave Approve Multi Reject Policy", 1);
    console.log(`[ORCHESTRATOR] Found relevant rule: ${knowledge[0]?.title || 'Standard Approval Logic'}`);

    // 4. PLAN: Generate Multi-Case Suite
    console.log(`[ORCHESTRATOR] AI generating verification suite (Main + 5 Edge Cases)...`);
    const playbook = await JiraService.generatePlaybook(jiraId, mockTicket.summary, mockTicket.description);
    console.log(`[ORCHESTRATOR] Suite generated: ${playbook.testCases.length} cases found.`);
    console.log(`[ORCHESTRATOR] AI Tokens Spent: ${playbook.tokensUsed.total}`);

    // 5. EXECUTE: Simulate running the cases
    const results: TestCaseResult[] = [];
    
    for (const testCase of playbook.testCases) {
        console.log(`\n▶️ [RUNNER] Executing: ${testCase.caseId} - ${testCase.title}`);
        
        // In a real run, we would call ScriptGenerationService and TestExecutionService
        // For this verification, we simulate the Playwright result
        const isSuccess = testCase.caseId !== 'MAIN_BUG'; // Simulate the bug failing, others passing
        
        results.push({
            caseId: testCase.caseId,
            title: testCase.title,
            status: isSuccess ? 'passed' : 'failed',
            hasVideo: testCase.isMain,
            screenshotPath: `forensics/${jiraId}/${testCase.caseId}.png`,
            videoPath: testCase.isMain ? `forensics/${jiraId}/repro_video.webm` : undefined
        });
        
        console.log(`✅ [RESULT] ${testCase.caseId}: ${isSuccess ? 'PASSED' : 'FAILED'}`);
    }

    // 6. REPORT: Format Jira Matrix
    console.log(`\n📊 [ORCHESTRATOR] Finalizing Jira Verification Matrix...`);
    const jiraComment = ReportingService.generateJiraVerificationMatrix(jiraId, results, playbook.tokensUsed);
    
    console.log("\n--- JIRA AUTO-COMMENT PREVIEW ---");
    console.log(jiraComment);
    console.log("---------------------------------\n");

    // 7. PUSH: Post to Jira (Simulated)
    console.log(`[ORCHESTRATOR] Posting comment and ${results.length} artifacts to ${jiraId}...`);
    console.log(`✨ [COMPLETE] Workflow finished for ${jiraId}.`);
}

// Run the verification
verifyJiraFlow('GB-5238').catch(console.error);
