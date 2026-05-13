import { test, expect } from '@playwright/test';
import { performLogin } from './login-helper';
import { TESTING_CREDENTIALS } from './test-credentials';

test('Verify Department Modal Inputs', async ({ page }) => {
    await performLogin(page, TESTING_CREDENTIALS);
    
    console.log('Navigating to Department...');
    const masterMenu = page.locator('span.text-truncate.d-inline-block', { hasText: /^Master$/ }).first();
    await masterMenu.click();
    await page.waitForTimeout(2000);
    
    const deptSubMenu = page.locator('a.list-group-item.text-truncate', { hasText: /^Department$/ }).first();
    await deptSubMenu.click();
    await page.waitForTimeout(5000);
    
    console.log('Clicking Add New...');
    await page.click('button[ngbtooltip="Add New"]');
    await page.waitForTimeout(3000); // Wait for modal

    const inputs = await page.evaluate(() => {
        const ins = Array.from(document.querySelectorAll('input, textarea, select'));
        return ins.map(i => ({
            tag: i.tagName,
            type: (i as HTMLInputElement).type,
            name: i.getAttribute('name'),
            fcn: i.getAttribute('formcontrolname') || i.getAttribute('formControlName'),
            placeholder: (i as HTMLInputElement).placeholder,
            visible: (i as HTMLElement).offsetParent !== null,
            id: i.id
        })).filter(i => i.visible);
    });

    console.log('Visible Inputs:', JSON.stringify(inputs, null, 2));
});
