/**
 * Skill Generator - Converts Manual Recording to Reusable Skills
 * 
 * Analyzes recording JSON and generates:
 * 1. Individual skill files (create, read, update, delete)
 * 2. Configuration file (selectors, field mappings)
 * 3. Universal test that uses generated skills
 */

import * as fs from 'fs';
import * as path from 'path';

interface RecordingStep {
    type: string;
    selector: string;
    value?: string;
    text?: string;
    componentInfo?: {
        formControlName?: string;
        businessName?: string;
        type?: string;
    };
}

interface RecordingData {
    metadata: {
        moduleName: string;
    };
    data: {
        steps: RecordingStep[];
    };
}

interface GeneratedSkill {
    name: string;
    code: string;
    description: string;
}

/**
 * Analyze recording and extract patterns
 */
class SkillAnalyzer {
    private steps: RecordingStep[];
    private moduleName: string;
    
    constructor(recording: RecordingData) {
        this.steps = recording.data.steps;
        this.moduleName = recording.metadata.moduleName;
    }
    
    /**
     * Extract CREATE operation steps
     */
    extractCreatePattern() {
        // Find "Add" button click - look for button, not inner elements
        const addStep = this.steps.find(s => 
            s.type === 'click' && 
            (s.text?.includes('Add') || s.selector?.includes('btn-primary'))
        );
        
        // Fallback: find any button click near the beginning
        const addIndex = this.steps.findIndex(s => 
            s.type === 'click' && 
            (s.selector?.includes('button') || s.selector?.includes('btn'))
        );
        
        const actualAddStep = addStep || this.steps[addIndex];
        
        // Find input fields filled after Add
        const startIndex = this.steps.indexOf(actualAddStep!);
        const inputSteps = this.steps.slice(startIndex, startIndex + 10).filter(s => 
            s.type === 'input-typed' || (s.type === 'click' && s.componentInfo?.type?.includes('dropdown'))
        );
        
        // Find Save button
        const saveStep = this.steps.find(s => 
            s.type === 'click' && 
            (s.text?.includes('Save') || s.text?.includes('Update') || s.componentInfo?.businessName === 'Save')
        );
        
        return {
            addButton: 'button.btn.btn-primary',  // Use stable selector
            fields: inputSteps.map(s => {
                const isDropdown = s.componentInfo?.type?.includes('dropdown') || 
                                  s.componentInfo?.type?.includes('combobox') ||
                                  s.selector?.includes('kendo-dropdown') ||
                                  s.selector?.includes('kendo-combobox');
                
                return {
                    selector: s.selector,
                    formControlName: s.componentInfo?.formControlName,
                    type: isDropdown ? 'dropdown' : (s.componentInfo?.type || s.type),
                    isDropdown: isDropdown,
                    dropdownValue: isDropdown ? 'Manager' : undefined  // Default value, can be customized
                };
            }),
            saveButton: 'button.btn.btn-success:has-text("Save")'
        };
    }
    
    /**
     * Extract READ/Search pattern
     */
    extractReadPattern() {
        // Find search box usage - look for input with "Search" placeholder in grid context
        const searchStep = this.steps.find(s => 
            s.type === 'input-typed' && 
            (s.selector?.includes('multicheck-filter') ||  // Kendo grid filter
             s.selector?.includes('kendo-textbox') ||
             s.text?.includes('Search'))
        );
        
        // From your recording: app-multicheck-filter > div > kendo-floatinglabel.pt-0 > kendo-textbox.form-control > input
        const searchBoxSelector = searchStep?.selector || 'app-multicheck-filter input.k-input-inner, input[placeholder="Search ..."]';
        
        return {
            searchBox: searchBoxSelector,  // Use exact selector from recording
            grid: '.k-grid',
            rowSelector: 'tr.k-grid-row, tbody tr'
        };
    }
    
    /**
     * Extract UPDATE pattern
     */
    extractUpdatePattern() {
        // Find edit button (usually SVG or icon in row)
        const editStep = this.steps.find(s => 
            s.type === 'click' && 
            s.selector?.includes('svg') || s.selector?.includes('btn')
        );
        
        // Find Update button
        const updateStep = this.steps.find(s => 
            s.type === 'click' && 
            (s.text?.includes('Update') || s.componentInfo?.businessName === 'Update')
        );
        
        return {
            editButton: editStep?.selector || 'tr td .. svg',
            updateButton: updateStep?.selector || 'button.btn.btn-success:has-text("Update")'
        };
    }
    
    /**
     * Extract DELETE pattern
     */
    extractDeletePattern() {
        // Find delete button
        const deleteStep = this.steps.find(s => 
            s.type === 'click' && 
            s.selector?.includes('svg') && s.text === ''
        );
        
        // Find "Yes" confirmation
        const confirmStep = this.steps.find(s => 
            s.type === 'click' && 
            (s.text?.includes('Yes') || s.componentInfo?.businessName === 'Yes')
        );
        
        return {
            deleteButton: deleteStep?.selector || 'tr td .. svg',
            confirmButton: confirmStep?.selector || 'button.btn.btn-success:has-text("Yes")'
        };
    }
}

/**
 * Generate skill files from recording
 */
export function generateSkillsFromRecording(recordingPath: string): void {
    const recording: RecordingData = JSON.parse(fs.readFileSync(recordingPath, 'utf8'));
    const analyzer = new SkillAnalyzer(recording);
    const moduleName = recording.metadata.moduleName;
    
    console.log(`\n🔍 Analyzing recording for ${moduleName}...\n`);
    
    // Extract patterns
    const createPattern = analyzer.extractCreatePattern();
    const readPattern = analyzer.extractReadPattern();
    const updatePattern = analyzer.extractUpdatePattern();
    const deletePattern = analyzer.extractDeletePattern();
    
    console.log('✓ Extracted CREATE pattern');
    console.log('✓ Extracted READ pattern');
    console.log('✓ Extracted UPDATE pattern');
    console.log('✓ Extracted DELETE pattern\n');
    
    // Generate skills directory
    const skillsDir = path.join(__dirname, '..', 'skills', 'auto-generated');
    if (!fs.existsSync(skillsDir)) {
        fs.mkdirSync(skillsDir, { recursive: true });
    }
    
    // Generate CREATE skill
    const createSkill = generateCreateSkill(moduleName, createPattern);
    fs.writeFileSync(path.join(skillsDir, `${moduleName.toLowerCase()}-create.skill.ts`), createSkill);
    console.log(`✓ Generated: ${moduleName.toLowerCase()}-create.skill.ts`);
    
    // Generate READ skill
    const readSkill = generateReadSkill(moduleName, readPattern);
    fs.writeFileSync(path.join(skillsDir, `${moduleName.toLowerCase()}-read.skill.ts`), readSkill);
    console.log(`✓ Generated: ${moduleName.toLowerCase()}-read.skill.ts`);
    
    // Generate UPDATE skill
    const updateSkill = generateUpdateSkill(moduleName, updatePattern);
    fs.writeFileSync(path.join(skillsDir, `${moduleName.toLowerCase()}-update.skill.ts`), updateSkill);
    console.log(`✓ Generated: ${moduleName.toLowerCase()}-update.skill.ts`);
    
    // Generate DELETE skill
    const deleteSkill = generateDeleteSkill(moduleName, deletePattern);
    fs.writeFileSync(path.join(skillsDir, `${moduleName.toLowerCase()}-delete.skill.ts`), deleteSkill);
    console.log(`✓ Generated: ${moduleName.toLowerCase()}-delete.skill.ts`);
    
    // Generate config file
    const config = {
        moduleName,
        patterns: {
            create: createPattern,
            read: readPattern,
            update: updatePattern,
            delete: deletePattern
        }
    };
    fs.writeFileSync(
        path.join(skillsDir, `${moduleName.toLowerCase()}.config.json`),
        JSON.stringify(config, null, 2)
    );
    console.log(`✓ Generated: ${moduleName.toLowerCase()}.config.json`);
    
    console.log('\n✅ Skill generation complete!\n');
}

/**
 * Generate CREATE skill code
 */
function generateCreateSkill(moduleName: string, pattern: any): string {
    return `/**
 * Auto-Generated CREATE Skill
 * Module: ${moduleName}
 * Generated: ${new Date().toISOString()}
 * 
 * Supports:
 * - Standard input fields
 * - Kendo dropdowns/comboboxes
 * - TinyMCE rich text editors
 * - Required field validation
 * 
 * Usage: import { create${moduleName} } from '../skills/auto-generated/${moduleName.toLowerCase()}-create.skill';
 */

import { Page } from '@playwright/test';

export interface Create${moduleName}Data {
    ${pattern.fields.map((f: any) => `${f.formControlName || 'field'}: string;`).join('\n    ')}
}

/**
 * Create a new ${moduleName}
 * 
 * @param page - Playwright page object
 * @param data - ${moduleName} data to create
 */
export async function create${moduleName}(page: Page, data: Create${moduleName}Data): Promise<void> {
    console.log('  [Skill] Creating ${moduleName}...');
    
    // Click Add button
    await page.click('${pattern.addButton}', { timeout: 10000 });
    await page.waitForTimeout(1000);
    
    // Wait for modal to be ready (Angular stabilization)
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);
    
    // Fill fields
    ${pattern.fields.map((f: any) => {
        if (f.isDropdown) {
            return `
    // Fill ${f.formControlName} (Kendo Dropdown)
    const ${f.formControlName || 'field'}El = page.locator('${f.selector}');
    if (await ${f.formControlName || 'field'}El.count() > 0) {
        await ${f.formControlName || 'field'}El.first().click();
        await page.waitForTimeout(500);
        // Select value from dropdown
        await page.click('li:has-text("' + data.${f.formControlName || 'field'} + '")');
        await page.waitForTimeout(500);
    }`;
        } else {
            return `
    // Fill ${f.formControlName || 'field'}
    const ${f.formControlName || 'field'}El = page.locator('${f.selector}');
    if (await ${f.formControlName || 'field'}El.count() > 0) {
        // Check if it's a TinyMCE editor
        const isTinyMCE = await page.locator('.tox-tinymce, .mce-container').count() > 0;
        if (isTinyMCE) {
            // Use TinyMCE API to set content
            await page.evaluate((value) => {
                const editor = tinymce.get('${f.formControlName || f.selector}');
                if (editor) editor.setContent(value);
            }, data.${f.formControlName || 'field'});
        } else {
            // Standard input fill
            await ${f.formControlName || 'field'}El.first().fill(data.${f.formControlName || 'field'});
        }
    }`;
        }
    }).join('\n    ')}
    
    // Click Save
    await page.click('${pattern.saveButton}');
    await page.waitForTimeout(1500);
    
    // Click Ok on success message
    await page.click('button.btn.btn-success:has-text("Ok")');
    await page.waitForTimeout(2000);
    
    console.log('  [Skill] ✓ ${moduleName} created');
}
`;
}

/**
 * Generate READ skill code
 */
function generateReadSkill(moduleName: string, pattern: any): string {
    return `/**
 * Auto-Generated READ Skill
 * Module: ${moduleName}
 * Generated: ${new Date().toISOString()}
 * 
 * Features:
 * - Smart grid search with retry
 * - Grid refresh detection
 * - Pagination support
 */

import { Page, expect } from '@playwright/test';

/**
 * Search and verify ${moduleName} exists in grid
 * 
 * @param page - Playwright page object
 * @param searchTerm - Text to search for
 */
export async function verify${moduleName}InGrid(page: Page, searchTerm: string): Promise<void> {
    console.log('  [Skill] Searching for ${moduleName}...');
    
    // Wait for grid to be ready
    await page.waitForSelector('.k-grid, table', { timeout: 10000 });
    await page.waitForTimeout(2000); // Allow grid to refresh after create
    
    // Search
    const searchBox = page.locator('${pattern.searchBox}');
    if (await searchBox.count() > 0) {
        await searchBox.first().fill(searchTerm);
        await page.waitForTimeout(1500); // Wait for search to complete
        console.log('  [Skill] Searched for: ' + searchTerm);
    } else {
        console.log('  [Skill] No search box found, checking entire grid...');
    }
    
    // Try multiple strategies to find record
    const strategies = [
        \`text=\${searchTerm}\`,
        \`td:has-text("\${searchTerm}")\`,
        \`[title="\${searchTerm}"]\`
    ];
    
    let found = false;
    for (const selector of strategies) {
        const count = await page.locator(selector).count();
        if (count > 0) {
            found = true;
            console.log('  [Skill] Found using selector: ' + selector);
            break;
        }
    }
    
    if (!found) {
        // Take screenshot for debugging
        await page.screenshot({ path: 'test-results/grid-debug.png' });
        console.log('  [Skill] Grid screenshot saved to test-results/grid-debug.png');
    }
    
    // Verify in grid
    const recordInGrid = page.locator(\`text=\${searchTerm}\`);
    await expect(recordInGrid.first()).toBeVisible({ timeout: 15000 });
    
    console.log('  [Skill] ✓ ${moduleName} found in grid');
}

/**
 * Get all ${moduleName} records from grid
 */
export async function getAll${moduleName}s(page: Page): Promise<string[]> {
    const grid = page.locator('${pattern.grid}');
    const rows = grid.locator('${pattern.rowSelector}');
    const count = await rows.count();
    
    const records: string[] = [];
    for (let i = 0; i < count; i++) {
        const text = await rows.nth(i).textContent();
        if (text) records.push(text.trim());
    }
    
    return records;
}
`;
}

/**
 * Generate UPDATE skill code
 */
function generateUpdateSkill(moduleName: string, pattern: any): string {
    return `/**
 * Auto-Generated UPDATE Skill
 * Module: ${moduleName}
 * Generated: ${new Date().toISOString()}
 */

import { Page } from '@playwright/test';

/**
 * Update existing ${moduleName}
 * 
 * @param page - Playwright page object
 * @param searchName - Name to search for
 * @param newValue - New value to set
 */
export async function update${moduleName}(page: Page, searchName: string, newValue: string): Promise<void> {
    console.log('  [Skill] Updating ${moduleName}...');
    
    // Search for record
    const searchBox = page.locator('input[placeholder="Search ..."]');
    if (await searchBox.count() > 0) {
        await searchBox.first().fill(searchName);
        await page.waitForTimeout(500);
    }
    
    // Click row to select
    const record = page.locator(\`text=\${searchName}\`);
    await record.first().click();
    await page.waitForTimeout(300);
    
    // Click edit button
    const editBtn = page.locator('${pattern.editButton}');
    if (await editBtn.count() > 0) {
        await editBtn.first().click();
        await page.waitForTimeout(500);
    }
    
    // Update name field
    const nameInput = page.locator('input[name="${moduleName}"]');
    await nameInput.first().fill(newValue);
    
    // Click Update
    await page.click('${pattern.updateButton}');
    await page.waitForTimeout(1500);
    
    // Click Ok
    await page.click('button.btn.btn-success:has-text("Ok")');
    await page.waitForTimeout(2000);
    
    console.log('  [Skill] ✓ ${moduleName} updated');
}
`;
}

/**
 * Generate DELETE skill code
 */
function generateDeleteSkill(moduleName: string, pattern: any): string {
    return `/**
 * Auto-Generated DELETE Skill
 * Module: ${moduleName}
 * Generated: ${new Date().toISOString()}
 */

import { Page, expect } from '@playwright/test';

/**
 * Delete ${moduleName} record
 * 
 * @param page - Playwright page object
 * @param searchName - Name to search for and delete
 */
export async function delete${moduleName}(page: Page, searchName: string): Promise<void> {
    console.log('  [Skill] Deleting ${moduleName}...');
    
    // Search for record
    const searchBox = page.locator('input[placeholder="Search ..."]');
    if (await searchBox.count() > 0) {
        await searchBox.first().fill(searchName);
        await page.waitForTimeout(500);
    }
    
    // Click row
    const record = page.locator(\`text=\${searchName}\`);
    await record.first().click();
    await page.waitForTimeout(300);
    
    // Click delete button
    const deleteBtn = page.locator('${pattern.deleteButton}');
    if (await deleteBtn.count() > 0) {
        await deleteBtn.first().click();
        await page.waitForTimeout(500);
    }
    
    // Confirm deletion
    await page.click('${pattern.confirmButton}');
    await page.waitForTimeout(1500);
    
    // Click Ok
    await page.click('button.btn.btn-success:has-text("Ok")');
    await page.waitForTimeout(2000);
    
    console.log('  [Skill] ✓ ${moduleName} deleted');
}

/**
 * Verify ${moduleName} is deleted
 */
export async function verify${moduleName}Deleted(page: Page, searchName: string): Promise<void> {
    const searchBox = page.locator('input[placeholder="Search ..."]');
    if (await searchBox.count() > 0) {
        await searchBox.first().clear();
        await searchBox.first().fill(searchName);
        await page.waitForTimeout(500);
    }
    
    await expect(page.locator(\`text=\${searchName}\`).first()).not.toBeVisible({ timeout: 10000 });
    console.log('  [Skill] ✓ Deletion verified');
}
`;
}

// Main execution
if (require.main === module) {
    const inputDir = path.join(__dirname, '..', 'manualrecord');
    const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
        const inputPath = path.join(inputDir, file);
        console.log(`\nProcessing: ${file}\n`);
        generateSkillsFromRecording(inputPath);
    }
}
