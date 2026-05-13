/**
 * Menu Discovery via Playwright Browser Login
 *
 * 1. Opens browser, logs into GlobalHR
 * 2. Calls GetUserLevelMenuData API with browser cookies
 * 3. Finds the menu item matching our draft module
 * 4. Returns the real navigation URL and path
 */

import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const MENU_API_PATH = '/v2_2api/api/UserLevel/GetUserLevelMenuData';

interface MenuItem {
    menuName: string;
    menuId?: number;
    parentId?: number;
    route?: string;
    controllerName?: string;
    parentMenu?: string;
    permission?: string;
}

async function waitForMs(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log('\n=== Menu Discovery via Browser Login ===\n');

    const baseUrl = process.env.BASE_URL || 'https://test.globalhr.com.mm/ook';
    const idNumber = process.env.TEST_IDNUMBER || 'testook_HR 1';
    const username = process.env.TEST_USERNAME || 'testook_HR 1';
    const password = process.env.TEST_PASSWORD || 'Global@2024';

    // The module we're looking for
    const targetModule = 'Performance Journal';

    console.log('Target Module:', targetModule);
    console.log('Base URL:', baseUrl);
    console.log('Login URL:', baseUrl + '/#/login');

    let browser: Browser | null = null;

    try {
        console.log('\n[1/5] Launching browser...');
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();

        console.log('\n[2/5] Setting up API interceptor...');

        // Set up response waiter BEFORE any navigation
        let menuData: any = null;
        page.on('response', async (response) => {
            if (response.url().includes('GetUserLevelMenuData') && response.status() === 200) {
                try {
                    menuData = await response.json();
                    if (Array.isArray(menuData) && menuData.length > 0) {
                        console.log('  ✅ Captured menu API (' + menuData.length + ' items)');
                    }
                } catch { /* ignore */ }
            }
        });

        console.log('[3/5] Logging in...');
        const fullLoginUrl = `${baseUrl}#/login`;
        console.log('  Full login URL:', fullLoginUrl);
        await page.goto(fullLoginUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await waitForMs(8000);

        const allInputs = page.locator('input');
        try { await allInputs.nth(0).fill(idNumber, { timeout: 15000 }); } catch {}
        try { await allInputs.nth(1).fill(username, { timeout: 15000 }); } catch {}
        const passField = page.locator('input[type="password"]');
        try {
            await passField.click({ timeout: 15000 });
            await waitForMs(500);
            await passField.fill(password, { timeout: 15000 });
        } catch {}
        try { await page.locator('button:has-text("LOG IN")').click({ timeout: 15000 }); } catch {}
        await page.waitForURL(url => !url.href.includes('/login'), { timeout: 30000 });
        await waitForMs(8000);

        console.log('  Logged in! URL:', page.url());

        // Menu data should have been captured during login
        console.log('\n[4/5] Checking captured menu data...');

        if (!menuData) {
            console.log('  ⚠️ Menu API not captured during login');
            console.log('  Navigating to force menu reload...');

            // Set up another waiter
            const menuWaiter = page.waitForResponse(
                r => r.url().includes('GetUserLevelMenuData') && r.status() === 200,
                { timeout: 20000 }
            );

            // Clear storage to force fresh menu load
            await page.evaluate(() => {
                sessionStorage.clear();
                localStorage.clear();
            });
            await page.goto(`${baseUrl}#/app.dashboard`, { waitUntil: 'domcontentloaded' });

            try {
                const resp = await menuWaiter;
                menuData = await resp.json();
                console.log('  ✅ Captured menu API after reload (' + (Array.isArray(menuData) ? menuData.length : 'object') + ')');
            } catch {
                console.log('  ⚠️ Still not captured');
            }
        }

        if (!menuData) {
            console.log('  ⚠️ Could not retrieve menu data');
            console.log('\n=== Done ===\n');
            await browser.close();
            return;
        }

        console.log('\n[5/5] Searching for menu item...');

        // Parse menu data with correct structure:
        // MainMenu: ParentID=0, ControllerName="#" (no route)
        // SubMenu: ParentID=38, ControllerName="app.grade" → route: /#/app.grade
        function flattenMenus(items: any[]): MenuItem[] {
            const result: MenuItem[] = [];
            for (const item of items) {
                const menuName = item.MenuName || item.menuName || item.Name || 'Unknown';
                const controllerName = item.ControllerName || item.controllerName || '#';
                const parentId = item.ParentID || item.parentId || 0;
                const menuId = item.MenuID || item.menuId || 0;
                
                // Route comes from ControllerName (if not "#")
                // Format: #/app.grade (NO leading slash — app URL is domain/ook#/route)
                const route = controllerName !== '#' && controllerName ? `#/${controllerName}` : undefined;
                
                // Find parent menu name by looking up ParentID
                let parentMenu: string | undefined;
                if (parentId !== 0) {
                    const parent = items.find(p => (p.MenuID || p.menuId || 0) === parentId);
                    if (parent) {
                        parentMenu = parent.MenuName || parent.menuName || parent.Name;
                    }
                }
                
                const menuItem: MenuItem = {
                    menuName,
                    menuId,
                    parentId,
                    route,
                    controllerName,
                    parentMenu,
                    permission: item.Permission || '',
                };
                result.push(menuItem);
            }
            return result;
        }

        const md = menuData as any;
        const rawArray = Array.isArray(md) ? md : md?.data ?? md?.result ?? md?.menus ?? [];

        if (Array.isArray(rawArray) && rawArray.length > 0) {
            const flatMenus = flattenMenus(rawArray);
            console.log('  Total menu items:', flatMenus.length);

            // Count main menus vs sub menus
            const mainMenus = flatMenus.filter(m => m.parentId === 0);
            const subMenus = flatMenus.filter(m => m.parentId !== 0);
            console.log('  Main menus (ParentID=0):', mainMenus.length);
            console.log('  Sub menus:', subMenus.length);

            // Search for target module
            const searchTerm = targetModule.toLowerCase();
            const matches = flatMenus.filter(m =>
                m.menuName.toLowerCase().includes(searchTerm) ||
                (m.controllerName && m.controllerName.toLowerCase().includes('performance')) ||
                (m.route && m.route.toLowerCase().includes('journal'))
            );

            if (matches.length > 0) {
                console.log('\n✅ Found matching menu items:\n');
                for (const match of matches) {
                    console.log('  Menu:', match.menuName);
                    console.log('  MenuID:', match.menuId);
                    console.log('  ParentID:', match.parentId);
                    console.log('  Parent Menu:', match.parentMenu || 'N/A (top-level)');
                    console.log('  ControllerName:', match.controllerName || '#');
                    console.log('  Route:', match.route || 'N/A (top-level menu)');
                    console.log('  Full URL:', match.route ? `${baseUrl}${match.route}` : 'N/A');
                    console.log('  Permission:', match.permission || 'N/A');
                    console.log('');
                }

                // Save the confirmed module info
                const firstMatch = matches[0];
                console.log('✅ Module confirmed in user menu!');
                console.log('   Module Name:', firstMatch.menuName);
                console.log('   Parent Menu:', firstMatch.parentMenu || 'root');
                console.log('   Controller:', firstMatch.controllerName);
                console.log('   Route:', firstMatch.route || 'Will use module knowledge file URL');
                console.log('   Full URL:', firstMatch.route ? `${baseUrl}${firstMatch.route}` : 'N/A');
                console.log('   Navigation:', firstMatch.parentMenu ? `${firstMatch.parentMenu} > ${firstMatch.menuName}` : firstMatch.menuName);
            } else {
                console.log('\n⚠️ No menu items match "', targetModule, '"');
                console.log('\n  First 15 menu items:');
                flatMenus.slice(0, 15).forEach(m => {
                    console.log(`    - "${m.menuName}" (parent: ${m.parentMenu || 'root'}, controller: ${m.controllerName || '#'})`);
                });
            }

            // Save full menu data for debugging
            const menuOutputPath = path.join(__dirname, '..', 'local_storage', 'full-menu-data.json');
            fs.writeFileSync(menuOutputPath, JSON.stringify({ total: flatMenus.length, menus: flatMenus }, null, 2), 'utf8');
            console.log('\n  Full menu data saved to:', menuOutputPath);

        } else {
            console.log('  ⚠️ No menu data returned. Response structure:', JSON.stringify(menuData).substring(0, 300));
        }

        console.log('\n=== Done ===\n');

    } catch (error: any) {
        console.error('❌ Error:', error.message);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

main().catch(console.error);
