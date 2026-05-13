/**
 * Compile session test cases from ATT-15 to Playwright scripts
 */

import * as fs from 'fs';
import * as path from 'path';
import { compileTestSpec } from '../src/services/JSONToPlaywrightCompiler';
import { TestSpecification } from '../src/services/TestSpecSchema';

const TICKET = process.env.TICKET || 'ATT-15';
const OUTPUT_DIR = path.join(__dirname, '..', 'test-results', TICKET);

// Test cases from the current session (exported via API)
const testCasesJson = fs.readFileSync(
    path.join(__dirname, '..', 'test-results', 'att15-testcases.json'),
    'utf-8'
);

const testCases = JSON.parse(testCasesJson);

if (!testCases || testCases.length === 0) {
    console.error('No test cases found. Ensure test cases are generated for ATT-15 first.');
    process.exit(1);
}

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const spec: TestSpecification = {
    ticketId: TICKET,
    feature: 'ATT-15 Journal Entry',
    module: 'journal-entry',
    scenarios: testCases.map((tc: any) => {
        // Extract steps as action steps
        const steps = tc.steps.map((s: any, i: number) => {
            const action = s.action.toLowerCase();
            const selector = s.selectorHint || '';

            if (action.includes('navigate') || action.includes('go to') || action.includes('open')) {
                return { type: 'goto', url: '/#/app.performancejournal', description: s.action, waitUntil: 'domcontentloaded' };
            }
            if (action.includes('wait') && action.includes('grid')) {
                return { type: 'waitForSelector', selector: '.k-grid, [role="grid"]', state: 'visible', timeout: 15000 };
            }
            if (action.includes('wait') && action.includes('form')) {
                return { type: 'waitForSelector', selector: 'form', state: 'visible', timeout: 15000 };
            }
            if (action.includes('wait') && action.includes('dropdown')) {
                return { type: 'waitForSelector', selector: '.k-animation-container, .k-list-container', state: 'visible', timeout: 15000 };
            }
            if (action.includes('wait') && action.includes('loading')) {
                return { type: 'waitForSelector', selector: '.k-loading-mask', state: 'hidden', timeout: 15000 };
            }
            if (action.includes('wait') && action.includes('filter')) {
                return { type: 'waitForSelector', selector: '.k-animation-container', state: 'visible', timeout: 15000 };
            }
            if (action.includes('wait')) {
                return { type: 'waitForSelector', selector: '.k-grid', state: 'visible', timeout: 15000 };
            }
            if (action.includes('click') && action.includes('dropdown')) {
                return { type: 'click', element: 'Category', selectorHint: 'input[role="combobox"]:visible' };
            }
            if (action.includes('click') && action.includes('add')) {
                return { type: 'click', element: 'Add New', selectorHint: 'button:has-text("Add")' };
            }
            if (action.includes('click') && action.includes('save')) {
                return { type: 'click', element: 'Save', selectorHint: 'button:has-text("Save")' };
            }
            if (action.includes('click') && action.includes('dropdown')) {
                return { type: 'click', element: 'Year filter', selectorHint: '[aria-label*="year"]' };
            }
            if (action.includes('select') && action.includes('category')) {
                return { type: 'selectOption', field: 'Category', value: 'Incident' };
            }
            if (action.includes('select') && action.includes('year')) {
                return { type: 'selectOption', field: 'Year filter', value: '2025' };
            }
            if (action.includes('click') && action.includes('file') || action.includes('upload') || action.includes('attach')) {
                return { type: 'uploadFile', field: 'Attachment', filePath: 'test-results/sample-attachment.png' };
            }
            if (action.includes('fill') || action.includes('input') || action.includes('enter') || action.includes('type')) {
                return { type: 'fill', field: 'field', value: s.testData || 'test data', selectorHint: selector || '' };
            }
            if (action.includes('assertvisible')) {
                return { type: 'assertVisible', selector: selector || '.k-grid' };
            }
            if (action.includes('asserttext')) {
                return { type: 'assertVisible', selector: selector || '.k-grid' };
            }
            return { type: 'waitForSelector', selector: '.k-grid', state: 'visible', timeout: 10000 };
        });

        return {
            id: tc.caseId,
            name: tc.title,
            priority: tc.priority.toLowerCase() as 'high' | 'medium' | 'low',
            steps: steps,
            assertions: [],
        };
    }),
};

// Clean hash from base URL
const baseUrl = (process.env.BASE_URL || 'https://test.globalhr.com.mm/ook').replace(/#.*$/, '');

const compilerOptions = {
    baseUrl,
    ticketId: TICKET,
    recordVideo: true,
    recordTrace: true,
    viewport: { width: 1280, height: 720 },
    credentials: {
        username: process.env.TEST_USERNAME || '',
        password: process.env.TEST_PASSWORD || '',
        idNumber: process.env.TEST_IDNUMBER || ''
    },
    isLoginTest: false,
    timeout: 300000
};

const testCode = compileTestSpec(spec, compilerOptions);
const outputPath = path.join(OUTPUT_DIR, `${TICKET}.spec.ts`);
fs.writeFileSync(outputPath, testCode, 'utf-8');

console.log(`\nCompiled ${testCases.length} test cases to: ${outputPath}`);
console.log(`Total steps: ${testCases.reduce((sum: number, tc: any) => sum + (tc.steps?.length || 0), 0)}`);
