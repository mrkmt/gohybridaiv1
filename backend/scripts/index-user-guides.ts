import { Pool } from 'pg';
import { config } from '../api/config';
import { VectorKnowledgeService } from '../src/services/VectorKnowledgeService';
import * as mammoth from 'mammoth';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env') });

/**
 * GUIDE CONFIGURATION
 * Portable and categorized per platform/scope.
 */
const USER_GUIDE_DIR = process.env.USER_GUIDE_PATH || path.join(process.cwd(), '..', 'docs', 'user_guides');

const GUIDES_TO_INDEX = [
    { 
        filename: "Global HR Cloud Training User Guide(v2.0.0_logo update_Recruitmentadded).docx", 
        platform: "web", 
        scope: "general" 
    },
    { 
        filename: "All Leave User Guide.docx", 
        platform: "web", 
        scope: "leave_management" 
    },
    { 
        filename: "GlobalHRCloud-Mobile Approver Level Guide Update - V5(logo&color).docx", 
        platform: "mobile", 
        scope: "approvals" 
    }
];

async function indexGuides() {
    console.log('📚 Starting Platform-Aware Knowledge Indexing...');
    
    const pool = new Pool({
        user: config.postgres.user,
        host: config.postgres.host,
        database: config.postgres.database,
        password: config.postgres.password,
        port: config.postgres.port,
    });

    try {
        VectorKnowledgeService.setPool(pool);

        for (const guide of GUIDES_TO_INDEX) {
            const filePath = path.join(USER_GUIDE_DIR, guide.filename);
            
            if (!fs.existsSync(filePath)) {
                console.warn(`⚠️ Skip: File not found: ${guide.filename} in ${USER_GUIDE_DIR}`);
                continue;
            }

            console.log(`Processing [${guide.platform.toUpperCase()}] ${guide.filename}...`);
            
            const result = await mammoth.extractRawText({ path: filePath });
            const fullText = result.value;
            
            // Chunking logic
            const chunks = fullText.split(/\n\n+/).filter(c => c.trim().length > 50);
            
            console.log(`  Found ${chunks.length} chunks. Indexing with metadata...`);

            for (let i = 0; i < chunks.length; i++) {
                const content = chunks[i].trim();
                await VectorKnowledgeService.addKnowledge(content, 'business_rule', {
                    source: guide.filename,
                    platform: guide.platform,
                    scope: guide.scope,
                    chunkIndex: i,
                    indexedAt: new Date().toISOString()
                });
                
                if (i % 20 === 0) process.stdout.write('.');
            }
            console.log(`\n  ✓ Successfully indexed ${guide.platform} knowledge.`);
        }

        console.log('\n✨ Platform-Aware RAG is now active! The AI can now distinguish between Web and Mobile rules.');

    } catch (err: any) {
        console.error('❌ Indexing failed:', err.message);
    } finally {
        await pool.end();
    }
}

indexGuides();
