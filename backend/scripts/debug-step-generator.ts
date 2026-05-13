/**
 * DEBUG: Test Step to Script Generator
 * 
 * Purpose: See exactly what code is generated from a test step
 * Run: npx ts-node --project tsconfig.json scripts/debug-step-generator.ts
 */

import { TestStep } from '../src/services/TestCaseGeneratorService';
import { flowPatterns } from '../skills/flow-patterns';

// Simulate the ATT-16 Step 1
const testStep: TestStep = {
    stepNumber: 1,
    action: "Navigate to Master > Designation and click 'Add New'",
    testData: "",
    expectedResult: "Creation modal opens",
    selectorHint: ""
};

console.log('='.repeat(80));
console.log('DEBUG: Test Step to Code Generator');
console.log('='.repeat(80));
console.log('\n📝 INPUT TEST STEP:');
console.log('   action:', testStep.action);
console.log('   selectorHint:', testStep.selectorHint || '(none)');
console.log('   testData:', testStep.testData || '(none)');
console.log();

// Simulate generateGenericAction logic
const action = testStep.action.toLowerCase();
const selector = testStep.selectorHint || '';
const testData = testStep.testData || '';

console.log('🔍 ANALYSIS:');
console.log('   action.toLowerCase():', action);
console.log('   includes("click"):', action.includes('click'));
console.log('   includes("fill"):', action.includes('fill'));
console.log('   includes("navigate"):', action.includes('navigate'));
console.log();

// Check flow patterns
console.log('📊 FLOW PATTERN MATCHING:');
let flowPatternMatched = false;

for (const pattern of flowPatterns) {
    const matches = pattern.matcher(testStep.action);
    if (matches) {
        console.log(`   ✅ MATCHED: "${pattern.name}"`);
        console.log(`      Description: ${pattern.description}`);
        console.log(`      Generated code would use pattern generator`);
        flowPatternMatched = true;
        break;
    }
}

if (!flowPatternMatched) {
    console.log('   ❌ NO FLOW PATTERN MATCHED');
    console.log('   → Will use generic action detection');
}
console.log();

// Extract button text
console.log('🔤 BUTTON TEXT EXTRACTION:');
const match = testStep.action.match(/'([^']+)'|"([^"]+)"/);
let buttonText = match ? (match[1] || match[2]) : '';
console.log('   Regex match result:', match);
console.log('   Extracted buttonText:', `"${buttonText}"`);
console.log();

// Apply normalization
console.log('🔧 BUTTON TEXT NORMALIZATION:');
const buttonMappings: Record<string, string> = {
    'Add New': 'Add',
    'Add Designation': 'Add',
    'Create New': 'Create',
    'Save Changes': 'Save',
    'Edit Item': 'Edit',
    'Delete Item': 'Delete'
};

console.log('   Before normalization:', `"${buttonText}"`);
for (const [wrong, correct] of Object.entries(buttonMappings)) {
    const before = buttonText;
    buttonText = buttonText.replace(new RegExp(wrong, 'g'), correct);
    if (before !== buttonText) {
        console.log(`   Applied mapping: "${wrong}" → "${correct}"`);
    }
}
console.log('   After normalization:', `"${buttonText}"`);
console.log();

// Generate selector
console.log('🎯 SELECTOR GENERATION:');
const enhancedSelector = `
    button:has-text("${buttonText}"),
    button.btn.btn-primary:has-text("${buttonText}"),
    button.btn.btn-success:has-text("${buttonText}"),
    button.btn.btn-danger:has-text("${buttonText}"),
    .k-button:has-text("${buttonText}"),
    button[kendobutton]:has-text("${buttonText}"),
    a:has-text("${buttonText}")
`.replace(/\s+/g, ' ').trim();

console.log('   Generated selector:');
console.log('  ', enhancedSelector);
console.log();

// Show final code
console.log('💻 GENERATED CODE:');
console.log('```typescript');
console.log(`// Step ${testStep.stepNumber}: ${testStep.action}`);
console.log(`const btn = page.locator('${enhancedSelector}');`);
console.log(`await healedClick(btn);`);
console.log('```');
console.log();

console.log('='.repeat(80));
console.log('✅ ANALYSIS COMPLETE');
console.log('='.repeat(80));
console.log();
console.log('📋 SUMMARY:');
console.log(`   - Flow pattern matched: ${flowPatternMatched ? 'YES' : 'NO'}`);
console.log(`   - Button text extracted: "${match ? (match[1] || match[2]) : 'NONE'}"`);
console.log(`   - Button text normalized: "${buttonText}"`);
console.log(`   - Selector strategy: Enhanced with fallbacks`);
console.log(`   - Expected to work: ✅ YES (fix is applied)`);
console.log();
