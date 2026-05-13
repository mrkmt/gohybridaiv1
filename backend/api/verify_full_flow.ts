import axios from 'axios';
import fs from 'fs';
import path from 'path';

const API_URL = 'http://localhost:3000';

async function runTest() {
    console.log('--- STARTING BACKEND FULL FLOW TEST (ATT-8) ---');
    
    try {
        // 1. Phase 2: Generate Reproduction Plan
        console.log('\n[Phase 2] Requesting reproduction plan...');
        const phase2Req = {
            jiraId: 'ATT-8',
            ticket: {
                summary: 'Investigate Bug in Leave Balance Report',
                description: 'The leave balance report is showing incorrect values for specific users.'
            },
            sanitizedSteps: [],
            detectedForms: [],
            detectedRules: []
        };
        
        const startTime2 = Date.now();
        const res2 = await axios.post(`${API_URL}/api/phase2/reproduction-plan`, phase2Req);
        const res2Data = res2.data as any;
        const duration2 = Date.now() - startTime2;
        console.log(`[Phase 2] Success! Steps: ${res2Data.steps.length}, Model: ${res2Data.aiModel}, Duration: ${duration2}ms`);
        console.log('Plan Steps:', res2Data.steps);

        // 2. Phase 2 Cache Test (Repeat)
        console.log('\n[Phase 2 Cache] Repeating request to verify cache...');
        const startTime2c = Date.now();
        const res2c = await axios.post(`${API_URL}/api/phase2/reproduction-plan`, phase2Req);
        const duration2c = Date.now() - startTime2c;
        console.log(`[Phase 2 Cache] Success! Duration: ${duration2c}ms (Should be much faster)`);

        // 3. Phase 3: Generate Playwright Script
        console.log('\n[Phase 3] Generating Playwright script...');
        const phase3Req = {
            jiraId: 'ATT-8',
            planSteps: res2Data.steps,
            targetEnv: 'testing',
            baseUrl: 'https://test.globalhr.com.mm/',
            customerId: 'ook',
            testIdNumber: process.env.TEST_IDNUMBER || '',
            testUsername: process.env.TEST_USERNAME || '',
            testPassword: process.env.TEST_PASSWORD || ''
        };

        const startTime3 = Date.now();
        const res3 = await axios.post(`${API_URL}/api/phase3/generate-playwright`, phase3Req);
        const res3Data = res3.data as any;
        const duration3 = Date.now() - startTime3;
        console.log(`[Phase 3] Success! Script path: ${res3Data.testScript}, Model: ${res3Data.modelUsed}, Duration: ${duration3}ms`);

        // 4. Phase 3 Cache Test (Repeat)
        console.log('\n[Phase 3 Cache] Repeating request to verify cache...');
        const startTime3c = Date.now();
        const res3c = await axios.post(`${API_URL}/api/phase3/generate-playwright`, phase3Req);
        const duration3c = Date.now() - startTime3c;
        console.log(`[Phase 3 Cache] Success! Duration: ${duration3c}ms (Should be much faster)`);

        // 5. Phase 4: Execute Test
        console.log('\n[Phase 4] Executing Playwright test...');
        const phase4Req = {
            testScript: res3Data.testScript,
            moduleName: 'ATT-8',
            targetRuleId: res2Data.targetRuleId,
            environment: 'testing',
            baseUrl: 'https://test.globalhr.com.mm/',
            customerId: 'ook',
            credentials: {
                idNumber: 'testook_HR 1',
                username: 'testook_HR 1',
                password: 'Global@2024'
            }
        };

        const startTime4 = Date.now();
        const res4 = await axios.post(`${API_URL}/api/execute-test`, phase4Req);
        const res4Data = res4.data as any;
        const duration4 = Date.now() - startTime4;
        console.log(`[Phase 4] Execution result status: ${res4Data.status}, Duration: ${duration4}ms`);
        if (res4Data.failedTests && res4Data.failedTests.length > 0) {
            console.log('Failed Tests:', res4Data.failedTests);
        }

        console.log('\n--- ALL PHASES COMPLETED SUCCESSFULLY ---');

    } catch (err: any) {
        console.error('\n!!! TEST FAILED !!!');
        if (err.response) {
            console.error('Response Error:', err.response.data);
            console.error('Status:', err.response.status);
        } else {
            console.error('Error:', err.message);
        }
        process.exit(1);
    }
}

runTest();
