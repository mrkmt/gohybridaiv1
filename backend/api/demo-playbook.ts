import { JiraService } from './JiraService';
import { config } from './config';
import * as fs from 'fs';
import * as path from 'path';

async function demo() {
    console.log('=== AI Playbook Generation Demo ===');
    const jiraId = 'ATT-7';
    const summary = 'Testing task for First time OT Reject လုပ်ထားတာကို Mobile Approve From - Toမပြချင်လို့ပါ';
    const description = 'Reference: AB-16';

    try {
        const playbook = await JiraService.generatePlaybook(jiraId, summary, description);
        console.log('\n✅ Playbook Generated Successfully!');
        console.log('Module:', playbook.module);
        console.log('Menu:', playbook.menu);
        console.log('\nTest Cases:');
        playbook.testCases.forEach(tc => {
            console.log(`- [${tc.caseId}] ${tc.title}`);
            tc.steps.forEach(s => console.log(`  ${s.stepNumber}. ${s.action}`));
        });
        
        console.log('\nKnowledge Context Used:', playbook.tokensUsed.total, 'tokens');
    } catch (error: any) {
        console.error('❌ Error:', error.message);
    }
}

demo();
