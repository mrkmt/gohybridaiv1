/**
 * Direct document training script.
 * Usage: ts-node scripts/train-doc.ts <path-to-docx>
 */
import * as path from 'path';

// Set env to use cloud parser
process.env.USE_CLOUD_PARSER = 'true';

// Load dotenv
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

import { DocumentParserService } from '../../src/skills/DocumentParserService';

const docxPath = process.argv[2];

if (!docxPath) {
    console.error('Usage: ts-node api/scripts/train-doc.ts <path-to-docx>');
    process.exit(1);
}

(async () => {
    try {
        console.log(`\n========================================`);
        console.log(` Go-Hybrid AI - Knowledge Base Trainer`);
        console.log(`========================================`);
        console.log(`\nSource file: ${docxPath}`);
        console.log(`Using Gemini CLI: ${process.env.USE_CLOUD_PARSER === 'true' ? 'YES' : 'NO'}\n`);

        const parser = new DocumentParserService();
        await parser.extractBusinessRules(docxPath);

        console.log('\n✅ Training complete! Check business-logic-matrix.json and staging-matrix.json.');
    } catch (err: any) {
        console.error('\n❌ Training failed:', err.message);
        process.exit(1);
    }
})();
