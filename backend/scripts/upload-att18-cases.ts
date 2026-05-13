import * as fs from 'fs';
import * as path from 'path';
import { JiraUploadService } from '../src/services/JiraUploadService';

async function main() {
    const ticketId = 'ATT-18';
    const sessionPath = path.join(__dirname, '..', 'local_storage', 'session-history', 'ATT-18', 'v9_1775281032761.json');

    if (!fs.existsSync(sessionPath)) {
        console.error(`Session file not found: ${sessionPath}`);
        process.exit(1);
    }

    const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    const testCases = sessionData.testCases;

    if (!testCases || testCases.length === 0) {
        console.error('No test cases found in session data.');
        process.exit(1);
    }

    console.log(`🚀 Starting Jira sync for ${ticketId}...`);
    console.log(`Found ${testCases.length} test cases.`);

    try {
        const success = await JiraUploadService.updateTestCaseField(ticketId, testCases);
        if (success) {
            console.log(`✅ Successfully uploaded test cases to ${ticketId}`);
        } else {
            console.error(`❌ Failed to upload test cases to ${ticketId}`);
            process.exit(1);
        }
    } catch (error: any) {
        console.error(`❌ Error during Jira sync: ${error.message}`);
        process.exit(1);
    }
}

main();
