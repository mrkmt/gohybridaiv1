import { chromium } from 'playwright';

async function run() {
    console.log("📸 Starting Final Discovery...");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
        await page.goto('https://test.globalhr.com.mm/ook');
        await page.fill('input[name="idnumber"]', 'testook_HR 1');
        await page.fill('input[name="username"]', 'testook_HR 1');
        await page.click('input[name="password"]');
        await page.type('input[name="password"]', 'Global@2024');
        await page.click('button:has-text("LOG IN")');
        
        await new Promise(r => setTimeout(r, 10000));
        
        // Unstoppable Navigation
        await page.evaluate(() => {
            const master = Array.from(document.querySelectorAll('a,span')).find(el => el.textContent?.trim() === 'Master') as HTMLElement;
            if (master) master.click();
        });
        await new Promise(r => setTimeout(r, 2000));
        
        await page.evaluate(() => {
            const dept = Array.from(document.querySelectorAll('a,span')).find(el => el.textContent?.trim() === 'Department') as HTMLElement;
            if (dept) dept.click();
        });
        await new Promise(r => setTimeout(r, 8000));
        
        console.log("🛰️ Clicking Add New (JS Force)...");
        await page.evaluate(() => (document.querySelector('.k-grid-add') as HTMLElement)?.click());
        await new Promise(r => setTimeout(r, 5000));
        
        console.log("🔎 Mapping Form Fields...");
        const inputs = await page.evaluate(() => 
            Array.from(document.querySelectorAll('input')).map(i => ({
                name: i.name,
                id: i.id,
                control: i.getAttribute('formcontrolname'),
                label: i.closest('kendo-floatinglabel')?.getAttribute('text'),
                isVisible: i.offsetParent !== null
            }))
        );
        
        console.log("📍 FORM FIELDS DISCOVERED:");
        console.log(JSON.stringify(inputs.filter(i => i.isVisible), null, 2));
        
    } catch (err: any) {
        console.error("❌ Discovery Failed:", err.message);
    } finally {
        await browser.close();
    }
}

run();
