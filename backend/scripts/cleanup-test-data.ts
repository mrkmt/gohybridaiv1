/**
 * Cleanup Test Data Script
 * 
 * Deletes specific test designations from the grid
 * 
 * Usage: npx ts-node --project tsconfig.json scripts/cleanup-test-data.ts
 */

import { chromium, Page } from '@playwright/test';

const TEST_DESIGNATIONS_TO_DELETE = [
    'Design_1774859956810',
    'Design_1774858012780',
    'Design_1774858287102',
    'Design_1774859630002',
    'Design_1774859762580',
    'Design_1774860060710',
    'Design_1774860310412',
    'Sample_Design_1',
    'Sample_Design_1_update',
    'Sample_design1',
    'TestDesig_'
];

async function deleteDesignation(page: Page, designationName: string): Promise<boolean> {
    try {
        console.log(`  Searching for: ${designationName}...`);
        
        // Search
        const searchBox = page.locator('input[placeholder="Search ..."]');
        if (await searchBox.count() > 0) {
            await searchBox.first().fill(designationName);
            await page.waitForTimeout(1000);
        }
        
        // Check if exists
        const record = page.locator(`td:has-text("${designationName}")`).first();
        const count = await record.count();
        
        if (count === 0) {
            console.log(`  ⚠️  Not found: ${designationName}`);
            return false;
        }
        
        console.log(`  ✓ Found: ${designationName}`);
        
        // Click row
        await record.click();
        await page.waitForTimeout(500);
        
        // Click delete button (icon in row)
        const deleteBtn = page.locator(`tr:has-text("${designationName}") svg, tr:has-text("${designationName}") button`);
        if (await deleteBtn.count() > 0) {
            await deleteBtn.first().click();
            await page.waitForTimeout(1000);
        }
        
        // Confirm
        await page.click('button.btn.btn-success:has-text("Yes")');
        await page.waitForTimeout(1500);
        
        // Click Ok
        await page.click('button.btn.btn-success:has-text("Ok")');
        await page.waitForTimeout(2000);
        
        console.log(`  ✓ Deleted: ${designationName}`);
        return true;
        
    } catch (error: any) {
        console.log(`  ✗ Error deleting ${designationName}: ${error.message}`);
        return false;
    }
}

async function cleanup(): Promise<void> {
    console.log('\n' + '='.repeat(70));
    console.log('CLEANUP TEST DATA');
    console.log('='.repeat(70));
    
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    
    try {
        // Login
        console.log('\nLogging in...');
        await page.goto('https://test.globalhr.com.mm/ook#/login', { waitUntil: 'networkidle', timeout: 30000 });
        
        await page.click('input[name="idnumber"]');
        await page.waitForTimeout(200);
        await page.fill('input[name="idnumber"]', 'testook_HR 1');
        
        await page.click('input[name="username"]');
        await page.waitForTimeout(200);
        await page.fill('input[name="username"]', 'testook_HR 1');
        
        await page.click('input[name="password"]');
        await page.waitForTimeout(500);
        await page.fill('input[name="password"]', process.env.TEST_PASSWORD || '');
        
        await page.click('button[type="submit"]');
        await page.waitForURL(/.*#\/dashboard/, { timeout: 30000 });
        console.log('✓ Logged in\n');
        
        // Navigate to Designation
        console.log('Navigating to Designation page...');
        await page.click('span:has-text("Master")');
        await page.waitForTimeout(300);
        await page.click('a:has-text("Designation")');
        await page.waitForURL(/.*#\/app\.designation/, { timeout: 30000 });
        await page.waitForTimeout(2000);
        console.log('✓ On Designation page\n');
        
        // Delete each test designation
        console.log('Deleting test designations...\n');
        
        let deletedCount = 0;
        let notFoundCount = 0;
        
        for (const name of TEST_DESIGNATIONS_TO_DELETE) {
            const deleted = await deleteDesignation(page, name);
            if (deleted) {
                deletedCount++;
            } else if (!name.includes('Sample_') && !name.includes('TestDesig_')) {
                notFoundCount++;
            }
            
            // Wait between deletions
            await page.waitForTimeout(1000);
        }
        
        console.log('\n' + '='.repeat(70));
        console.log(`CLEANUP COMPLETE`);
        console.log(`  Deleted: ${deletedCount} designations`);
        console.log(`  Not found: ${notFoundCount} designations (already deleted)`);
        console.log('='.repeat(70) + '\n');
        
    } catch (error: any) {
        console.error('Cleanup failed:', error.message);
    } finally {
        await browser.close();
    }
}

cleanup().catch(console.error);
