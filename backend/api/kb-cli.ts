import { JiraService } from './JiraService';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    if (command === 'generate-playbook') {
        const jiraId = args[1] || "GB-340";
        // In a real scenario, we'd read the Excel/TXT here. For demo, we use a test file.
        const descPath = path.join(process.cwd(), 'test_jira_description.txt');

        if (!fs.existsSync(descPath)) {
            console.error("Error: test_jira_description.txt not found. Run the Excel extractor first.");
            process.exit(1);
        }

        const description = fs.readFileSync(descPath, 'utf-8');
        const summary = "Bug in GlobalHR System";

        console.log(`[kb-cli] Generating Playbook for ${jiraId}...`);

        try {
            const playbook = await JiraService.generatePlaybook(jiraId, summary, description);
            console.log("====================================================");
            console.log("REPRODUCTION PLAYBOOK (JSON)");
            console.log("====================================================");
            console.log(JSON.stringify(playbook, null, 2));

            // Save to file for the extension
            const outputPath = path.join(process.cwd(), `playbook_${jiraId}.json`);
            fs.writeFileSync(outputPath, JSON.stringify(playbook, null, 2));
            console.log(`\n[SUCCESS] Playbook saved to ${outputPath}`);
        } catch (err) {
            console.error("[ERROR] Failed to generate playbook:", err);
        }
    } else {
        console.log("Usage: ts-node kb-cli.ts generate-playbook <jiraId>");
    }
}

main();
