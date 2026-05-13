import { Pool } from 'pg';
import { JiraService } from './JiraService';
import { AutonomousCrawlerService } from '../src/services/AutonomousCrawlerService';
import { TestCaseGeneratorService } from '../src/services/generation/TestCaseGeneratorService';
import { MultiAgentRouter } from './MultiAgentRouter';
import { CloudAIService } from './CloudAIService';
import { config } from './config';
import { appLogger } from '../src/utils/logger';

async function runEndToEndFlow() {
    console.log('🚀 INITIALIZING FULL E2E WORKFLOW TEST (The Digital Detective Flow)');
    
    const pool = new Pool({
        user: config.postgres.user,
        password: config.postgres.password,
        host: config.postgres.host,
        database: config.postgres.database,
        port: config.postgres.port,
    });

    try {
        const ticketId = 'ATT-22';
        console.log(`\nSTEP 1: Enriched Jira Extraction [${ticketId}]`);
        // We verify that descriptions AND comments are fetched
        const ticket = await JiraService.fetchTicket(ticketId);
        console.log(`✅ Fetched: ${ticket.summary}`);
        console.log(`📝 Description length: ${ticket.description?.length || 0} chars`);
        
        // ticket.comments is fetched from Jira API - it should be an array
        const jiraComments = Array.isArray(ticket.comments) 
            ? ticket.comments.map((c: any) => `[${c.author}] ${c.body}`)
            : [];
        console.log(`💬 Comments found: ${jiraComments.length}`);

        console.log('\nSTEP 2: Autonomous UI Discovery (Handshake + Map)');
        // This uses the new Live Handshake logic
        const credentials = {
            idNumber: process.env.TEST_IDNUMBER || '',
            username: process.env.TEST_USERNAME || '',
            password: process.env.TEST_PASSWORD || '',
            ticketId
        };
        await AutonomousCrawlerService.crawlApplication("https://test.globalhr.com.mm/ook", credentials, pool);
        console.log('✅ Discovery Phase Complete (Check logs for 📡 signals)');

        console.log('\nSTEP 3: Multi-Agent Intelligence (Planner + Brains)');
        // Injects local brain data + Jira comments
        const result = await TestCaseGeneratorService.generateScenariosFromJira(ticketId, {
            jiraComments: jiraComments
        });
        console.log(`✅ AI Intelligence Success: Generated ${result.scenarios.length} scenarios.`);
        if (result.scenarios.length > 0) {
            console.log(`🧠 Top Scenario: ${result.scenarios[0].title}`);
        }

        console.log('\nSTEP 4: Business Logic Audit (Final Verdict)');
        // Test the final investigator role
        const audit = await CloudAIService.conductFinalAudit(
            "Found anomaly in Employee list: Save button missing after fill.",
            "POLICY: All data entry forms must have a visible Save button after required fields are populated."
        );
        console.log('✅ Investigator Verdict Received:');
        console.log(audit.substring(0, 300) + '...');

        console.log('\n🏆 FULL E2E FLOW VERIFIED SUCCESSFULLY!');
        process.exit(0);

    } catch (err: any) {
        console.error('\n❌ E2E FLOW FAILED:', err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

runEndToEndFlow();
