/**
 * MenuDrivenNavigationService
 *
 * Implements the "Real Flow" discovered in HAR files:
 * 1. Fetch GetUserLevelMenuData
 * 2. Fetch GetEmployeeTreeViewSetupByViewMenu (The real "GetMenuUrl" logic)
 * 3. Construct precise #/app.<controller> URL
 */

import { Page } from '@playwright/test';
import { healedClick, waitForAngularStable } from '../../tests/playwright/playwright-self-healing';

export interface MenuItem {
    menuId: string | number;
    menuName: string;
    menuUrl: string;
    controllerName?: string;
    parentMenuId: string | number | null;
    children?: MenuItem[];
}

/**
 * Fetch the real menu tree.
 */
export async function fetchMenuData(page: Page, apiBaseUrl: string): Promise<MenuItem[]> {
    let apiDomain: string;
    try {
        const origin = new URL(apiBaseUrl).origin;
        // Logic: if URL contains 'test.globalhr', ensure api subdomain is used
        apiDomain = origin.includes('test.globalhr') 
            ? origin.replace('test.globalhr', 'apitest.globalhr') 
            : origin;
    } catch {
        apiDomain = apiBaseUrl;
    }
    
    const url = `${apiDomain.replace(/\/$/, '')}/v2_2api/api/UserLevel/GetUserLevelMenuData`;
    console.log(`[MenuNav] Fetching menu tree from: ${url}`);

    return await page.evaluate(async (endpoint: any) => {
        try {
            const r = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}'
            });
            const json = await r.json();
            return Array.isArray(json) ? json : (json.data || json.result || []);
        } catch { return []; }
    }, url);
}

/**
 * Resolves the real application URL using the EmployeeTreeView API (The Real "GetMenuUrl").
 */
export async function ResolveRealMenuUrl(page: Page, apiBaseUrl: string, menuId: string | number): Promise<string | null> {
    let apiDomain: string;
    try {
        const origin = new URL(apiBaseUrl).origin;
        apiDomain = origin.includes('test.globalhr') 
            ? origin.replace('test.globalhr', 'apitest.globalhr') 
            : origin;
    } catch {
        apiDomain = apiBaseUrl;
    }
    
    const url = `${apiDomain.replace(/\/$/, '')}/v2_2api/api/EmployeeSetUpWeb/GetEmployeeTreeViewSetupByViewMenu`;

    console.log(`[MenuNav] Resolving real URL for MenuID: ${menuId} via TreeView API...`);

    const result = await page.evaluate(async ({endpoint, id}: {endpoint: any, id: any}) => {
        try {
            const r = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ menuId: id })
            });
            const json = await r.json();
            const data = Array.isArray(json) ? json[0] : (json.data?.[0] || json.result?.[0]);
            return data?.controllerName || data?.menuUrl || null;
        } catch { return null; }
    }, { endpoint: url, id: menuId });

    return result ? (result.startsWith('app.') ? `#/${result}` : `#/app.${result}`) : null;
}

/**
 * FULL REAL FLOW NAVIGATION
 */
export async function navigateViaMenu(page: Page, apiBaseUrl: string, targetUrl: string, targetName?: string): Promise<{ success: boolean; method: string }> {
    try {
        const cleanBase = apiBaseUrl.replace(/\/#\/.+$/, '').replace(/\/#$/, '').replace(/\/$/, '');
        
        // 1. Get Menu Tree
        const menus = await fetchMenuData(page, apiBaseUrl);
        
        // 2. Find Menu Object
        const nameLower = (targetName || '').toLowerCase().replace(/\s+/g, '');
        const findRecursive = (items: MenuItem[]): MenuItem | null => {
            for (const item of items) {
                if ((item.menuName || '').toLowerCase().replace(/\s+/g, '').includes(nameLower)) return item;
                if (item.children) {
                    const found = findRecursive(item.children);
                    if (found) return found;
                }
            }
            return null;
        };
        const menuObj = findRecursive(menus);

        if (menuObj) {
            // 3. Resolve Real URL via TreeView API
            const realPath = await ResolveRealMenuUrl(page, apiBaseUrl, menuObj.menuId);
            if (realPath) {
                const finalUrl = `${cleanBase}/${realPath.replace(/^\//, '')}`.replace(/\/+#/, '#');
                console.log(`[MenuNav] ✅ Real Flow Success: ${finalUrl}`);
                await page.goto(finalUrl, { waitUntil: 'networkidle' });
                return { success: true, method: 'real-flow-api' };
            }
        }

        // Fallback
        console.log(`[MenuNav] ⚠️ Real flow failed, using direct hash: ${targetUrl}`);
        await page.goto(`${cleanBase}/${targetUrl.replace(/^\//, '')}`.replace(/\/+#/, '#'), { waitUntil: 'networkidle' });
        return { success: true, method: 'direct-hash' };
    } catch (err) {
        return { success: false, method: 'error' };
    }
}
