import axios from 'axios';

const BASE_URL = 'http://localhost:3000';
const TICKET_ID = 'ATT-14';

async function executeOnly() {
    console.log(`================================`);
    console.log(`🚀 Executing Existing Tests for ${TICKET_ID}`);
    console.log(`================================`);

    try {
        console.log(`\n[1] Bypassing generation. Executing tests directly...`);
        const execRes = await axios.post(`${BASE_URL}/api/testing/${TICKET_ID}/execute`, {
            environment: {
                stage: 'testing',
                baseUrl: 'https://test.globalhr.com.mm/ook',
                browser: 'chromium',
                headless: false 
            }
        }, { timeout: 0 }); // No timeout
        
        console.log(`✅ Execution complete!\n`, JSON.stringify(execRes.data.summary, null, 2));

        console.log(`\n[2] Uploading Results to Jira (Comment only)...`);
        const uploadRes = await axios.post(`${BASE_URL}/api/testing/${TICKET_ID}/results/upload`, {
            postComment: true,
            uploadAttachment: false
        });
        console.log(`✅ Upload complete!`);
        
    } catch (e: any) {
        console.error(`\n❌ Execution failed:`);
        if (e.response) {
            console.error(JSON.stringify(e.response.data, null, 2));
        } else {
            console.error(e.message);
        }
    }
}

executeOnly();
