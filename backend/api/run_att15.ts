import { JiraTransitionService } from '../src/services/jira/JiraTransitionService';
import { TestCaseGeneratorService } from '../src/services/generation/TestCaseGeneratorService';
import { appLogger } from '../src/utils/logger';
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env from backend root
dotenv.config({ path: path.join(__dirname, '../.env') });

async function runAtt15() {
    const ticketId = 'ATT-15';
    console.log(`\n🚀 [DEMO] Starting Full Pipeline for ${ticketId}`);

    try {
        // 1. Jira Transition
        console.log(`[PHASE 1] Transitioning ${ticketId} to "In Testing"...`);
        try {
            const transitionResult = await JiraTransitionService.autoTransitionToInTesting(ticketId);
            console.log(`✅ Transition Success:`, transitionResult);
        } catch (e: any) {
            console.warn(`⚠️ Transition failed (might already be in status or no matching transition): ${e.message}`);
        }

        // 2. Scenario Generation (This will also trigger Discovery internally due to my fix)
        console.log(`\n[PHASE 2] Generating Scenarios & Running Discovery (First-time)...`);
        const scenarioResult = await TestCaseGeneratorService.generateScenariosFromJira(ticketId);
        
        console.log(`\n✅ [SCENARIOS GENERATED] Found ${scenarioResult.scenarios.length} scenarios:`);
        scenarioResult.scenarios.forEach((s, i) => {
            console.log(`  ${i+1}. [${s.type.toUpperCase()}] ${s.title}`);
        });

        // 3. Test Case Generation
        console.log(`\n[PHASE 3] Generating Detailed Test Cases for selected scenarios...`);
        const selectedScenarios = scenarioResult.scenarios.slice(0, 2); // Select first 2
        const testCaseResult = await TestCaseGeneratorService.generateFromScenarios(ticketId, selectedScenarios);
        
        console.log(`\n✅ [TEST CASES GENERATED] Found ${testCaseResult.testCases.length} test cases:`);
        testCaseResult.testCases.forEach((tc, i) => {
            console.log(`  ${i+1}. ${tc.title} (${tc.priority})`);
            console.log(`     Steps: ${tc.steps.length}`);
        });

        console.log(`\n✨ [COMPLETE] Full pipeline verified for ${ticketId}`);

    } catch (error: any) {
        console.error(`\n❌ [ERROR] Pipeline failed:`, error.message);
    }
}

runAtt15().catch(console.error);
