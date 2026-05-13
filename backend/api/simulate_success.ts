import { JiraService } from './JiraService';
import { SystemAuditorService } from './SystemAuditorService';
import { KnowledgeService } from './KnowledgeService';
import { ReportingService, TestCaseResult } from './ReportingService';

/**
 * FULL LOOP VERIFICATION (MOCKED AI)
 * Demonstrates the results of the multi-case suite without requiring API keys.
 */
async function simulateReproductionResult(jiraId: string) {
    console.log(`\n🚀 [ORCHESTRATOR] Starting Verified Run for: ${jiraId}`);

    // 1. Audit Cleanup
    await SystemAuditorService.cleanupZombieProcesses();

    // 2. Mock Suite Data (This is what the AI would normally return)
    const mockPlaybook = {
        jiraId: jiraId,
        module: "Time Attendance",
        menu: "Leave Approve",
        tokensUsed: { prompt: 1200, completion: 450, total: 1650 },
        testCases: [
            { caseId: "MAIN_BUG", title: "Reproduction of Single/Multi Reject Lock", isMain: true },
            { caseId: "POS_VAL_01", title: "Verify Single Approve works after Refresh", isMain: false },
            { caseId: "NEG_VAL_01", title: "Verify Multi Reject error message when no rows selected", isMain: false },
            { caseId: "EDGE_RULE_01", title: "Check Policy: Max Reject count per day", isMain: false }
        ]
    };

    console.log(`[ORCHESTRATOR] Suite generated: ${mockPlaybook.testCases.length} cases found.`);

    // 3. Simulated Results
    const results: TestCaseResult[] = [
        {
            caseId: "MAIN_BUG",
            title: mockPlaybook.testCases[0].title,
            status: 'failed', // Reproduces the issue
            hasVideo: true,
            screenshotPath: `forensics/${jiraId}/MAIN_BUG_fail.png`,
            videoPath: `forensics/${jiraId}/repro_video.webm`
        },
        {
            caseId: "POS_VAL_01",
            title: mockPlaybook.testCases[1].title,
            status: 'passed',
            hasVideo: false,
            screenshotPath: `forensics/${jiraId}/POS_VAL_01.png`
        },
        {
            caseId: "NEG_VAL_01",
            title: mockPlaybook.testCases[2].title,
            status: 'passed',
            hasVideo: false,
            screenshotPath: `forensics/${jiraId}/NEG_VAL_01.png`
        },
        {
            caseId: "EDGE_RULE_01",
            title: mockPlaybook.testCases[3].title,
            status: 'passed',
            hasVideo: false,
            screenshotPath: `forensics/${jiraId}/EDGE_RULE_01.png`
        }
    ];

    console.log(`[RUNNER] Suite execution complete. Evidence gathered.`);

    // 4. Final Reporting Matrix
    const jiraComment = ReportingService.generateJiraVerificationMatrix(jiraId, results, mockPlaybook.tokensUsed);
    
    console.log("\n========================================================");
    console.log("FINAL JIRA VERIFICATION OUTPUT");
    console.log("========================================================\n");
    console.log(jiraComment);
    console.log("\n========================================================");
    
    console.log(`\n✨ [COMPLETE] Verification Flow demo finished for ${jiraId}.`);
}

simulateReproductionResult('GB-5238').catch(console.error);
