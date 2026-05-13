import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://test.globalhr.com.mm/ook#/login');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'login_page.png', fullPage: true });
  console.log('Screenshot saved to login_page.png');
  
  // Also log the input names
  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input')).map(i => ({
      name: i.getAttribute('name'),
      id: i.getAttribute('id'),
      type: i.getAttribute('type'),
      placeholder: i.getAttribute('placeholder')
    }));
  });
  console.log('Inputs:', JSON.stringify(inputs, null, 2));
  
  await browser.close();
}

run().catch(console.error);
