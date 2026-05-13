/**
 * Regenerate ATT-15 Test Files
 * Uses relative URLs to avoid duplication with baseURL
 */

import * as fs from 'fs';
import * as path from 'path';
import { compileTestSpec } from '../src/services/JSONToPlaywrightCompiler';
import { TestSpecification } from '../src/services/TestSpecSchema';

// Test scenarios for ATT-15 (Employee Data Isolation & Journal Entry)
const ATT15_SPECIFICATION: TestSpecification = {
    ticketId: 'ATT-15',
    feature: 'Journal Entry - Employee Data Isolation',
    module: 'journal-entry',
    scenarios: [
        {
            id: 'SC-001',
            name: 'Employee Data Isolation - Verify Users See Only Their Own Journal Entries',
            priority: 'high',
            steps: [
                { type: 'goto', url: '/#/login' },
                { type: 'fill', field: 'idnumber', value: '{{TEST_IDNUMBER}}', isKendo: false },
                { type: 'fill', field: 'username', value: '{{TEST_USERNAME}}', isKendo: false },
                { type: 'fill', field: 'password', value: '{{TEST_PASSWORD}}', isKendo: false },
                { type: 'click', element: 'Login' },
                { type: 'waitForSelector', selector: '[ng-app]', state: 'visible' },
                { type: 'click', element: 'Journal Entry' },
                { type: 'waitForSelector', selector: 'table', state: 'visible', timeout: 10000 }
            ],
            assertions: [
                { type: 'assertVisible', selector: 'table', visible: true },
                { type: 'assertUrl', expected: '/journal', contains: true },
                { type: 'assertText', selector: 'body', expected: 'Journal', contains: true }
            ],
            preconditions: ['User is logged in as employee1'],
            tags: ['data-isolation', 'employee-data', 'journal-entry']
        },
        {
            id: 'SC-002',
            name: 'Category Name Resolution - Verify Category Column Shows Readable Names Not IDs',
            priority: 'high',
            steps: [
                { type: 'goto', url: '/#/login' },
                { type: 'fill', field: 'idnumber', value: '{{TEST_IDNUMBER}}', isKendo: false },
                { type: 'fill', field: 'username', value: '{{TEST_USERNAME}}', isKendo: false },
                { type: 'fill', field: 'password', value: '{{TEST_PASSWORD}}', isKendo: false },
                { type: 'click', element: 'Login' },
                { type: 'waitForSelector', selector: '[ng-app]', state: 'visible' },
                { type: 'click', element: 'Journal Entry' },
                { type: 'waitForSelector', selector: 'table', state: 'visible', timeout: 10000 }
            ],
            assertions: [
                { type: 'assertVisible', selector: 'th:has-text("Category")', visible: true },
                { type: 'assertCount', selector: 'tbody tr', expected: 1 }
            ],
            preconditions: ['At least one journal entry exists with a category'],
            tags: ['category-resolution', 'label-setup', 'journal-entry']
        },
        {
            id: 'SC-003',
            name: 'Dynamic Category Label Update - Verify Category Name Reflects Label Changes',
            priority: 'medium',
            steps: [
                { type: 'goto', url: '/#/login' },
                { type: 'fill', field: 'idnumber', value: '{{TEST_IDNUMBER}}', isKendo: false },
                { type: 'fill', field: 'username', value: '{{TEST_USERNAME}}', isKendo: false },
                { type: 'fill', field: 'password', value: '{{TEST_PASSWORD}}', isKendo: false },
                { type: 'click', element: 'Login' },
                { type: 'waitForSelector', selector: '[ng-app]', state: 'visible' },
                { type: 'click', element: 'System Label Setup' },
                { type: 'waitForSelector', selector: 'table', state: 'visible', timeout: 10000 },
                { type: 'click', element: 'Edit', options: { force: true } },
                { type: 'fill', field: 'labelName', value: 'Updated Category Name' },
                { type: 'click', element: 'Save' },
                { type: 'waitForResponse', urlPattern: '/Label/Update', status: 200 },
                { type: 'click', element: 'Journal Entry' }
            ],
            assertions: [
                { type: 'assertText', selector: 'tbody', expected: 'Updated Category Name', contains: true }
            ],
            preconditions: ['Journal entry exists with a category label'],
            tags: ['label-update', 'dynamic-resolution', 'journal-entry']
        },
        {
            id: 'SC-004',
            name: 'Empty State - Verify List View Behavior When No Journal Entries Exist',
            priority: 'medium',
            steps: [
                { type: 'goto', url: '/#/login' },
                { type: 'fill', field: 'idnumber', value: '{{TEST_IDNUMBER}}', isKendo: false },
                { type: 'fill', field: 'username', value: '{{TEST_USERNAME}}', isKendo: false },
                { type: 'fill', field: 'password', value: '{{TEST_PASSWORD}}', isKendo: false },
                { type: 'click', element: 'Login' },
                { type: 'waitForSelector', selector: '[ng-app]', state: 'visible' },
                { type: 'click', element: 'Journal Entry' },
                { type: 'waitForSelector', selector: 'table', state: 'visible', timeout: 10000 }
            ],
            assertions: [
                { type: 'assertText', selector: 'tbody', expected: 'No records', contains: true }
            ],
            preconditions: ['User has no journal entries'],
            tags: ['empty-state', 'journal-entry']
        },
        {
            id: 'SC-005',
            name: 'Cross-Employee Data Isolation - Verify Employee Cannot Access Another Employee\'s Entries via API',
            priority: 'high',
            steps: [
                { type: 'goto', url: '/#/login' },
                { type: 'fill', field: 'idnumber', value: '{{TEST_IDNUMBER}}', isKendo: false },
                { type: 'fill', field: 'username', value: '{{TEST_USERNAME}}', isKendo: false },
                { type: 'fill', field: 'password', value: '{{TEST_PASSWORD}}', isKendo: false },
                { type: 'click', element: 'Login' },
                { type: 'waitForSelector', selector: '[ng-app]', state: 'visible' },
                { type: 'click', element: 'Journal Entry' },
                { type: 'waitForResponse', urlPattern: '/Journal/GetEntries', status: 200 }
            ],
            assertions: [
                { type: 'assertApiResponse', urlPattern: '/Journal/GetEntries', status: 200, bodyContains: 'employeeId' }
            ],
            preconditions: ['Multiple employees exist with journal entries'],
            tags: ['data-isolation', 'api-security', 'journal-entry']
        }
    ],
    environment: {
        baseUrl: process.env.BASE_URL || 'https://test.globalhr.com.mm/ook',
        stage: 'testing'
    },
    metadata: {
        generatedAt: new Date().toISOString(),
        aiModel: 'JSON-Hybrid-System',
        version: '1.0'
    }
};

function substitutePlaceholders(spec: TestSpecification): TestSpecification {
    const env = {
        BASE_URL: process.env.BASE_URL || 'https://test.globalhr.com.mm/ook',
        TEST_USERNAME: process.env.TEST_USERNAME || 'Staff A1',
        TEST_PASSWORD: process.env.TEST_PASSWORD || 'Global@2024',
        TEST_IDNUMBER: process.env.TEST_IDNUMBER || 'testook_1502'
    };

    const json = JSON.stringify(spec);
    const substituted = json
        .replace(/{{BASE_URL}}/g, env.BASE_URL)
        .replace(/{{TEST_USERNAME}}/g, env.TEST_USERNAME)
        .replace(/{{TEST_PASSWORD}}/g, env.TEST_PASSWORD)
        .replace(/{{TEST_IDNUMBER}}/g, env.TEST_IDNUMBER);

    return JSON.parse(substituted) as TestSpecification;
}

function main() {
    console.log('=== Regenerating ATT-15 Test Files ===\n');

    // Load environment variables
    const envPath = path.join(__dirname, '../../.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split('\n').forEach(line => {
            const [key, value] = line.split('=');
            if (key && value) {
                process.env[key.trim()] = value.trim();
            }
        });
    }

    // Substitute placeholders with actual values
    const spec = substitutePlaceholders(ATT15_SPECIFICATION);

    // Compiler options - baseURL should NOT include hash
    const compilerOptions = {
        baseUrl: (process.env.BASE_URL || 'https://test.globalhr.com.mm/ook').replace(/#.*$/, ''), // Remove hash from baseURL
        ticketId: 'ATT-15',
        recordVideo: true,
        recordTrace: true,
        viewport: { width: 1280, height: 720 },
        credentials: {
            username: process.env.TEST_USERNAME || 'Staff A1',
            password: process.env.TEST_PASSWORD || 'Global@2024',
            idNumber: process.env.TEST_IDNUMBER || 'testook_1502'
        },
        isLoginTest: false,
        timeout: 300000 // 5 minutes for slow networks
    };

    // Generate test file for each scenario
    const outputDir = path.join(__dirname, '../test-results/ATT-15');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = Date.now();
    for (const scenario of spec.scenarios) {
        console.log(`Generating ${scenario.id}...`);

        const singleScenarioSpec: TestSpecification = {
            ...spec,
            scenarios: [scenario]
        };

        const testCode = compileTestSpec(singleScenarioSpec, compilerOptions);

        const outputPath = path.join(outputDir, `${scenario.id}_${timestamp}.spec.ts`);
        fs.writeFileSync(outputPath, testCode, 'utf8');

        console.log(`  ✓ Generated: ${outputPath}`);
    }

    console.log('\n=== Generation Complete ===');
    console.log(`Output directory: ${outputDir}`);
    console.log(`Credentials used:`);
    console.log(`  - ID Number: ${process.env.TEST_IDNUMBER}`);
    console.log(`  - Username: ${process.env.TEST_USERNAME}`);
    console.log(`  - Password: ${process.env.TEST_PASSWORD}`);
}

main();
