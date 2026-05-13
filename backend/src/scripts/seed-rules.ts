import * as dotenv from 'dotenv';
import * as path from 'path';

// Fix: Load .env from root before importing config
dotenv.config({ path: path.join(__dirname, '../../../.env') });

import { RulesRepository, Rule } from '../services/RulesRepository';
import { TelemetryService } from '../services/shared/TelemetryService';
import { Client } from 'pg';
import { MigrationManager } from '../services/shared/MigrationManager';
import { config } from '../../api/config';

const pool = new Client({
    user: config.postgres.user,
    host: config.postgres.host,
    database: config.postgres.database,
    password: process.env.PG_PASSWORD || 'postgres',
    port: config.postgres.port,
});

async function seed() {
    await pool.connect();
    console.log('[Seed] Connected to database');

    // Run migrations to ensure 'rules' table exists
    await MigrationManager.run(pool as any);

    // Initialize TelemetryService with our pool for RulesRepository to use
    TelemetryService.initialize(pool as any);

    const initialRules: Rule[] = [
        {
            module_name: 'Department',
            description: 'Organizational departments and hierarchy.',
            keywords: ['Department', 'Dept', 'Division', 'Dept.'],
            mandatory_fields: [
                { name: 'ShortCode', label: 'Short Code', type: 'text', required: true, validation: 'max:5' },
                { name: 'Name', label: 'Name', type: 'text', required: true },
                { name: 'Company', label: 'Company', type: 'select', required: true }
            ],
            navigation_id: 'Master > Department'
        },
        {
            module_name: 'Grade',
            description: 'Employee salary and seniority levels.',
            keywords: ['Grade', 'Level', 'Salary Grade'],
            mandatory_fields: [
                { name: 'GradeName', label: 'Name', type: 'text', required: true },
                { name: 'OrderIndex', label: 'Order', type: 'number', required: false }
            ],
            navigation_id: 'Master > Grade'
        },
        {
            module_name: 'Designation',
            description: 'Job titles and role definitions.',
            keywords: ['Designation', 'Position', 'Job Title', 'Role'],
            mandatory_fields: [
                { name: 'ShortCode', label: 'Short Code', type: 'text', required: true, validation: 'max:5' },
                { name: 'DesignationName', label: 'Name', type: 'text', required: true },
                { name: 'Grade', label: 'Grade', type: 'select', required: true }
            ],
            navigation_id: 'Master > Designation'
        }
    ];

    for (const rule of initialRules) {
        console.log(`[Seed] Seeding rule for: ${rule.module_name}`);
        await RulesRepository.saveRule(rule);
    }

    console.log('[Seed] Rules seeding completed successfully');
    await pool.end();
}

seed().catch(err => {
    console.error('[Seed] Failed:', err);
    process.exit(1);
});
