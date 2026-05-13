import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { CliAgentService } from '../CliAgentService';
import { config } from '../config';

async function trainJiraCsv() {
    const csvPath = path.join(process.cwd(), '..', 'Train Data', 'Jira Functional_UI.csv');
    const matrixPath = path.join(process.cwd(), 'business-logic-matrix.json');
    const stagingPath = path.join(process.cwd(), 'staging-matrix.json');

    console.log(`[Jira Trainer] Reading CSV from: ${csvPath}`);

    if (!fs.existsSync(csvPath)) {
        console.error('CSV file not found!');
        return;
    }

    const fileContent = fs.readFileSync(csvPath, 'utf8');
    const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true
    }) as any[];

    console.log(`[Jira Trainer] Found ${records.length} records. Selecting top relevant issues...`);

    // Filter for records with descriptive Test Cases or Comments
    const candidates = records.filter((r: any) =>
        (r['Custom field (Test Case)'] && r['Custom field (Test Case)'].length > 100) ||
        (r['Summary'] && r['Summary'].toLowerCase().includes('policy'))
    ).slice(0, 15); // Process in manageable batches

    console.log(`[Jira Trainer] Processing ${candidates.length} high-value candidates...`);

    for (let i = 0; i < candidates.length; i++) {
        const record = candidates[i];
        console.log(`[Jira Trainer] [${i + 1}/${candidates.length}] Extracting rules from: ${record.Summary}`);

        const prompt = `
        You are a Quality Assurance Specialist. Extract functional business rules from this Jira issue data.
        
        ### JIRA DATA:
        Summary: ${record.Summary}
        Test Case: ${record['Custom field (Test Case)']}
        
        ### OUTPUT FORMAT (JSON Array):
        [{
            "id": "JIRA-EXTRACT-${Date.now()}-${i}",
            "Module": "Module Name (e.g. Payroll, OT, Leave)",
            "SubModule": "Sub-Module Name",
            "FormulaRule": "Clear 'IF-THEN' or formulaic rule",
            "ExpectedUIBehavior": "Description of what happens in the UI",
            "Keywords": ["keyword1", "keyword2"],
            "confidenceScore": 0.95
        }]
        
        Return ONLY the JSON array.
        `;

        try {
            const response = await CliAgentService.generateFromCli(prompt, 'gemini');
            const cleanJson = response.replace(/```json|```/g, '').trim();
            const newRules = JSON.parse(cleanJson);

            if (Array.isArray(newRules)) {
                // Save to staging or matrix based on confidence
                const highConf = newRules.filter((r: any) => r.confidenceScore >= 0.9);
                const lowConf = newRules.filter((r: any) => r.confidenceScore < 0.9);

                if (highConf.length > 0) {
                    const current = JSON.parse(fs.readFileSync(matrixPath, 'utf8') || '[]');
                    fs.writeFileSync(matrixPath, JSON.stringify([...current, ...highConf], null, 2));
                }

                if (lowConf.length > 0) {
                    const current = JSON.parse(fs.readFileSync(stagingPath, 'utf8') || '[]');
                    fs.writeFileSync(stagingPath, JSON.stringify([...current, ...lowConf], null, 2));
                }

                console.log(`[Jira Trainer] Successfully extracted ${newRules.length} rules.`);
            }
        } catch (err: any) {
            console.error(`[Jira Trainer] Failed to process record ${i}:`, err.message);
        }
    }

    console.log('[Jira Trainer] Training Complete.');
}

trainJiraCsv().catch(console.error);
