/**
 * Live Menu Discovery — Discover ALL modules in a single browser session
 *
 * Flow:
 * 1. Launch browser, log in to GlobalHR
 * 2. Intercept GetUserLevelMenuData API response (contains ALL menus)
 * 3. Auto-confirm EVERY sub-menu as a module in ModuleRegistry
 * 4. Also match any pre-existing draft modules for precise ticket linkage
 *
 * Usage:
 *   cd backend && ts-node --project tsconfig.json scripts/live-menu-discovery.ts
 *
 * Env vars (defaults shown):
 *   BASE_URL=https://test.globalhr.com.mm/ook
 *   TEST_IDNUMBER=testook_HR 1
 *   TEST_USERNAME=testook_HR 1
 *   TEST_PASSWORD=Global@2024
 */

import { chromium, Browser } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config();

import { ModuleRegistry } from '../src/services/ModuleRegistry';

const MENU_API_KEYWORD = 'GetUserLevelMenuData';

// ============================================================================
// Main: Login → Intercept Menu API → Confirm ALL modules
// ============================================================================

async function main(): Promise<void> {
    console.log('\n' + '='.repeat(70));
    console.log('  LIVE MENU DISCOVERY — Auto-confirm ALL modules');
    console.log('='.repeat(70) + '\n');

    const baseUrl = process.env.BASE_URL || 'https://test.globalhr.com.mm/ook';
    const idNumber = process.env.TEST_IDNUMBER || 'testook_HR 1';
    const username = process.env.TEST_USERNAME || 'testook_HR 1';
    const password = process.env.TEST_PASSWORD || 'Global@2024';

    console.log('Environment:');
    console.log(`  Base URL:  ${baseUrl}`);
    console.log(`  Username:  ${username}`);
    console.log(`  Password:  ${'●'.repeat(password.length)}`);

    ModuleRegistry.clearCache();
    const drafts = ModuleRegistry.getAllDrafts();
    if (drafts.length > 0) {
        console.log(`\n  Pre-existing drafts: ${drafts.length}`);
        for (const d of drafts) {
            console.log(`    ${d.ticketId}: "${d.moduleName}"`);
        }
    } else {
        console.log('\n  No pre-existing drafts — will auto-confirm all menu items.');
    }

    let browser: Browser | null = null;
    let interceptedMenuData: any = null;

    try {
        // ─── Step 1: Launch browser + set up interceptor ───
        console.log('\n── Step 1: Browser Login + API Intercept ──\n');
        console.log('Launching Chromium...');
        browser = await chromium.launch({ headless: process.env.PW_DEBUG !== '1' });
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();

        page.on('response', async (response) => {
            if (response.url().includes(MENU_API_KEYWORD) && response.status() === 200) {
                try {
                    interceptedMenuData = await response.json();
                    console.log(`  ✅ Intercepted menu API response`);
                } catch { /* not JSON */ }
            }
        });

        // ─── Step 2: Login ───
        console.log('Navigating to login...');
        const cleanBase = baseUrl.replace(/\/#\/.+$/, '').replace(/\/#$/, '');
        await page.goto(`${cleanBase}#/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2000);

        // Fill ID Number
        const idField = page.locator('input[name="idnumber"], input#idnumber, input#userName').first();
        if (await idField.isVisible({ timeout: 10000 }).catch(() => false)) {
            await idField.fill(idNumber);
            console.log('  ID Number filled');
        }

        // Fill Username
        const userField = page.locator('input[name="username"], input#userName').first();
        if (await userField.isVisible({ timeout: 5000 }).catch(() => false)) {
            await userField.fill(username);
            console.log('  Username filled');
        }

        // Fill Password
        const passField = page.locator('input[name="password"], input#password, input[type="password"]').first();
        await passField.fill(password);
        console.log('  Password filled');

        // Click Login
        const loginBtn = page.locator('button.btn.btn-primary, button#btnLogin, button[type="submit"], button:has-text("LOG IN")').first();
        await loginBtn.click({ timeout: 10000 }).catch(() => {});
        console.log('  Login button clicked');

        // Wait for navigation
        try {
            await page.waitForURL(url => !url.href.includes('/login'), { timeout: 20000 });
            console.log(`  ✅ Login successful → ${page.url()}`);
        } catch {
            console.log(`  ⚠️ Login may have failed → ${page.url()}`);
        }
        await sleep(8000); // Let menu API call fire

        // ─── Step 3: Fallback if not intercepted ───
        if (!interceptedMenuData) {
            console.log('\n  Menu API not intercepted — forcing call...');
            const responsePromise = page.waitForResponse(
                r => r.url().includes(MENU_API_KEYWORD) && r.status() === 200,
                { timeout: 20000 },
            );
            await page.goto(`${cleanBase}#/app.dashboard`, { waitUntil: 'domcontentloaded' });
            try {
                const resp = await responsePromise;
                interceptedMenuData = await resp.json();
                console.log('  ✅ Intercepted menu API after reload');
            } catch {
                // Last resort: direct API call with cookies
                console.log('  Trying direct API call with browser cookies...');
                const cookies = await context.cookies();
                const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                if (cookieHeader.length > 10) {
                    interceptedMenuData = await page.evaluate(async ({ url, cookieHeader }) => {
                        const r = await fetch(url, {
                            method: 'POST',
                            headers: { 'Cookie': cookieHeader, 'Content-Type': 'application/json' },
                        });
                        return r.ok ? r.json() : null;
                    }, { url: `${cleanBase}/v2_2api/api/UserLevel/${MENU_API_KEYWORD}`, cookieHeader });
                    if (interceptedMenuData) console.log('  ✅ Direct API call succeeded');
                }
            }
        }

        if (!interceptedMenuData) {
            console.error('\n❌ ERROR: Could not intercept or fetch menu data.');
            return;
        }

        // ─── Step 4: Parse and confirm ALL modules ───
        console.log('\n── Step 4: Parse Menu Data & Confirm ALL Modules ──\n');

        const rawArray = Array.isArray(interceptedMenuData) ? interceptedMenuData :
            interceptedMenuData?.data ?? interceptedMenuData?.result ?? interceptedMenuData?.menus ?? [];

        if (!Array.isArray(rawArray) || rawArray.length === 0) {
            console.error('⚠️  No menu data in intercepted response.');
            return;
        }

        const mainMenus = rawArray.filter((item: any) => (item.ParentID ?? item.parentId ?? 0) === 0);
        const subMenus = rawArray.filter((item: any) => (item.ParentID ?? item.parentId ?? 0) !== 0);
        console.log(`  Total menu items:  ${rawArray.length}`);
        console.log(`  Main menus:        ${mainMenus.length}`);
        console.log(`  Sub menus (routes):${subMenus.length}`);

        // Save raw menu data
        const menuDataPath = path.join(process.cwd(), 'local_storage', 'intercepted-menu-data.json');
        const saveDir = path.dirname(menuDataPath);
        if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
        fs.writeFileSync(menuDataPath, JSON.stringify(rawArray, null, 2), 'utf8');
        console.log(`  Menu data saved to: ${menuDataPath}`);

        // Build parent lookup
        const parentById = new Map<number, string>();
        for (const item of rawArray) {
            const id = item.MenuID ?? item.menuId ?? 0;
            const name = item.MenuName ?? item.menuName ?? item.Name ?? 'Unknown';
            if ((item.ParentID ?? item.parentId ?? 0) === 0) {
                parentById.set(id, name);
            }
        }

        // Auto-confirm ALL sub-menus as modules
        console.log('\n── Auto-Confirming ALL Sub-Menus as Modules ──\n');
        const allConfirmed: any[] = [];
        let menuCounter = 0;

        for (const item of subMenus) {
            const menuName = item.MenuName ?? item.menuName ?? item.Name ?? 'Unknown';
            const controllerName = item.ControllerName ?? item.controllerName ?? '#';
            const parentId = item.ParentID ?? item.parentId ?? 0;

            // Skip items without routes
            if (controllerName === '#' || !controllerName) continue;

            menuCounter++;
            const parentMenu = parentById.get(parentId) ?? 'Unknown';
            const uiRoute = `#/${controllerName}`;
            const ticketId = `MENU-${String(menuCounter).padStart(3, '0')}`;
            const fullNavigationPath = `${parentMenu} > ${menuName}`;

            ModuleRegistry.confirmFromDiscovery({
                ticketId,
                moduleName: menuName,
                menuName,
                parentMenu,
                uiRoute,
                fullNavigationPath,
            });

            allConfirmed.push({ ticketId, moduleName: menuName, menuName, parentMenu, uiRoute, fullNavigationPath });
        }

        // Also try to match pre-existing drafts for precise ticket linkage
        if (drafts.length > 0) {
            console.log('\n── Matching Pre-Existing Drafts ──\n');
            matchDraftsToMenus(drafts, rawArray);
        }

        // ─── Step 5: Print results ───
        console.log('\n' + '─'.repeat(95));
        console.log(`  DISCOVERED & CONFIRMED: ${allConfirmed.length} MODULES`);
        console.log('─'.repeat(95));
        console.log(`  ${'Ticket'.padEnd(12)} ${'Module'.padEnd(28)} ${'Parent Menu'.padEnd(22)} ${'Route'}`);
        console.log('─'.repeat(95));

        for (const r of allConfirmed) {
            console.log(`  ${r.ticketId.padEnd(12)} ${r.moduleName.padEnd(28)} ${r.parentMenu.padEnd(22)} ${r.uiRoute}`);
        }

        console.log('─'.repeat(95));

        // Verification
        console.log('\n  Verification (reading back from ModuleRegistry):');
        ModuleRegistry.clearCache();
        let verifiedCount = 0;
        for (const r of allConfirmed) {
            const resolved = ModuleRegistry.resolve(r.ticketId);
            const status = resolved?.confirmed ? '✅' : '❌';
            if (resolved?.confirmed) verifiedCount++;
            console.log(`    ${status} ${r.ticketId} (${r.moduleName}) → ${r.uiRoute}`);
        }

        const totalConfirmed = ModuleRegistry.getAllConfirmed().length;
        const totalDrafts = ModuleRegistry.getAllDrafts().length;
        console.log(`\n  SUMMARY:`);
        console.log(`    Newly confirmed:  ${allConfirmed.length}`);
        console.log(`    Verified:         ${verifiedCount}/${allConfirmed.length}`);
        console.log(`    Total in registry: ${totalConfirmed} confirmed, ${totalDrafts} drafts`);
        console.log('\n' + '='.repeat(70));
        console.log('  DISCOVERY COMPLETE');
        console.log('='.repeat(70) + '\n');

    } catch (error: any) {
        console.error('\n❌ Discovery failed:', error.message);
    } finally {
        if (browser) {
            console.log('Closing browser...');
            await browser.close();
        }
    }
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Match draft module names against raw menu data and confirm matches.
 */
function matchDraftsToMenus(
    drafts: Array<{ ticketId: string; moduleName: string; menuName?: string }>,
    rawMenuData: any[],
): void {
    // Build parent lookup
    const parentById = new Map<number, string>();
    for (const item of rawMenuData) {
        const id = item.MenuID ?? item.menuId ?? 0;
        const name = item.MenuName ?? item.menuName ?? item.Name ?? 'Unknown';
        if ((item.ParentID ?? item.parentId ?? 0) === 0) {
            parentById.set(id, name);
        }
    }

    // Build searchable menu list (only sub-menus with routes)
    const menus: any[] = [];
    for (const item of rawMenuData) {
        const parentId = item.ParentID ?? item.parentId ?? 0;
        const controllerName = item.ControllerName ?? item.controllerName ?? '#';
        if (parentId === 0 || controllerName === '#' || !controllerName) continue;
        menus.push({
            menuName: item.MenuName ?? item.menuName ?? item.Name ?? 'Unknown',
            parentMenu: parentById.get(parentId) ?? 'Unknown',
            route: `#/${controllerName}`,
        });
    }

    let matchCount = 0;
    for (const draft of drafts) {
        const searchTerms = [
            draft.moduleName.toLowerCase(),
            ...(draft.menuName ? [draft.menuName.toLowerCase()] : []),
            ...draft.moduleName.split(/[\s\-_]+/).map((w: string) => w.toLowerCase()).filter((w: string) => w.length > 3),
        ];

        let bestMatch: any = null;
        let bestScore = 0;

        for (const menu of menus) {
            const menuText = `${menu.menuName} ${menu.parentMenu} ${menu.route}`.toLowerCase();
            let score = 0;
            for (const term of searchTerms) {
                if (menuText.includes(term)) {
                    score += term.length > 5 ? 3 : term.length > 3 ? 2 : 1;
                }
            }
            if (draft.menuName && menu.menuName.toLowerCase() === draft.menuName.toLowerCase()) score += 10;
            if (score > bestScore) { bestScore = score; bestMatch = menu; }
        }

        if (bestScore >= 3 && bestMatch) {
            ModuleRegistry.confirmFromDiscovery({
                ticketId: draft.ticketId,
                moduleName: draft.moduleName,
                menuName: bestMatch.menuName,
                parentMenu: bestMatch.parentMenu,
                uiRoute: bestMatch.route,
                fullNavigationPath: `${bestMatch.parentMenu} > ${bestMatch.menuName}`,
            });
            console.log(`  ✅ ${draft.ticketId} "${draft.moduleName}" → "${bestMatch.menuName}" (${bestMatch.route})`);
            matchCount++;
        } else {
            console.log(`  ❌ ${draft.ticketId} "${draft.moduleName}" — no match (score: ${bestScore})`);
        }
    }

    console.log(`\n  Draft matches: ${matchCount}/${drafts.length}`);
}

// ============================================================================
// Run
// ============================================================================

main()
    .then(() => {
        console.log('🏁 Menu discovery complete.');
        process.exit(0);
    })
    .catch(err => {
        console.error('\n💥 Fatal error:', err.message);
        process.exit(1);
    });
