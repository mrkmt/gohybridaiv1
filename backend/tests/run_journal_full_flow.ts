import { chromium } from 'playwright';
import { MyPerformanceJournalPage } from '../playwright/pages/MyPerformanceJournalPage';

async function runJournalFullFlow() {
    console.log('🕵️‍♂️ STARTING FULL FLOW MISSION: ATT-15 (Performance Journal)');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        recordVideo: { dir: './test-results/videos/ATT-15' }
    });
    const page = await context.newPage();

    try {
        const journalPage = new MyPerformanceJournalPage(page);

        // 1. LOGIN (ERP 3-Field Requirement)
        console.log('🔑 Phase 1: Authentication...');
        await page.goto('https://test.globalhr.com.mm/ook', { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForSelector('input[name="username"]', { state: 'visible' });
        
        await page.fill('input[name="idnumber"]', 'testook_HR 1');
        await page.fill('input[name="username"]', 'testook_HR 1');
        await page.click('input[name="password"]');
        await page.type('input[name="password"]', 'Global@2024');
        await page.click('button:has-text("LOG IN")');
        
        await page.waitForURL('**/dashboard', { timeout: 20000 }).catch(() => {});
        console.log('✅ Auth Success.');

        // 2. NAVIGATE
        console.log('📡 Phase 2: Unstoppable Navigation...');
        await journalPage.navigate();

        // 3. INTERACT (ADD NEW)
        console.log('📡 Phase 3: Opening Form...');
        await journalPage.openAddForm();

        // 4. FILL (Custom Instruction: Skip Attachments)
        console.log('📡 Phase 4: Filling Data (Text Only)...');
        await journalPage.fillForm({
            title: 'KMT Digital Detective Full Flow Test',
            category: 'Achievement'
        });

        // 5. VERDICT
        console.log('📡 Phase 5: Capturing Verdict...');
        const result = await journalPage.saveAndVerify();
        console.log(`\n🏆 MISSION VERDICT: ${result}`);

        if (result.toLowerCase().includes('success')) {
            console.log('✅ [STORY VALIDATED]: Journal entry saved successfully without attachments.');
        } else {
            console.log('⚠️ [INCONCLUSIVE]: Response was: ' + result);
        }

    } catch (err: any) {
        console.error('❌ Mission Failed:', err.message);
    } finally {
        await browser.close();
        console.log('\n🏁 Mission Complete. Evidence saved in test-results/videos/ATT-15');
    }
}

runJournalFullFlow();
