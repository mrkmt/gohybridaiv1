
import { PredictiveAnalyticsService } from '../src/services/PredictiveAnalyticsService';
import { TokenManagerService } from '../src/services/TokenManagerService';
import { FailureClassificationService } from '../src/services/execution/FailureClassificationService';

async function runSmokeTest() {
    console.log('🧪 Starting System Logic Smoke Test...');

    try {
        // 1. Test Token Budgeting
        console.log('\n--- 1. Testing Token Manager ---');
        const systemPrompt = "You are a helpful assistant.";
        const jiraData = { description: "Very long description ".repeat(100) };
        const uiMap = Array(50).fill({ id: 'btn', text: 'Click me' });
        
        const result = TokenManagerService.buildBudgetedPrompt(systemPrompt, jiraData, uiMap, 2000);
        console.log(`[Smoke] Original Tokens: ${result.originalTokens}`);
        console.log(`[Smoke] Budgeted Tokens: ${result.finalTokens}`);
        console.log(`[Smoke] Truncated: ${result.isTruncated}`);
        
        if (result.finalTokens > 2100) throw new Error('Token budgeting failed to limit tokens');
        console.log('✅ Token Manager logic verified.');

        // 2. Test Failure Classification
        console.log('\n--- 2. Testing Failure Classification ---');
        const assertionError = "Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: true\nReceived: false";
        const selectorError = "Error: locator.click: Timeout 30000ms exceeded.\n==== log ====\nwaiting for locator('button#submit')";
        
        const class1 = FailureClassificationService.classifyFailure(assertionError);
        const class2 = FailureClassificationService.classifyFailure(selectorError);
        
        console.log(`[Smoke] Assertion Error Category: ${class1.category}`);
        console.log(`[Smoke] Selector Error Category: ${class2.category}`);
        
        if (class1.category !== 'ASSERTION_FAILURE') throw new Error('Assertion classification failed');
        if (class2.category !== 'SELECTOR_ERROR') throw new Error('Selector classification failed');
        console.log('✅ Failure Classification logic verified.');

        console.log('\n✨ System Logic Smoke Test Passed!');
        process.exit(0);
    } catch (err: any) {
        console.error('\n❌ Smoke Test Failed:', err.message);
        process.exit(1);
    }
}

runSmokeTest();
