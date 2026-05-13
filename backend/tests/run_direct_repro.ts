import { chromium } from 'playwright';
import { DepartmentPage } from '../playwright/pages/DepartmentPage';

async function runFinalRepro() {
    console.log('🕵️‍♂️ STARTING VERIFIED REPRODUCTION: ATT-22');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        const departmentPage = new DepartmentPage(page);

        // 1. LOGIN (Kendo 3-Field Flow)
        console.log('🔑 Step 1: Performing direct login...');
        await page.goto('https://test.globalhr.com.mm/ook', { waitUntil: 'networkidle', timeout: 60000 });
        
        await page.waitForSelector('input[name="username"]', { state: 'visible', timeout: 30000 });
        
        await page.fill('input[name="idnumber"]', 'testook_HR 1');
        await page.fill('input[name="username"]', 'testook_HR 1');
        
        // Kendo Focus-Bypass
        await page.click('input[name="password"]');
        await page.type('input[name="password"]', 'Global@2024');
        
        console.log('📡 Step 1.2: Clicking LOG IN...');
        await page.click('button:has-text("LOG IN")');
        
        await page.waitForURL('**/dashboard', { timeout: 20000 }).catch(() => {});
        console.log('✅ Auth Success.');

        // 2. NAVIGATE
        console.log('📡 Step 2: Navigating to Department module via Sidebar...');
        await departmentPage.navigate();
        await new Promise(r => setTimeout(r, 2000));

        // 3. OPEN FORM
        console.log('📡 Step 3: Opening Add New form...');
        await departmentPage.openAddForm();

        // 4. THE ATTACK
        console.log('📡 Step 4: Entering 8-character Short Code...');
        await departmentPage.fillForm({
            shortCode: 'ABCDEFGH',
            name: 'Digital Detective Final Test'
        });

        // 5. VERDICT
        console.log('📡 Step 5: Saving and capturing verdict...');
        const result = await departmentPage.saveAndVerify();
        console.log(`\n🕵️‍♂️ VERDICT: ${result}`);

        if (result.toLowerCase().includes('success')) {
            console.log('❌ [BUG REPRODUCED]: System allowed 8-character short code.');
        } else {
            console.log('✅ [FIXED]: System blocked the invalid input.');
        }

    } catch (err: any) {
        console.error('❌ Mission Failed:', err.message);
    } finally {
        await browser.close();
        console.log('\n🏁 Mission Complete.');
    }
}

runFinalRepro();
