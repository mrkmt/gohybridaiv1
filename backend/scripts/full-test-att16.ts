import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:3000';
const TICKET_ID = 'ATT-16';

async function fullTest() {
    console.log(`================================`);
    console.log(`🚀 Full Test for ${TICKET_ID}`);
    console.log(`================================`);

    try {
        // Step 0: Clear old cached test data
        console.log(`\n[0] Clearing old test cache for ${TICKET_ID}...`);
        const draftPath = path.join(process.cwd(), 'local_storage', 'drafts', `${TICKET_ID}.json`);
        if (fs.existsSync(draftPath)) {
            fs.unlinkSync(draftPath);
            console.log(`   Deleted cached draft: ${draftPath}`);
        }

        // Delete old spec files in test-results/ATT-16
        const testResultsDir = path.join(process.cwd(), 'test-results', TICKET_ID);
        if (fs.existsSync(testResultsDir)) {
            const oldSpecs = fs.readdirSync(testResultsDir).filter(f => f.endsWith('.spec.ts'));
            for (const spec of oldSpecs) {
                fs.unlinkSync(path.join(testResultsDir, spec));
            }
            const oldConfigs = fs.readdirSync(testResultsDir).filter(f => f.startsWith('_pw_config'));
            for (const cfg of oldConfigs) {
                fs.unlinkSync(path.join(testResultsDir, cfg));
            }
            console.log(`   Deleted ${oldSpecs.length} old spec files and ${oldConfigs.length} old configs.`);
        }

        // Step 1: Generate test cases fresh
        console.log(`\n[1] Generating fresh test cases...`);
        const genRes = await axios.post(`${BASE_URL}/api/testing/${TICKET_ID}/generate`, {}, { timeout: 120000 });
        const testCases = genRes.data.testCases || [];
        console.log(`   ✅ Generated ${testCases.length} test cases:`);
        testCases.forEach((tc: any) => {
            console.log(`      - ${tc.caseId}: ${tc.title} (${tc.steps?.length || 0} steps)`);
        });

        // Step 2: Auto-approve
        console.log(`\n[2] Auto-approving test cases...`);
        await axios.post(`${BASE_URL}/api/testing/${TICKET_ID}/approve`);
        console.log(`   ✅ Approved!`);

        // Step 3: Execute
        console.log(`\n[3] Executing tests (this may take several minutes)...`);
        const execRes = await axios.post(`${BASE_URL}/api/testing/${TICKET_ID}/execute`, {
            environment: {
                stage: 'testing',
                baseUrl: 'https://test.globalhr.com.mm/ook',
                browser: 'chromium',
                headless: false
            }
        }, { timeout: 0 }); // No axios timeout - let the server handle it

        const summary = execRes.data.summary;
        console.log(`\n   ✅ Execution complete!`);
        console.log(`   📊 Results: ${summary.passed}/${summary.total} passed, ${summary.failed} failed`);
        console.log(`   ⏱️  Duration: ${Math.round(summary.totalDuration / 1000)}s`);

        // Step 4: Report results
        if (execRes.data.results) {
            console.log(`\n[4] Test Case Results:`);
            for (const r of execRes.data.results) {
                const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⏭️';
                console.log(`   ${icon} ${r.testCaseId}: ${r.testCaseTitle} - ${r.status} (${r.duration}ms)`);
                if (r.errorMessage) {
                    console.log(`      Error: ${r.errorMessage.substring(0, 150)}...`);
                }
                if (r.isExecutionFault) {
                    console.log(`      ⚠️ Execution Fault (not a real defect)`);
                }
            }
        }

        // Step 5: Upload to Jira
        console.log(`\n[5] Uploading results to Jira...`);
        try {
            const uploadRes = await axios.post(`${BASE_URL}/api/testing/${TICKET_ID}/results/upload`, {
                postComment: true,
                uploadAttachment: false
            });
            console.log(`   ✅ Jira comment posted!`);
        } catch (e: any) {
            console.log(`   ⚠️ Jira upload issue: ${e.response?.data?.error || e.message}`);
        }

        console.log(`\n================================`);
        console.log(`🏁 ${TICKET_ID} Full Test Complete!`);
        console.log(`================================`);

    } catch (e: any) {
        console.error(`\n❌ Failed:`);
        if (e.response) {
            console.error(`   Status: ${e.response.status}`);
            console.error(`   Data: ${JSON.stringify(e.response.data, null, 2).substring(0, 500)}`);
        } else {
            console.error(`   ${e.message}`);
        }
    }
}

fullTest();
