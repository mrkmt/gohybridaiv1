import axios from 'axios';

const BASE_URL = 'http://localhost:3000';
const TICKETS = ['ATT-14', 'ATT-15'];

async function runTicketFlow(ticketId: string) {
    console.log(`\n================================`);
    console.log(`🚀 Starting Flow for ${ticketId}`);
    console.log(`================================`);

    try {
        // 1. Delete existing session (clear cache)
        console.log(`\n[1] Clearing cache session for ${ticketId}...`);
        try {
            await axios.delete(`${BASE_URL}/api/testing/${ticketId}/session`);
            console.log(`✅ Cleared session for ${ticketId}`);
        } catch (e: any) {
            console.log(`⚠️ Could not delete session (maybe it didn't exist): ${e.message}`);
        }

        // 2. Start testing
        console.log(`\n[2] Starting testing workflow...`);
        const startRes = await axios.post(`${BASE_URL}/api/testing/${ticketId}/start`, {
            autoTransition: true
        });
        console.log(`✅ Started testing:`, startRes.data.message);

        // 3. Generate Test Cases (refresh=true, model='gemini' or something similar supported by backend)
        console.log(`\n[3] Generating test cases using Gemini (bypassing cache)...`);
        const genRes = await axios.post(`${BASE_URL}/api/testing/${ticketId}/test-cases/generate`, {
            refresh: true,
            model: 'Hybrid-Gemini-CLI' // Assuming Gemini CLI model name
        }, { timeout: 120000 }); // give it 2 minutes
        console.log(`✅ Generated ${genRes.data.testCases?.length || 0} test cases!`);

        // 4. Approve Test Cases
        console.log(`\n[4] Approving test cases...`);
        const approveRes = await axios.post(`${BASE_URL}/api/testing/${ticketId}/test-cases/approve`);
        console.log(`✅ Approved test cases:`, approveRes.data.message);

        // 5. Execute Tests
        console.log(`\n[5] Executing tests (this will take a while)...`);
        const execRes = await axios.post(`${BASE_URL}/api/testing/${ticketId}/execute`, {
            environment: {
                stage: 'testing',
                baseUrl: 'https://test.globalhr.com.mm/ook',
                username: process.env.TEST_USERNAME || 'testook_HR 1',
                password: process.env.TEST_PASSWORD || 'Global@2024',
                idNumber: process.env.TEST_IDNUMBER || 'testook_HR 1'
            }
        }, { timeout: 300000 }); // 5 mins timeout
        
        console.log(`✅ Execution complete!`);
        console.log(`   Passed: ${execRes.data.summary.passed}/${execRes.data.summary.total}`);

        // 6. Upload Results
        console.log(`\n[6] Uploading results to Jira and commenting...`);
        const uploadRes = await axios.post(`${BASE_URL}/api/testing/${ticketId}/results/upload`, {
            postComment: true,
            uploadAttachment: true,
            transitionTo: 'Done' // optionally 'Done'
        }, { timeout: 60000 });
        console.log(`✅ Upload complete!`);
        console.log(`   Attachment ID:`, uploadRes.data.results?.attachment?.attachmentId || 'N/A');
        console.log(`   Comment Posted:`, uploadRes.data.results?.commentPosted);

        console.log(`\n🎉 Workflow for ${ticketId} completed successfully!`);

    } catch (error: any) {
        console.error(`\n❌ Full workflow failed for ${ticketId}:`);
        if (error.response) {
            console.error('API Error Response:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message);
        }
    }
}

async function main() {
    console.log('Ensure the backend is running on http://localhost:3000 !');
    
    // We run sequentially to not overwhelm Playwright
    for (const ticket of TICKETS) {
        await runTicketFlow(ticket);
    }
}

main();
