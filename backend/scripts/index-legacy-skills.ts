import { Pool } from 'pg';
import { config } from '../api/config';
import { VectorKnowledgeService } from '../src/services/VectorKnowledgeService';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env') });

const SKILLS_DIR = path.join(__dirname, '..', 'skills');

async function indexLegacySkills() {
    console.log('🧠 Indexing Legacy Skills into Vector KB...');
    
    const pool = new Pool({
        user: config.postgres.user,
        host: config.postgres.host,
        database: config.postgres.database,
        password: config.postgres.password,
        port: config.postgres.port,
    });

    try {
        VectorKnowledgeService.setPool(pool);

        const files = fs.readdirSync(SKILLS_DIR);

        for (const file of files) {
            const filePath = path.join(SKILLS_DIR, file);
            const stats = fs.statSync(filePath);

            if (stats.isDirectory()) continue;
            if (file.endsWith('.bak')) continue;

            console.log(`Indexing ${file}...`);
            const content = fs.readFileSync(filePath, 'utf8');

            if (file.endsWith('.json')) {
                // For JSON, we index the whole block if small, or key-values
                await VectorKnowledgeService.addKnowledge(content, 'legacy_skill_json', { file });
            } else if (file.endsWith('.md')) {
                // For Markdown, chunk by headers
                const sections = content.split(/\n#+/);
                for (let i = 0; i < sections.length; i++) {
                    if (sections[i].trim().length < 20) continue;
                    await VectorKnowledgeService.addKnowledge(sections[i].trim(), 'legacy_skill_md', { 
                        file,
                        sectionIndex: i
                    });
                }
            }
            console.log(`  ✓ Done.`);
        }

        console.log('\n✨ All legacy skills are now searchable via Vector RAG!');

    } catch (err: any) {
        console.error('❌ Indexing failed:', err.message);
    } finally {
        await pool.end();
    }
}

indexLegacySkills();
