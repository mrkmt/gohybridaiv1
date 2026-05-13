/**
 * Page Scanner Diagnostic Test
 * 
 * Demonstrates the page scanner capabilities:
 * - Scans all interactive elements
 * - Generates stable selectors without dynamic IDs
 * - Finds elements by text/label/placeholder
 */

import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { scanPage, printScanResult, findElementByText, getSelector } from './page-scanner';

async function demonstratePageScanner() {
    const baseUrl = 'https://test.globalhr.com.mm/ook';
    const username = 'testook_HR 1';
    const password = 'Global@2024';
    
    console.log('='.repeat(70));
    console.log('PAGE SCANNER DEMONSTRATION');
    console.log('='.repeat(70));
    
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    
    try {
        // Launch browser
        browser = await chromium.launch({
            headless: false,
            slowMo: 500,
        });
        
        context = await browser.newContext({
            ignoreHTTPSErrors: true,
            viewport: { width: 1280, height: 720 },
        });
        
        page = await context.newPage();
        
        // Step 1: Navigate to login page and scan
        console.log('\n[1/4] Scanning LOGIN PAGE...');
        await page.goto(`${baseUrl}#/login`, { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(2000);
        
        const loginScan = await scanPage(page, { verbose: true });
        printScanResult(loginScan);
        
        // Find login button by text
        const loginButton = findElementByText(loginScan, 'LOG IN', 'button');
        console.log(`\n✓ Found Login Button:`);
        console.log(`  Text: "${loginButton?.text}"`);
        console.log(`  Selector: ${loginButton?.selector}`);
        console.log(`  Enabled: ${loginButton?.isEnabled}`);
        
        // Step 2: Login
        console.log('\n[2/4] Performing login...');
        
        // Find ID Number field
        const idField = loginScan.inputs.find(i => i.name?.includes('idnumber'));
        if (idField) {
            await page.locator(idField.selector).click();
            await page.waitForTimeout(300);
            await page.locator(idField.selector).fill(username);
            console.log(`✓ Filled ID Number using selector: ${idField.selector}`);
        }
        
        // Find Username field
        const userField = loginScan.inputs.find(i => i.name?.includes('username'));
        if (userField) {
            await page.locator(userField.selector).click();
            await page.waitForTimeout(300);
            await page.locator(userField.selector).fill(username);
            console.log(`✓ Filled Username using selector: ${userField.selector}`);
        }
        
        // Find Password field
        const passField = loginScan.inputs.find(i => i.name?.includes('password') || i.subtype === 'password');
        if (passField) {
            await page.locator(passField.selector).click();
            await page.waitForTimeout(500);
            await page.locator(passField.selector).fill(password);
            console.log(`✓ Filled Password using selector: ${passField.selector}`);
        }
        
        // Click login
        if (loginButton) {
            await page.locator(loginButton.selector).click();
            console.log(`✓ Clicked Login button`);
        }
        
        // Wait for dashboard
        await page.waitForURL(/.*#\/dashboard/, { timeout: 60000 });
        await page.waitForLoadState('networkidle', { timeout: 60000 });
        await page.waitForTimeout(3000);
        
        // Step 3: Scan Dashboard page
        console.log('\n[3/4] Scanning DASHBOARD PAGE...');
        const dashboardScan = await scanPage(page, { verbose: true });
        printScanResult(dashboardScan);
        
        // Step 4: Navigate to Designation and scan
        console.log('\n[4/4] Navigating to DESIGNATION page and scanning...');
        
        // Find designation menu/link
        const designationLink = dashboardScan.elements.find(el => 
            el.text?.toLowerCase().includes('designation') ||
            el.name?.toLowerCase().includes('designation')
        );
        
        if (designationLink) {
            console.log(`Found Designation menu: ${designationLink.selector}`);
            await page.locator(designationLink.selector).click();
            await page.waitForLoadState('networkidle', { timeout: 60000 });
            await page.waitForTimeout(3000);
        } else {
            // Fallback direct navigation
            await page.goto(`${baseUrl}#/app.designation`, { waitUntil: 'networkidle' });
            await page.waitForTimeout(3000);
        }
        
        // Scan designation page
        const designationScan = await scanPage(page, { verbose: true });
        printScanResult(designationScan);
        
        // Demonstrate finding elements by description
        console.log('\n🔍 FINDING ELEMENTS BY DESCRIPTION:');
        console.log('='.repeat(60));
        
        const addButton = findElementByText(designationScan, 'Add', 'button');
        if (addButton) {
            console.log(`✓ "Add" button found:`);
            console.log(`  Selector: ${addButton.selector}`);
            console.log(`  Enabled: ${addButton.isEnabled}`);
        }
        
        const nameInput = designationScan.inputs.find(i => 
            i.name?.toLowerCase().includes('name') ||
            i.name?.toLowerCase().includes('designation')
        );
        if (nameInput) {
            console.log(`\n✓ "Designation Name" input found:`);
            console.log(`  Selector: ${nameInput.selector}`);
            console.log(`  Type: ${nameInput.subtype}`);
            console.log(`  Enabled: ${nameInput.isEnabled}`);
        }
        
        console.log('\n' + '='.repeat(70));
        console.log('PAGE SCANNER DEMONSTRATION COMPLETE ✓');
        console.log('='.repeat(70));
        console.log('\nKey Benefits:');
        console.log('  ✓ No hardcoded selectors');
        console.log('  ✓ No dynamic IDs (k-xxxxx)');
        console.log('  ✓ Elements found by text/label/placeholder');
        console.log('  ✓ Works across environments with different layouts');
        console.log('  ✓ Auto-generates stable selectors');
        console.log('\n');
        
        // Keep browser open for visual verification
        await page.waitForTimeout(5000);
        
    } catch (error: any) {
        console.error('\n✗ Error:', error.message);
    } finally {
        if (page) await page.close();
        if (context) await context.close();
        if (browser) await browser.close();
        console.log('✓ Browser closed');
    }
}

demonstratePageScanner().catch(console.error);
