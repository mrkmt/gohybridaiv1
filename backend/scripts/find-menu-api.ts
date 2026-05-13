const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const apiCalls = [];
    page.on('request', r => {
        if (r.url().includes('/api/') || r.url().includes('/v2_')) {
            apiCalls.push({ method: r.method(), url: r.url() });
        }
    });
    console.log('Logging in...');
    await page.goto('https://test.globalhr.com.mm/ook#/login', { waitUntil: 'networkidle', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));
    await page.locator('input').nth(0).fill('testook_HR 1');
    await page.locator('input').nth(1).fill('testook_HR 1');
    const passField = page.locator('input[type="password"]');
    await passField.click();
    await new Promise(r => setTimeout(r, 500));
    await passField.fill(process.env.TEST_PASSWORD || '');
    await page.locator('button:has-text("LOG IN")').click();
    await page.waitForURL(url => !url.href.includes('/login'), { timeout: 30000 });
    await new Promise(r => setTimeout(r, 8000));
    console.log('Logged in! URL:', page.url());
    console.log('Loading dashboard to trigger menu API...');
    await page.goto('https://test.globalhr.com.mm/ook#/app.dashboard', { waitUntil: 'networkidle', timeout: 30000 });
    await new Promise(r => setTimeout(r, 8000));
    console.log('\nTotal API calls:', apiCalls.length);
    const uniqueApis = [...new Set(apiCalls.map(c => c.url.split('?')[0]))];
    console.log('Unique API endpoints:');
    uniqueApis.forEach(u => console.log('  ' + u));
    const menuCalls = apiCalls.filter(c =>
        c.url.toLowerCase().includes('menu') ||
        c.url.toLowerCase().includes('userlevel') ||
        c.url.toLowerCase().includes('permission') ||
        c.url.toLowerCase().includes('role') ||
        c.url.toLowerCase().includes('access')
    );
    console.log('\nMenu/permission-related calls:', menuCalls.length);
    menuCalls.forEach(c => console.log('  ' + c.method + ' ' + c.url));
    if (menuCalls.length === 0) {
        console.log('No menu API calls detected. Full endpoint list:');
        uniqueApis.forEach(u => console.log('  ' + u));
    }
    await browser.close();
    console.log('\nDone!');
})().catch(console.error);
