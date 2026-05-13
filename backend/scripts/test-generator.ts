/**
 * Quick smoke test for the fixed JSONToPlaywrightCompiler.
 * Generates a test file and verifies:
 * - No inline helper duplication
 * - No `if (undefined)` broken guard
 * - No 180s default timeout
 * - Proper imports from shared modules
 * - SKIP_AUTO_LOGIN constant generated
 */
import * as path from 'path';
import * as fs from 'fs';
import { compileTestSpec } from '../src/services/JSONToPlaywrightCompiler';

const spec = {
  ticketId: 'SMOKE-TEST',
  feature: 'Designation CRUD Smoke',
  module: 'master-designation',
  scenarios: [{
    id: 'SC-001',
    name: 'Create Designation Happy Path',
    priority: 'high' as const,
    steps: [
      { type: 'goto' as const, url: '/#/master-designation' },
      { type: 'waitForSelector' as const, selector: '.k-grid', state: 'visible' as const },
      { type: 'waitForSelector' as const, selector: '.k-loading-mask', state: 'hidden' as const, timeout: 60000 },
      { type: 'click' as const, element: 'Add New', selectorHint: 'button:has-text("Add New")' },
      { type: 'waitForSelector' as const, selector: 'form', state: 'visible' as const },
      { type: 'fill' as const, field: 'ShortCode', value: 'SMOKE', selectorHint: 'input[formcontrolname="ShortCode"]' },
      { type: 'fill' as const, field: 'Name', value: 'Smoke Test Designation', selectorHint: 'input[formcontrolname="Designation"]' },
      { type: 'click' as const, element: 'Save', selectorHint: 'button:has-text("Save")' },
      { type: 'waitForSelector' as const, selector: '.k-loading-mask', state: 'hidden' as const, timeout: 15000 },
    ],
    assertions: [
      { type: 'assertVisible' as const, selector: '.k-grid', visible: true },
      { type: 'assertText' as const, selector: '.k-grid', expected: 'Smoke Test Designation', contains: true },
    ],
    preconditions: ['User logged in with Master access'],
    tags: ['smoke', 'create-designation'],
  }],
};

console.log('=== Generator Smoke Test ===\n');

const result = compileTestSpec(spec, {
  baseUrl: 'https://test.globalhr.com.mm/ook',
  recordVideo: true,
  recordTrace: true,
  viewport: { width: 1280, height: 720 },
  ticketId: 'SMOKE-TEST',
  credentials: { username: 'testook_HR 1', password: 'Global@2024' },
});

const OUTPUT_PATH = path.join(__dirname, '../tests/generated/SMOKE-TEST.spec.ts');
fs.writeFileSync(OUTPUT_PATH, result, 'utf-8');

const lines = result.split('\n').length;
console.log(`Generated: ${OUTPUT_PATH}`);
console.log(`Total lines: ${lines}`);

const checks = {
  // BUGS — must be false
  'NO inline healedClick':        !/const healedClick = async/.test(result),
  'NO inline waitForAngular':     !/const waitForAngular = async/.test(result),
  'NO inline universalFill':      !/const universalFill = async/.test(result),
  'NO if (undefined)':            !/if \(undefined\)/.test(result),
  'NO 180s default timeout':      !/180000/.test(result),

  // FIXES — must be true
  'Has import healedClick':       /import.*healedClick.*from.*playwright-self-healing/.test(result),
  'Has import universalFill':     /import.*universalFill.*from.*playwright-self-healing/.test(result),
  'Has import waitForAngular':    /import.*waitForAngular.*from.*playwright-self-healing/.test(result),
  'Has SKIP_AUTO_LOGIN':          /const SKIP_AUTO_LOGIN/.test(result),
  'Has 30s timeout':              /30000/.test(result),
  'Has actionTimeout 30s':        /actionTimeout:\s*30000/.test(result),
  'No redundant mask wait':       !/\/\/ Wait for selector: \.k-loading-mask.*waitFor.*hidden/.test(result.replace(/[\n\r]+/g, ' ')),
};

console.log('\nCheck Results:');
let pass = 0;
let fail = 0;
for (const [name, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (ok) pass++; else fail++;
}

console.log(`\n${pass}/${pass + fail} passed`);

if (fail > 0) {
  console.error('\nGenerated file preview (first 60 lines):');
  result.split('\n').slice(0, 60).forEach((l, i) => console.log(`${String(i + 1).padStart(3)}: ${l}`));
  process.exit(1);
}

console.log('\nAll checks passed!');
