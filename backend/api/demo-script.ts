import { Phase3PlaywrightGenerationService } from './Phase3PlaywrightGenerationService';
import { config } from './config';
import * as fs from 'fs';
import * as path from 'path';

async function demo() {
    console.log('=== Playwright Script Generation Demo ===');
    const jiraId = 'ATT-7';
    const planSteps = [
        "Given I open the tenant login page",
        "When I enter the provided credentials",
        "And I submit the login form",
        "Then I should be logged in and see the dashboard",
        "When I navigate to the OT Approval module",
        "And I select a pending OT request and reject it",
        "When I navigate to the Mobile Approve screen",
        "Then I should verify that the From-To date/time fields are NOT displayed for the rejected OT"
    ];

    try {
        const result = await Phase3PlaywrightGenerationService.generateAndSave({
            jiraId,
            planSteps,
            targetEnv: 'testing',
            baseUrl: 'http://localhost:4200',
            customerId: 'DEMO-UNIT',
            testIdNumber: 'A123',
            testUsername: 'qa_lead',
            testPassword: 'password123'
        });
        
        console.log('\n✅ Script Generated Successfully!');
        console.log('Path:', result.testScript);
        console.log('Model Used:', result.modelUsed);
        console.log('\nGenerated Code Sample (first 15 lines):');
        console.log(result.testCode.split('\n').slice(0, 15).join('\n'));
        console.log('...');
    } catch (error: any) {
        console.error('❌ Error:', error.message);
    }
}

demo();
