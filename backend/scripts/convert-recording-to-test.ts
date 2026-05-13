/**
 * Manual Recording to Playwright Test Converter
 * 
 * Converts Go-Hybrid Harvester manual recording JSON to Playwright test script
 */

import * as fs from 'fs';
import * as path from 'path';

interface RecordingStep {
    timestamp: number;
    type: string;
    tagName: string;
    elementType: string;
    selector: string;
    value?: string;
    text?: string;
    url: string;
    componentInfo?: {
        formControlName?: string;
        businessName?: string;
        type?: string;
    };
}

interface RecordingData {
    metadata: {
        moduleName: string;
        sourceUrl: string;
    };
    data: {
        steps: RecordingStep[];
    };
}

/**
 * Convert manual recording to Playwright test
 */
export function convertRecordingToTest(recordingPath: string): string {
    const recording: RecordingData = JSON.parse(fs.readFileSync(recordingPath, 'utf8'));
    
    const moduleName = recording.metadata.moduleName || 'ManualTest';
    const steps = recording.data.steps;
    
    // Extract test name from first input or use default
    const testName = extractTestName(steps);
    
    // Generate test script
    const testScript = generateTestScript(moduleName, testName, steps);
    
    return testScript;
}

/**
 * Extract test name from recorded steps
 */
function extractTestName(steps: RecordingStep[]): string {
    // Look for designation name input
    const nameInput = steps.find(s => 
        s.type === 'input-typed' && 
        s.componentInfo?.formControlName === 'Designation' &&
        s.value && s.value.startsWith('Sample_')
    );
    
    if (nameInput?.value) {
        // Extract from "Sample_Design_1" -> "Design_1"
        const match = nameInput.value.match(/Sample_(.+)/);
        if (match) return match[1];
    }
    
    return `Test_${Date.now()}`;
}

/**
 * Generate Playwright test script
 */
function generateTestScript(moduleName: string, testName: string, steps: RecordingStep[]): string {
    const safeName = testName.replace(/[^a-zA-Z0-9]/g, '_');
    
    // Find login steps
    const loginSteps = steps.filter(s => s.url.includes('/login'));
    const idNumber = loginSteps.find(s => s.type === 'input-typed' && s.componentInfo?.businessName === 'idnumber')?.value || 'testook_HR 1';
    const password = loginSteps.find(s => s.type === 'input-typed' && s.componentInfo?.businessName === 'password')?.value || 'Global@2024';
    
    // Find CRUD operations
    const createSteps = steps.filter(s => s.type === 'input-typed' && s.value?.includes('Sample_'));
    const updateStep = steps.find(s => s.type === 'input-typed' && s.value?.includes('_update'));
    const deleteStep = steps.find(s => s.text === 'Yes' && s.type === 'click');
    
    return `/**
 * Auto-Generated Playwright Test from Manual Recording
 * 
 * Module: ${moduleName}
 * Test Name: ${testName}
 * Generated: ${new Date().toISOString()}
 * 
 * Source: backend/manualrecord/
 */

import { test, expect } from '@playwright/test';
import { loginAndNavigate } from './login-helper';
import { healedClick, safeFill, waitForAngularStable } from './playwright-self-healing';
import { TESTING_CREDENTIALS } from './test-credentials';

test.describe('${moduleName} - ${testName}', () => {
    const credentials = {
        baseUrl: TESTING_CREDENTIALS.baseUrl,
        apiBaseUrl: TESTING_CREDENTIALS.apiBaseUrl,
        idNumber: '${idNumber}',
        username: '${idNumber}',
        password: '${password}'
    };
    
    const NAVIGATION_TIMEOUT = 180000;
    const ELEMENT_TIMEOUT = 90000;

    test.beforeEach(async ({ page }) => {
        // Login and navigate to ${moduleName} page
        await loginAndNavigate(
            page,
            credentials,
            '${moduleName}',
            \`\${credentials.baseUrl}#/app.${moduleName.toLowerCase()}\`
        );
        
        await page.waitForLoadState('networkidle', { timeout: NAVIGATION_TIMEOUT });
        await waitForAngularStable(page);
        await page.waitForTimeout(3000);
    });

    test('should complete full CRUD flow', async ({ page }) => {
        console.log('Starting ${moduleName} CRUD test...');
        
        // ========== CREATE ==========
        console.log('Step 1: Creating new ${moduleName}...');
        
        // Click Add button
        await healedClick(page, 'button.btn.btn-primary, button:has-text("Add")');
        await page.waitForTimeout(2000);
        
        // Fill Short Code (if exists)
        const shortCodeInput = page.locator('input[formcontrolname="ShortCode"], input[name="Short Code"]');
        if (await shortCodeInput.count() > 0) {
            await shortCodeInput.first().fill('Sample_${safeName}');
        }
        
        // Fill Grade/Category dropdown (if exists)
        const gradeDropdown = page.locator('kendo-dropdownlist[formcontrolname="GradeID"]');
        if (await gradeDropdown.count() > 0) {
            await gradeDropdown.first().click();
            await page.waitForTimeout(1000);
            await page.click('li:has-text("Manager")');
        }
        
        // Fill ${moduleName} Name
        const nameInput = page.locator('input[formcontrolname="${moduleName}"], input[name="${moduleName}"]');
        await nameInput.first().fill('Sample_${safeName}');
        
        // Click Save
        await healedClick(page, 'button.btn.btn-success:has-text("Save"), button[type="submit"]');
        await page.waitForTimeout(2000);
        
        // Click Ok on success message
        await healedClick(page, 'button.btn.btn-success:has-text("Ok")');
        await page.waitForTimeout(2000);
        
        console.log('✓ Created successfully');
        
        // ========== READ - Verify in grid ==========
        console.log('Step 2: Verifying in grid...');
        
        // Search for the record
        const searchBox = page.locator('input[placeholder="Search ..."]');
        if (await searchBox.count() > 0) {
            await searchBox.first().fill('sample_${safeName.toLowerCase()}');
            await page.waitForTimeout(1000);
        }
        
        // Verify record exists in grid
        const gridCell = page.locator(\`td:has-text("Sample_${safeName}")\`);
        await expect(gridCell.first()).toBeVisible({ timeout: ELEMENT_TIMEOUT });
        
        console.log('✓ Record found in grid');
        
        // ========== UPDATE ==========
        console.log('Step 3: Updating ${moduleName}...');
        
        // Click edit button (icon in row)
        const editButton = page.locator('tr td:has-text("Sample_${safeName}") .. button.btn, tr td:has-text("Sample_${safeName}") .. svg');
        if (await editButton.count() > 0) {
            await editButton.first().click();
            await page.waitForTimeout(2000);
        }
        
        // Update name
        const nameInput2 = page.locator('input[formcontrolname="${moduleName}"], input[name="${moduleName}"]');
        await nameInput2.first().fill('Sample_${safeName}_update');
        
        // Click Update
        await healedClick(page, 'button.btn.btn-success:has-text("Update"), button[type="submit"]');
        await page.waitForTimeout(2000);
        
        // Click Ok on success message
        await healedClick(page, 'button.btn.btn-success:has-text("Ok")');
        await page.waitForTimeout(2000);
        
        console.log('✓ Updated successfully');
        
        // ========== DELETE ==========
        console.log('Step 4: Deleting ${moduleName}...');
        
        // Search again
        if (await searchBox.count() > 0) {
            await searchBox.first().fill('sample_${safeName.toLowerCase()}');
            await page.waitForTimeout(1000);
        }
        
        // Click delete button
        const deleteButton = page.locator('tr td:has-text("Sample_${safeName}_update") .. button.btn, tr td:has-text("Sample_${safeName}_update") .. svg');
        if (await deleteButton.count() > 0) {
            await deleteButton.first().click();
            await page.waitForTimeout(2000);
        }
        
        // Confirm deletion
        await healedClick(page, 'button.btn.btn-success:has-text("Yes")');
        await page.waitForTimeout(2000);
        
        // Click Ok on success message
        await healedClick(page, 'button.btn.btn-success:has-text("Ok")');
        await page.waitForTimeout(2000);
        
        console.log('✓ Deleted successfully');
        
        // ========== VERIFY DELETION ==========
        console.log('Step 5: Verifying deletion...');
        
        // Search again - should not find
        if (await searchBox.count() > 0) {
            await searchBox.first().clear();
            await searchBox.first().fill('sample_${safeName.toLowerCase()}');
            await page.waitForTimeout(2000);
        }
        
        const deletedCell = page.locator(\`td:has-text("Sample_${safeName}_update")\`);
        await expect(deletedCell.first()).not.toBeVisible({ timeout: ELEMENT_TIMEOUT });
        
        console.log('✓ Deletion verified');
        console.log('\\n✅ ${moduleName} CRUD test completed successfully!');
    });
});
`;
}

/**
 * Process all recordings in manualrecord folder
 */
export function processAllRecordings(inputDir: string, outputDir: string): void {
    const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
        try {
            const inputPath = path.join(inputDir, file);
            const testScript = convertRecordingToTest(inputPath);
            
            // Generate output filename
            const outputName = file.replace('.json', '.spec.ts');
            const outputPath = path.join(outputDir, outputName);
            
            fs.writeFileSync(outputPath, testScript, 'utf8');
            console.log(`✓ Generated: ${outputName}`);
        } catch (error: any) {
            console.error(`✗ Failed to process ${file}: ${error.message}`);
        }
    }
}

// Main execution
if (require.main === module) {
    const inputDir = path.join(__dirname, '..', 'manualrecord');
    const outputDir = path.join(__dirname, '..', 'tests', 'playwright');
    
    console.log('Processing manual recordings...');
    processAllRecordings(inputDir, outputDir);
    console.log('Done!');
}
