import { Phase3PlaywrightGenerationService, Phase3GenerateRequest } from '../../api/Phase3PlaywrightGenerationService';
import { TelemetryService } from '../services/shared/TelemetryService';
import { Client } from 'pg';
import { config } from '../../api/config';
import { appLogger } from '../utils/logger';

async function testResolver() {
    const pool = new Client({
        user: config.postgres.user,
        host: config.postgres.host,
        database: config.postgres.database,
        password: process.env.PG_PASSWORD || 'postgres',
        port: config.postgres.port,
    });

    await pool.connect();
    TelemetryService.initialize(pool as any);

    const testRequest: Phase3GenerateRequest = {
        jiraId: 'ATT-DES-01',
        planSteps: [
            'Given I login to the system',
            'When I navigate to Master > Designation',
            'And I click Add New',
            'Then I should see the form'
        ],
        targetEnv: 'testing',
        baseUrl: 'http://test.com',
        customerId: 'ook',
        testIdNumber: '123',
        testUsername: 'admin',
        testPassword: 'pw'
    };

    console.log('--- Original Plan ---');
    console.log(testRequest.planSteps.join('\n'));

    // We need to access the private method for testing, or rely on generateAndSave logging
    // For this test, I'll temporarily make it public or use (Service as any)
    const result = await (Phase3PlaywrightGenerationService as any).enrichPlanWithRules(testRequest);

    console.log('\n--- Enriched Plan ---');
    console.log(result.enrichedSteps.join('\n'));

    if (result.rule) {
        console.log(`\n✅ Matched Rule: ${result.rule.module_name}`);
    }

    await pool.end();
}

testResolver().catch(console.error);
