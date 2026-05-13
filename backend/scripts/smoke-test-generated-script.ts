/**
 * Smoke test: Verify that generatePlaywrightScript produces valid, compilable TypeScript
 */

import { TestExecutionService, TestEnvironment } from '../src/services/TestExecutionService';
import { TestCase } from '../src/services/TestCaseGeneratorService';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const sampleTestCase: TestCase = {
    caseId: 'SMOKE-001',
    title: 'Create Designation with Valid Data',
    description: 'Verify a new designation can be created',
    priority: 'High',
    preconditions: ['User is logged in as admin'],
    tags: ['smoke', 'designation'],
    steps: [
        {
            stepNumber: 1,
            action: 'Navigate to Master > Designation',
            expectedResult: 'Designation page loads with grid visible'
        },
        {
            stepNumber: 2,
            action: 'Click "Add New" button',
            selectorHint: 'button:has-text("Add New"), .btn.btn-primary:has-text("Add")',
            expectedResult: 'Create form modal opens'
        },
        {
            stepNumber: 3,
            action: 'Fill Short Code field with "TEST01"',
            selectorHint: 'input[formcontrolname="ShortCode"], input[name="Short Code"]',
            testData: 'TEST01',
            expectedResult: 'Field displays TEST01'
        },
        {
            stepNumber: 4,
            action: 'Fill Name field with "Test Designation"',
            selectorHint: 'input[formcontrolname="Designation"], input[name="Designation"]',
            testData: 'Test Designation',
            expectedResult: 'Field displays Test Designation'
        },
        {
            stepNumber: 5,
            action: 'Click Save button',
            selectorHint: 'button:has-text("Save"), .btn.btn-success:has-text("Save")',
            expectedResult: 'Success toast appears'
        },
        {
            stepNumber: 6,
            action: 'Click Ok on success dialog',
            selectorHint: 'button:has-text("Ok"), button:has-text("OK")',
            expectedResult: 'Modal closes, designation appears in grid'
        }
    ],
    expectedOutcome: 'Designation created and visible in grid',
    isEditable: true,
    isMain: true
};

const env: TestEnvironment = {
    stage: 'testing',
    baseUrl: 'https://test.globalhr.com.mm/ook',
    fullUrl: 'https://test.globalhr.com.mm/ook',
    username: 'testook_HR 1',
    password: 'Global@2024',
    idNumber: 'testook_HR 1',
    customerId: 'ook',
    browser: 'chromium',
    headless: true,
    timeout: 300000,
    autoHeal: true,
    platform: 'LOCAL'
};

async function main() {
    console.log('🔬 Smoke Test: Generated Script Validation\n');

    // Generate script
    const scriptContent = TestExecutionService.generatePlaywrightScript(
        sampleTestCase,
        env,
        'SMOKE-001'
    );

    // Write to temp file
    const tempPath = path.join(process.cwd(), 'test-results', 'SMOKE-001_smoke.spec.ts');
    fs.mkdirSync(path.dirname(tempPath), { recursive: true });
    fs.writeFileSync(tempPath, scriptContent, 'utf8');
    console.log(`📄 Generated script: ${tempPath}`);
    console.log(`📏 Size: ${scriptContent.length} chars, ${scriptContent.split('\n').length} lines\n`);

    // Compile check
    console.log('⚙️  TypeScript compilation check...');
    const diagnostics = ts.getPreEmitDiagnostics(
        ts.createProgram([tempPath], {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.CommonJS,
            moduleResolution: ts.ModuleResolutionKind.NodeJs,
            esModuleInterop: true,
            strict: false,
            skipLibCheck: true,
            noEmit: true
        })
    );

    if (diagnostics.length === 0) {
        console.log('✅ Generated script compiles as valid TypeScript\n');
    } else {
        console.log(`⚠️  ${diagnostics.length} TypeScript warning(s):\n`);
        for (const d of diagnostics) {
            if (d.file) {
                const { line } = d.file.getLineAndCharacterOfPosition(d.start!);
                const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
                console.log(`  Line ${line + 1}: ${message}`);
            } else {
                console.log(`  ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
            }
        }
    }

    // Show first 30 lines
    const lines = scriptContent.split('\n');
    console.log('\n📋 Script preview (first 30 lines):');
    console.log('─'.repeat(60));
    for (let i = 0; i < Math.min(30, lines.length); i++) {
        console.log(`${String(i + 1).padStart(3)} │ ${lines[i]}`);
    }
    console.log('─'.repeat(60));
    console.log(`\n📊 Total: ${lines.length} lines`);

    // Count actual Playwright commands
    const pwCommands = [
        ...scriptContent.matchAll(/await (healedClick|universalFill|page\.locator|page\.goto|page\.fill|waitForAngularStable|loginAndNavigate|waitFor)\(/g)
    ].length;
    console.log(`🎯 Playwright commands: ${pwCommands}`);
}

main().catch(console.error);
