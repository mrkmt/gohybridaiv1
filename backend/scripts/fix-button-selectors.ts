/**
 * TestExecutionService Fix - Button Selector Correction
 * 
 * Issue: Generated tests use "Add New" but GlobalHR button text is "Add"
 * Fix: Add button text mapping and smarter selector generation
 * Date: March 31, 2026
 */

import * as fs from 'fs';
import * as path from 'path';

const SERVICE_FILE = path.join(__dirname, 'TestExecutionService.ts');

// Button text mappings for GlobalHR
const BUTTON_TEXT_MAPPINGS: Record<string, string> = {
    'Add New': 'Add',
    'Add Designation': 'Add',
    'Create New': 'Create',
    'Save Changes': 'Save',
    'Edit Item': 'Edit',
    'Delete Item': 'Delete',
    'Remove': 'Delete'
};

// Fallback selectors for common buttons
const BUTTON_FALLBACK_SELECTORS: Record<string, string> = {
    'Add': 'button:has-text("Add"), button.btn.btn-primary:has-text("Add"), .k-button:has-text("Add"), button[kendobutton]',
    'Save': 'button:has-text("Save"), button.btn.btn-success:has-text("Save"), .k-button:has-text("Save")',
    'Edit': 'button:has-text("Edit"), button.btn.btn-primary:has-text("Edit"), .k-button-icon:has-text("Edit")',
    'Delete': 'button:has-text("Delete"), button.btn.btn-danger:has-text("Delete"), .k-button:has-text("Delete")',
    'Update': 'button:has-text("Update"), button.btn.btn-primary:has-text("Update")',
    'Cancel': 'button:has-text("Cancel"), button.btn.btn-default:has-text("Cancel")',
    'Ok': 'button:has-text("Ok"), button:has-text("OK"), .k-button:has-text("Ok")',
    'Yes': 'button:has-text("Yes"), button.btn.btn-primary:has-text("Yes")',
    'No': 'button:has-text("No"), button.btn.btn-default:has-text("No")'
};

/**
 * Fix button text in action descriptions
 */
function normalizeButtonText(action: string): string {
    let normalized = action;
    
    for (const [wrong, correct] of Object.entries(BUTTON_TEXT_MAPPINGS)) {
        normalized = normalized.replace(new RegExp(wrong, 'g'), correct);
    }
    
    return normalized;
}

/**
 * Get fallback selector for common button text
 */
function getFallbackSelector(buttonText: string): string {
    // Direct match
    if (BUTTON_FALLBACK_SELECTORS[buttonText]) {
        return BUTTON_FALLBACK_SELECTORS[buttonText];
    }
    
    // Try to find partial match
    for (const [key, selector] of Object.entries(BUTTON_FALLBACK_SELECTORS)) {
        if (buttonText.toLowerCase().includes(key.toLowerCase())) {
            return selector;
        }
    }
    
    // Default fallback
    return `button:has-text("${buttonText}"), .k-button:has-text("${buttonText}"), button.btn:has-text("${buttonText}")`;
}

/**
 * Apply fixes to TestExecutionService.ts
 */
function applyFixes() {
    console.log('🔧 Applying button selector fixes to TestExecutionService.ts...\n');
    
    let content = fs.readFileSync(SERVICE_FILE, 'utf-8');
    
    // Fix 1: Add button text normalization before extraction
    const oldClickDetection = `// 2. Fallback text-based selectors if no selectorHint
        if (action.includes('click') || action.includes('press')) {
            // Try to extract text between quotes or common labels
            const match = action.match(/'([^']+)'|"([^"]+)"/);
            const buttonText = match ? (match[1] || match[2]) : "";`;
    
    const newClickDetection = `// 2. Fallback text-based selectors if no selectorHint
        if (action.includes('click') || action.includes('press')) {
            // Try to extract text between quotes or common labels
            const match = action.match(/'([^']+)'|"([^"]+)"/);
            let buttonText = match ? (match[1] || match[2]) : "";
            
            // Normalize button text (e.g., "Add New" -> "Add")
            buttonText = normalizeButtonText(buttonText);`;
    
    if (content.includes(oldClickDetection)) {
        content = content.replace(oldClickDetection, newClickDetection);
        console.log('✅ Added button text normalization');
    } else {
        console.log('⚠️  Click detection code not found (may already be modified)');
    }
    
    // Fix 2: Update selector generation to use fallback selectors
    const oldSelectorGen = `return \`
                const btn = page.locator('button:has-text("\${buttonText}"), a:has-text("\${buttonText}"), .k-button:has-text("\${buttonText}")');
                await healedClick(btn);
                \`;`;
    
    const newSelectorGen = `// Use smart fallback selectors for GlobalHR
                const btnSelector = getFallbackSelector(buttonText);
                return \`
                const btn = page.locator('\${btnSelector}');
                await healedClick(btn);
                \`;`;
    
    if (content.includes(oldSelectorGen)) {
        content = content.replace(oldSelectorGen, newSelectorGen);
        console.log('✅ Updated selector generation to use fallback selectors');
    } else {
        console.log('⚠️  Selector generation code not found (may already be modified)');
    }
    
    // Fix 3: Add helper functions at the top of generateStepCode method
    const helperFunctions = `
        // Helper function: Normalize button text
        const normalizeButtonText = (text: string): string => {
            const mappings: Record<string, string> = {
                'Add New': 'Add',
                'Add Designation': 'Add',
                'Create New': 'Create',
                'Save Changes': 'Save'
            };
            let normalized = text;
            for (const [wrong, correct] of Object.entries(mappings)) {
                normalized = normalized.replace(new RegExp(wrong, 'g'), correct);
            }
            return normalized;
        };

        // Helper function: Get fallback selector
        const getFallbackSelector = (buttonText: string): string => {
            const selectors: Record<string, string> = {
                'Add': 'button:has-text("Add"), button.btn.btn-primary:has-text("Add"), .k-button:has-text("Add")',
                'Save': 'button:has-text("Save"), button.btn.btn-success:has-text("Save")',
                'Edit': 'button:has-text("Edit"), button.btn.btn-primary:has-text("Edit")',
                'Delete': 'button:has-text("Delete"), button.btn.btn-danger:has-text("Delete")',
                'Update': 'button:has-text("Update"), button.btn.btn-primary:has-text("Update")',
                'Cancel': 'button:has-text("Cancel"), button:has-text("OK")',
                'Ok': 'button:has-text("Ok"), button:has-text("OK")',
                'Yes': 'button:has-text("Yes")',
                'No': 'button:has-text("No")'
            };
            return selectors[buttonText] || \`button:has-text("\${buttonText}"), .k-button:has-text("\${buttonText}")\`;
        };
    `;
    
    // Find the generateStepCode function and add helpers at the beginning
    const functionStart = content.indexOf('private static generateStepCode(');
    if (functionStart !== -1) {
        const insertPos = content.indexOf('{', content.indexOf('): string {', functionStart)) + 1;
        content = content.slice(0, insertPos) + helperFunctions + content.slice(insertPos);
        console.log('✅ Added helper functions to generateStepCode');
    }
    
    // Write the updated file
    fs.writeFileSync(SERVICE_FILE, content, 'utf-8');
    console.log('\n✅ TestExecutionService.ts updated successfully!\n');
    console.log('📝 Changes applied:');
    console.log('   1. Button text normalization (Add New → Add)');
    console.log('   2. Smart fallback selectors for common buttons');
    console.log('   3. Helper functions integrated into generateStepCode\n');
}

// Run the fix
if (fs.existsSync(SERVICE_FILE)) {
    applyFixes();
} else {
    console.error('❌ TestExecutionService.ts not found at:', SERVICE_FILE);
    process.exit(1);
}
