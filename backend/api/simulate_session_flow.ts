import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3000';
const HEADERS = {
    'Content-Type': 'application/json',
    'x-api-key': 'dev-test-key-12345'
};

async function simulateFullFlow(ticketId: string) {
    console.log(`\n🕵️‍♂️ SIMULATING FRONTEND -> BACKEND E2E FLOW FOR [${ticketId}]`);

    try {
        // 1. MENTION
        console.log('\n[Phase 1] Mentioning ticket...');
        const mentionRes = await fetch(`${BASE_URL}/api/testing/chat/mention`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ message: `I want to test ${ticketId}` })
        });
        
        const mentionJson = await mentionRes.json() as any;
        if (!mentionRes.ok) {
            console.error('❌ Mention API Error:', JSON.stringify(mentionJson, null, 2));
            return;
        }

        const tickets = mentionJson.data?.tickets || [];
        if (tickets.length === 0) {
            console.error('❌ Ticket not found in response');
            return;
        }
        console.log(`✅ AI identified: ${tickets[0].summary}`);

        // 2. SCENARIO GENERATION
        console.log('\n[Phase 2] Generating scenarios...');
        const scenarioRes = await fetch(`${BASE_URL}/api/testing/${ticketId}/scenarios`, {
            method: 'POST',
            headers: HEADERS
        });
        const scenarioJson = await scenarioRes.json() as any;
        if (!scenarioRes.ok) {
            console.error('❌ Scenario API Error:', JSON.stringify(scenarioJson, null, 2));
            return;
        }

        const scenarios = scenarioJson.scenarios || [];
        const selectedScenarios = scenarios.slice(0, 2);
        console.log(`✅ Generated ${scenarios.length} scenarios. Selected: ${selectedScenarios.length}`);

        // 3. TEST CASE GENERATION
        console.log('\n[Phase 3] Translating scenarios to Playwright JSON...');
        const testCaseRes = await fetch(`${BASE_URL}/api/testing/${ticketId}/test-cases/generate`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ scenarios: selectedScenarios })
        });
        const testCaseJson = await testCaseRes.json() as any;
        if (!testCaseRes.ok) {
            console.error('❌ Test Case API Error:', JSON.stringify(testCaseJson, null, 2));
            return;
        }
        console.log(`✅ Test cases ready. AI wrote ${testCaseJson.data.testCases.length} scripts.`);

        // 4. APPROVAL
        console.log('\n[Phase 4] Approving test scripts...');
        const approveRes = await fetch(`${BASE_URL}/api/testing/${ticketId}/test-cases/approve`, {
            method: 'POST',
            headers: HEADERS
        });
        const approveJson = await approveRes.json() as any;
        console.log(`✅ Status: ${approveJson.message}`);

        // 5. EXECUTION
        console.log('\n[Phase 5] Executing Playwright missions (Headless)...');
        const executeRes = await fetch(`${BASE_URL}/api/testing/execute`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ ticketId, testCases: testCaseJson.data.testCases })
        });
        const executeJson = await executeRes.json() as any;
        if (!executeRes.ok) {
            console.error('❌ Execution API Error:', JSON.stringify(executeJson, null, 2));
            return;
        }
        const results = executeJson.data?.results || [];
        const passCount = results.filter((r: any) => r.status === 'PASS').length;
        console.log(`✅ Execution complete. Result: ${passCount} PASSED, ${results.length - passCount} FAILED.`);

        console.log('\n🏆 SIMULATION COMPLETE: End-to-End API Chain Verified.');

    } catch (err: any) {
        console.error('\n❌ Simulation Failed:', err.message);
    }
}

simulateFullFlow('AB-37');
