/**
 * Login Page Diagnostic Test
 * Identifies correct selectors for login form fields
 */

import { chromium, Browser, BrowserContext, Page } from '@playwright/test';

async function diagnoseLoginPage() {
    const baseUrl = 'https://test.globalhr.com.mm/ook';
    const username = 'testook_HR 1';
    const password = 'Global@2024';
    
    console.log('='.repeat(60));
    console.log('Login Page Diagnostic - Finding Correct Selectors');
    console.log('='.repeat(60));
    
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    
    try {
        // Launch browser
        browser = await chromium.launch({
            headless: false,
            slowMo: 1000, // Slow down for observation
        });
        
        context = await browser.newContext({
            ignoreHTTPSErrors: true,
            viewport: { width: 1280, height: 720 },
        });
        
        page = await context.newPage();
        
        // Navigate to login page
        console.log('\n[1/5] Navigating to login page...');
        await page.goto(`${baseUrl}#/login`, { 
            waitUntil: 'networkidle',
            timeout: 60000 
        });
        console.log('✓ Login page loaded');
        
        // Wait for any input fields to appear
        await page.waitForSelector('input', { timeout: 10000 });
        
        // Find all input fields
        console.log('\n[2/5] Scanning for input fields...');
        const allInputs = page.locator('input');
        const inputCount = await allInputs.count();
        console.log(`Found ${inputCount} input elements`);
        
        // Get details of each input
        for (let i = 0; i < inputCount; i++) {
            const input = allInputs.nth(i);
            const type = await input.getAttribute('type');
            const name = await input.getAttribute('name');
            const id = await input.getAttribute('id');
            const placeholder = await input.getAttribute('placeholder');
            const formControlName = await input.getAttribute('formcontrolname');
            const className = await input.getAttribute('class');
            
            console.log(`\n  Input #${i + 1}:`);
            console.log(`    type: "${type}"`);
            console.log(`    name: "${name}"`);
            console.log(`    id: "${id}"`);
            console.log(`    placeholder: "${placeholder}"`);
            console.log(`    formcontrolname: "${formControlName}"`);
            console.log(`    class: "${className}"`);
        }
        
        // Find all buttons
        console.log('\n[3/5] Scanning for buttons...');
        const allButtons = page.locator('button, input[type="button"], input[type="submit"]');
        const buttonCount = await allButtons.count();
        console.log(`Found ${buttonCount} button elements`);
        
        for (let i = 0; i < buttonCount; i++) {
            const button = allButtons.nth(i);
            const text = await button.textContent();
            const type = await button.getAttribute('type');
            const id = await button.getAttribute('id');
            const className = await button.getAttribute('class');
            
            console.log(`\n  Button #${i + 1}:`);
            console.log(`    text: "${text?.trim()}"`);
            console.log(`    type: "${type}"`);
            console.log(`    id: "${id}"`);
            console.log(`    class: "${className}"`);
        }
        
        // Try to identify username and password fields
        console.log('\n[4/5] Identifying credential fields...');
        
        // Common patterns for username
        const usernameSelectors = [
            'input[type="text"]',
            'input[name="userName"]',
            'input[name="username"]',
            'input[name="userCode"]',
            'input[name="idNumber"]',
            'input[formcontrolname="userName"]',
            'input[formcontrolname="userCode"]',
            'input[placeholder*="user" i]',
            'input[placeholder*="id" i]',
        ];
        
        for (const selector of usernameSelectors) {
            const el = page.locator(selector).first();
            if (await el.count() > 0) {
                console.log(`✓ Username field found: "${selector}"`);
            }
        }
        
        // Common patterns for password
        const passwordSelectors = [
            'input[type="password"]',
            'input[name="password"]',
            'input[formcontrolname="password"]',
            'input[placeholder*="pass" i]',
        ];
        
        for (const selector of passwordSelectors) {
            const el = page.locator(selector).first();
            if (await el.count() > 0) {
                console.log(`✓ Password field found: "${selector}"`);
            }
        }
        
        // Common patterns for login button
        const loginButtonSelectors = [
            'button:has-text("Login")',
            'button:has-text("Sign In")',
            'input[type="submit"]',
            'button[type="submit"]',
            'button.k-button:has-text("Login")',
            '.login-button',
            '#loginBtn',
        ];
        
        console.log('\n[5/5] Identifying login button...');
        for (const selector of loginButtonSelectors) {
            const el = page.locator(selector).first();
            if (await el.count() > 0) {
                const text = await el.textContent();
                console.log(`✓ Login button found: "${selector}" (text: "${text?.trim()}")`);
            }
        }
        
        // Try filling and login with most likely selectors
        console.log('\n' + '='.repeat(60));
        console.log('Attempting login with detected selectors...');
        console.log('='.repeat(60));
        
        // Step 1: Fill ID Number field (name="idnumber")
        console.log('Filling ID Number field...');
        const idNumberField = page.locator('input[name="idnumber"]').first();
        await idNumberField.click();
        await idNumberField.fill(username);
        console.log(`✓ Filled ID Number: ${username}`);
        
        // Step 2: Fill Username field (name="username")
        console.log('Filling Username field...');
        const usernameField = page.locator('input[name="username"]').first();
        await usernameField.click();
        await usernameField.fill(username);
        console.log(`✓ Filled Username: ${username}`);
        
        // Step 3: Fill Password field - Kendo UI readonly workaround
        console.log('Filling Password field (Kendo UI workaround)...');
        const passwordField = page.locator('input[name="password"]').first();
        await passwordField.click();  // Click to focus and remove readonly
        await page.waitForTimeout(500);  // Wait for readonly to be removed
        await passwordField.fill(password);
        console.log(`✓ Filled Password: ${password}`);
        
        // Step 4: Click Login button
        console.log('Clicking Login button...');
        const loginButton = page.locator('button[type="submit"], button:has-text("LOG IN")').first();
        await loginButton.click();
        console.log('✓ Clicked Login button');
        
        // Wait for navigation
        try {
            await page.waitForURL(/.*#\/dashboard/, { timeout: 30000 });
            console.log('✓ Login successful - navigated to dashboard!');
        } catch {
            console.log('⚠ Did not navigate to dashboard - checking for errors...');
            const currentUrl = page.url();
            console.log(`Current URL: ${currentUrl}`);
            
            // Check for error messages
            const errorMessages = page.locator('.text-danger, .alert-danger, .error-message, .k-invalid-msg');
            const errorCount = await errorMessages.count();
            if (errorCount > 0) {
                for (let i = 0; i < errorCount; i++) {
                    const errorMsg = await errorMessages.nth(i).textContent();
                    console.log(`Error message: "${errorMsg?.trim()}"`);
                }
            }
        }
        
        await page.waitForTimeout(5000);
        
        console.log('\n' + '='.repeat(60));
        console.log('Diagnostic complete!');
        console.log('='.repeat(60));
        
    } catch (error: any) {
        console.log('\n✗ Error:', error.message);
    } finally {
        if (page) await page.close();
        if (context) await context.close();
        if (browser) await browser.close();
        console.log('✓ Browser closed');
    }
}

diagnoseLoginPage().catch(console.error);
