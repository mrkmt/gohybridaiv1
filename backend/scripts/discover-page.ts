/**
 * discover-page.ts
 *
 * Standalone script: logs into test.globalhr.com.mm with the baseline account
 * and discovers all elements on a specified page.
 *
 * Usage:
 *   npx ts-node scripts/discover-page.ts                              # discovers Designation page
 *   npx ts-node scripts/discover-page.ts "#/app.department" Department # discovers Department page
 *   npx ts-node scripts/discover-page.ts "#/app.employee" Employee     # discovers Employee page
 *   npx ts-node scripts/discover-page.ts --deep "#/app.designation" Designation # deep scans (tabs, modals)
 */

import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { TESTING_CREDENTIALS } from '../tests/playwright/test-credentials';
import { PageElementDiscoveryService, PageInventory } from '../src/services/discovery/PageElementDiscoveryService';
import { BrowserSessionManager } from '../src/services/discovery/BrowserSessionManager';
import { appLogger } from '../src/utils/logger';

/**
 * Returns true when the given URL's hash fragment is the login route.
 * Uses exact hash comparison to avoid false-positives from routes that
 * contain the substring "/login" (e.g. "#/app.loginhistory").
 */
function isLoginRoute(url: string): boolean {
  try {
    const hash = new URL(url).hash.toLowerCase();
    return hash === '#/login' || hash.startsWith('#/login?') || hash.startsWith('#/login/') || url.toLowerCase().includes('/login');
  } catch {
    return url.toLowerCase().includes('/login'); // fallback
  }
}

/**
 * Waits deterministically for the page to either show the login form or settle
 * on an authenticated module page. Returns true if the login form is visible.
 * Use this instead of flat waitForTimeout after navigating to a target URL.
 */
async function detectLoginRedirect(page: Page, waitMs = 12_000): Promise<boolean> {
  return page.waitForSelector('input[type="password"]', { timeout: waitMs })
    .then(() => true)   // login form appeared → session expired / not authenticated
    .catch((err: any) => {
      if (!err?.message?.includes('Timeout')) throw err;
      return false;     // no login form → page loaded successfully
    });
}

// Module route map — known routes for GlobalHR
export const MODULE_ROUTES: Array<[string, string]> = [
    // ── HR Setup ──────────────────────────────────────────────────────────────
    ['#/app.designation',          'Designation'],
    ['#/app.department',           'Department'],
    ['#/app.grade',                'Grade'],
    ['#/app.section',              'Section'],
    ['#/app.division',             'Division'],
    ['#/app.group',                'Group'],
    ['#/app.costCenter',           'Cost Center'],
    ['#/app.location',             'Location'],
    ['#/app.company',              'Company Profile'],
    ['#/app.teamsetup',            'Team Setup'],
    ['#/app.labelsetup',           'Label Setup'],
    ['#/app.keywordsetup',         'Keyword'],
    ['#/app.publicHoliday',        'Public Holiday'],
    ['#/app.gpsLocation',          'GPS Location'],
    ['#/app.shift',                'Shift'],
    ['#/app.alternativeworkday',   'Alternative Work Day'],

    // ── Employee ──────────────────────────────────────────────────────────────
    ['#/app.employee',             'Employee'],
    ['#/app.employeeDocument',     'Employee Document'],
    ['#/app.employeePolicy',       'Employee Policy'],
    ['#/app.employeeResignation',  'Employee Resignation'],
    ['#/app.employeeAS',           'Employee Additional Setup'],
    ['#/app.bankInfo',             'Bank Info'],
    ['#/app.userEmployeeAccess',   'User Employee Access'],
    ['#/app.contractemployee',     'Contract Employee'],
    ['#/app.transfer',             'Transfer'],

    // ── Leave ─────────────────────────────────────────────────────────────────
    ['#/app.leaveType',            'Leave Type'],
    ['#/app.leavepolicy',          'Leave Policy'],
    ['#/app.groupPolicy',          'Group Policy'],
    ['#/app.leaveRequest',         'Leave Request'],
    ['#/app.leaveApprove',         'Leave Approve'],
    ['#/app.openingLeaveBalance',  'Opening Leave Balance'],
    ['#/app.generateLeave',        'Generate Leave'],
    ['#/app.leaveBalanceReport',   'Leave Balance Report'],

    // ── Attendance ────────────────────────────────────────────────────────────
    ['#/app.myattendance',         'Time Attendance'],
    ['#/app.attendanceRule',       'Attendance Rule'],
    ['#/app.attendanceRequest',    'Attendance Request'],
    ['#/app.attendanceApprove',    'Attendance Approve'],
    ['#/app.attendanceEditor',     'Attendance Editor'],
    ['#/app.attendanceCalculation','Attendance Calculate'],
    ['#/app.manualAttendance',     'Manual Attendance'],
    ['#/app.dutyRoster',           'Duty Roster'],
    ['#/app.autoShiftAssignment',  'Auto Shift Assignment'],
    ['#/app.generateAttendance',   'Generate Attendance'],
    ['#/app.otRequest',            'OT Request'],
    ['#/app.otApprove',            'OT Approve'],

    // ── Payroll ───────────────────────────────────────────────────────────────
    ['#/app.paymentTitle',         'Payment Title'],
    ['#/app.paymentdefinition',    'Payment Definition'],
    ['#/app.payrollrule',          'Payroll Rule'],
    ['#/app.salaryscale',          'Salary Scale'],
    ['#/app.salaryAdjustment',     'Salary Adjustment'],
    ['#/app.additionNdeduction',   'Addition & Deduction'],
    ['#/app.paymentcalculation',   'Payment Calculation'],
    ['#/app.paymentApprove',       'Payment Approve'],
    ['#/app.loanAdvanceSaving',    'Loan Advance Saving'],

    // ── Appraisal ─────────────────────────────────────────────────────────────
    ['#/app.appraisalcycles',      'Appraisal Cycles'],
    ['#/app.appraisaltemplate',    'Appraisal Templates'],
    ['#/app.appraisaldashboard',   'Appraisal Dashboard'],
    ['#/app.appraisalstatus',      'Appraisal Status'],
    ['#/app.kpimetric',            'KPI Metric'],
    ['#/app.kpiassignment',        'KPI Assignment'],
    ['#/app.kpireport',            'KPI Report'],

    // ── Recruitment ───────────────────────────────────────────────────────────
    ['#/app.jobpostlist',          'Job Post List'],
    ['#/app.candidateList',        'Candidate List'],

    // ── Training ──────────────────────────────────────────────────────────────
    ['#/app.coursemanagement',     'Course Management'],
    ['#/app.trainingassignments',  'Training Assignments'],

    // ── User & Access ─────────────────────────────────────────────────────────
    ['#/app.userLevelControl',     'User Level'],
    ['#/app.userLevelAssignment',  'User Level Assignment'],
    ['#/app.approverSetting',      'Approver Setting'],
    ['#/app.approverAssign',       'Approver Assign'],

    // ── Reports ───────────────────────────────────────────────────────────────
    ['#/app.myperformancejournal', 'My Performance Journal'],
    ['#/app.announcement',         'Announcement'],
    ['#/app.customField',          'Custom Field'],
    ['#/app.applicationOption',    'Application Option'],
];

/**
 * Returns true if the current page contains generic dashboard widgets
 * (like the calendar toggle or gadget search) that indicate we've
 * fallen back to the home screen instead of the requested module.
 */
async function detectDashboardFallback(page: Page): Promise<boolean> {
  const dashboardSelectors = [
    'button[aria-label="Toggle calendar"]',
    'input[placeholder="Begin typing gadget name"]',
    '.k-widget.k-chat', // example of a dashboard-only widget
  ];

  for (const sel of dashboardSelectors) {
    if (await page.locator(sel).first().count() > 0) return true;
  }
  return false;
}

/**
 * performLogin
 *
 * Navigates to the app login page and fills credentials if needed.
 * Skips the form entirely when the browser session is already authenticated
 * (URL does not include '/login' after navigation).
 *
 * Throws a descriptive Error on failure so callers get a clear message
 * instead of a generic Playwright timeout.
 */
export async function performLogin(
  page: Page,
  creds: typeof TESTING_CREDENTIALS,
): Promise<void> {
  // Fail fast — validate credentials before touching the network
  if (!creds.username || !creds.password) {
    throw new Error(
      'Discovery login failed: TEST_USERNAME and TEST_PASSWORD are not set. ' +
      'Add them to backend/.env and restart the server.',
    );
  }

  // Navigate with 'load' to ensure all scripts execute and Angular bootstraps
  await page.goto(`${creds.baseUrl}#/login`, { waitUntil: 'load', timeout: 90_000 });

  // Wait deterministically for the password field — Angular renders the full
  // login form (idnumber + username + password) before this element appears.
  // This replaces a flat timeout and adapts to actual render speed.
  // Only swallow TimeoutError (means we're already past login); rethrow
  // network/navigation failures so they surface immediately.
  await page.waitForSelector('input[type="password"]', { timeout: 25_000 }).catch((err: any) => {
    if (!err?.message?.includes('Timeout')) throw err;
    // Timeout: either already authenticated (redirected away) or slow render — handled below
  });

  // Already authenticated — nothing to do
  if (!isLoginRoute(page.url())) {
    appLogger.info('[Discovery] Session still valid — login skipped');
    return;
  }

  appLogger.info('[Discovery] Performing login...');

  try {
    // ID Number field — optional. The field has name="idnumber" in this app.
    // Other environments may omit it; use tryFill so a missing field doesn't abort.
    if (creds.idNumber) {
      const idField = page.locator('input[name="idnumber"]').first();
      const idExists = await idField.count().then((c: number) => c > 0).catch(() => false);
      if (idExists) {
        await idField.fill(creds.idNumber, { timeout: 8_000 }).catch(() => {
          appLogger.warn('[Discovery] idnumber field found but fill timed out — continuing without it');
        });
      } else {
        appLogger.info('[Discovery] idnumber field not present on login page — skipping');
      }
    }

    // Username — required. Use name="username" exclusively to avoid matching the
    // idnumber field (which is also type="text" and appears earlier in the DOM).
    const userField = page.locator('input[name="username"]').first();
    await userField.fill(creds.username, { timeout: 15_000 });

    // Password — required. name="password" is most precise; fallback to type.
    const passField = page.locator('input[name="password"], input[type="password"]').first();
    await passField.click({ timeout: 10_000 });
    await page.waitForTimeout(300);
    await passField.fill(creds.password, { timeout: 10_000 });

    // Submit
    const loginBtn = page
      .locator('button[type="submit"], button:has-text("LOG IN"), button:has-text("Login"), button:has-text("Sign in")')
      .first();
    await loginBtn.click({ timeout: 10_000 });

    // For Angular SPA with hash routing, waitForURL doesn't reliably fire on
    // hash-only route changes. Poll window.location.hash with exact comparison.
    await page.waitForFunction(
      () => {
        const hash = window.location.hash;
        return hash !== '#/login' && !hash.startsWith('#/login?') && !hash.startsWith('#/login/');
      },
      { timeout: 30_000, polling: 500 },
    );
    // Let the dashboard fully render
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1_500);

    appLogger.info('[Discovery] Login successful');
  } catch (err: any) {
    BrowserSessionManager.clearSession();
    throw new Error(
      `Discovery login failed: ${err.message}. ` +
      `Verify TEST_USERNAME / TEST_PASSWORD in backend/.env and that the app is ` +
      `reachable at ${creds.baseUrl}`,
    );
  }
}

async function run(): Promise<void> {
    const args = process.argv.slice(2);
    const deepScan = args.includes('--deep');
    const cleanArgs = args.filter(a => !a.startsWith('--'));

    const hashRoute = cleanArgs[0] || '#/app.designation';
    const moduleName = cleanArgs[1] || 'Designation';

    console.log(`[Discover] Scanning: ${moduleName} (${hashRoute})`);
    console.log(`[Discover] URL: ${TESTING_CREDENTIALS.baseUrl}${hashRoute}`);
    console.log(`[Discover] User: ${TESTING_CREDENTIALS.username}`);
    console.log(`[Discover] Deep scan: ${deepScan ? 'YES' : 'NO'}`);
    console.log('');

    const browser = await chromium.launch({ 
        headless: false,
        args: ['--disable-extensions']
    });

    // Reuse saved session when available — skips login for the CLI run too
    let context = await BrowserSessionManager.tryRestoreContext(browser);
    const sessionWasRestored = !!context;
    if (!context) {
        context = await browser.newContext({
            viewport: { width: 1440, height: 900 },
            recordVideo: { dir: path.join(process.cwd(), 'test-results', 'discovery', 'videos') },
        });
    }

    const page = await context.newPage();

    try {
        // Step 1: Login via shared helper (no-op if session still valid)
        console.log('[Discover] Checking authentication...');
        await performLogin(page, TESTING_CREDENTIALS);
        if (!sessionWasRestored) {
            await BrowserSessionManager.saveContext(context);
        }

        // Step 2: Navigate to target page
        const targetUrl = `${TESTING_CREDENTIALS.baseUrl}${hashRoute}`;
        console.log(`\n[Discover] Navigating to ${moduleName}...`);
        await page.goto(targetUrl, {
            waitUntil: 'commit',
            timeout: 60000,
        });
        await page.waitForTimeout(4_000); // Angular route + data load + loading masks
        console.log(`[Discover] Page loaded: ${page.url()}`);

        // Step 3: Discover elements
        console.log('\n[Discover] Scanning page elements...');
        const inventory = await PageElementDiscoveryService.discoverPage(page, {
            pageName: moduleName,
            section: moduleName,
            deepScan,
        });

        // Step 4: Print summary
        console.log('\n' + '='.repeat(60));
        console.log(`DISCOVERY: ${moduleName}`);
        console.log(`URL: ${inventory.url}`);
        console.log('='.repeat(60));
        console.log(inventory.summary);
        console.log('-'.repeat(60));

        console.log(`\nBUTTONS (${inventory.buttons.length}):`);
        for (const btn of inventory.buttons) {
            console.log(`  "${btn.name}" → ${btn.selector} [enabled=${btn.isEnabled}]`);
            if (btn.altSelectors.length > 0) {
                console.log(`    alt: ${btn.altSelectors.slice(0, 3).join(', ')}`);
            }
        }

        console.log(`\nINPUTS (${inventory.inputs.length}):`);
        for (const inp of inventory.inputs) {
            console.log(`  "${inp.name}" (${inp.type}) → ${inp.selector}`);
        }

        console.log(`\nDROPDOWNS (${inventory.dropdowns.length}):`);
        for (const dd of inventory.dropdowns) {
            console.log(`  "${dd.name}" (${dd.type}) → ${dd.selector}`);
        }

        console.log(`\nGRIDS (${inventory.grids.length}):`);
        for (const grid of inventory.grids) {
            console.log(`  ${grid.selector} [columns: ${grid.columns.length}]`);
            console.log(`    Columns: ${grid.columns.join(', ')}`);
            console.log(`    Kendo: ${grid.isKendo}, Toolbar: ${grid.hasToolbar}, Search: ${grid.hasSearch}, Export: ${grid.hasExport}`);
        }

        if (inventory.pagination) {
            console.log(`\nPAGINATION: ${inventory.pagination.selector}`);
            console.log(`  Has page numbers: ${inventory.pagination.hasPageNumbers}`);
            console.log(`  Has page size: ${inventory.pagination.hasPageSizeSelector}`);
            console.log(`  Has prev/next: ${inventory.pagination.hasNextPrev}`);
        }

        console.log(`\nTABS (${inventory.tabs.length}):`);
        for (const tab of inventory.tabs) {
            console.log(`  Tab strip → ${tab.selector}`);
            console.log(`    Tabs: ${tab.tabs.join(', ')}`);
        }

        console.log(`\nMODALS (${inventory.modals.length}):`);
        for (const modal of inventory.modals) {
            console.log(`  "${modal.title}" → ${modal.selector} [close=${modal.hasCloseButton}]`);
        }

        // Step 5: Save to repository
        const saved = await PageElementDiscoveryService.saveToRepository(inventory, {
            relatedModule: moduleName,
            businessLogicHint: `Auto-discovered from ${moduleName} page`,
        });
        console.log(`\n[Discover] Saved ${saved.saved} elements to repository`);

        // Step 6: Save JSON report
        const reportsDir = path.join(process.cwd(), 'test-results', 'discovery', 'reports');
        fs.mkdirSync(reportsDir, { recursive: true });
        const reportPath = path.join(reportsDir, `${moduleName.toLowerCase()}-${Date.now()}.json`);
        fs.writeFileSync(reportPath, JSON.stringify(inventory, null, 2), 'utf-8');
        console.log(`[Discover] JSON report saved: ${reportPath}`);

        console.log('\n' + '='.repeat(60));
        console.log('DISCOVERY COMPLETE');
        console.log('='.repeat(60));

    } catch (err: any) {
        console.error(`[Discover] FAILED: ${err.message}`);
        console.error(err.stack);
    } finally {
        await browser.close();
    }
}

// ---- Module-level exports for API controller ----

export interface ModuleDiscovery {
    moduleName: string;
    hashRoute: string;
    inventory: PageInventory | null;
    error?: string;
}

/**
 * Navigate to a module by clicking its sidebar/menu link instead of a direct goto().
 *
 * Why: Some Angular modules (e.g. Performance Journal) only render their full
 * toolbar — including the Add Entry button — when the Angular router transition
 * is triggered by a real menu click. Direct hash navigation (`page.goto`) bypasses
 * this transition and the module renders without the toolbar buttons.
 *
 * Falls back to direct goto() when no sidebar link is found.
 */
async function navigateViaMenu(
    page: Page,
    hashRoute: string,
    moduleName: string,
    creds: typeof TESTING_CREDENTIALS,
): Promise<void> {
    appLogger.info(`[Forensic] Attempting sidebar navigation for "${moduleName}"...`);
    
    // Step 0: Ensure we are at the app root (Sidebar is only on main app pages)
    if (page.url().includes('/login')) {
        await page.goto(creds.baseUrl, { waitUntil: 'load' });
    }

    const targetHash = hashRoute.toLowerCase().replace(/^#/, '');

    // Attempt to find a sidebar/menu link whose text matches the module name.
    const textVariants = [
        moduleName,
        // Strip common suffixes/prefixes that may differ in the menu
        moduleName.replace(/\s+(Module|Management|Request|Approve|Report|Setup|Setting)$/i, '').trim(),
    ];

    // Parent categories that might need expanding
    const parentCategories = [
        'Master', 'Setup', 'Employee', 'Time Attendance', 'Human Resource', 
        'Payroll Management', 'User Level Management', 'System', 'Report', 
        'Recruitment', 'Claim', 'Performance Appraisal', 'Daily Tasks'
    ];

    for (const text of textVariants) {
        const linkSelector = `.k-drawer a:has-text("${text}"), nav a:has-text("${text}"), li a:has-text("${text}"), .k-link:has-text("${text}")`;
        const link = page.locator(linkSelector).first();

        if (await link.count() > 0) {
            const isVisible = await link.isVisible();
            if (!isVisible) {
                appLogger.info(`[Forensic] Link "${text}" found but hidden. Expanding parents...`);
                // Try to find and click parent buttons in the sidebar
                for (const parent of parentCategories) {
                    const parentBtn = page.locator(`button:has-text("${parent}")`).first();
                    if (await parentBtn.count() > 0) {
                        await parentBtn.click().catch(() => {});
                        await page.waitForTimeout(300);
                        if (await link.isVisible()) break;
                    }
                }
            }

            if (await link.isVisible()) {
                appLogger.info(`[Discovery] Clicking sidebar link for "${moduleName}"`);
                await link.click({ timeout: 5_000 });

                // Wait for the Angular hash route to settle
                await page.waitForFunction(
                    (h: string) => window.location.hash.toLowerCase().includes(h),
                    targetHash,
                    { timeout: 15_000, polling: 300 },
                ).catch(() => {
                    appLogger.warn(`[Forensic] URL did not change to ${targetHash} after click, but continuing...`);
                });
                
                return;
            }
        }
    }

    // Fallback: direct hash navigation
    appLogger.info(`[Forensic] No visible sidebar link found for "${moduleName}". Falling back to direct goto.`);
    const targetUrl = `${creds.baseUrl}${hashRoute}`;
    await page.goto(targetUrl, { waitUntil: 'load', timeout: 60_000 });
    
    // CRITICAL: Wait for the Dashboard widgets to DISAPPEAR if we are not on the dashboard
    if (!moduleName.toLowerCase().includes('dashboard')) {
        await page.waitForFunction(
            () => !document.querySelector('button[aria-label="Toggle calendar"]'),
            { timeout: 10_000 }
        ).catch(() => {
            appLogger.warn(`[Forensic] Dashboard widgets still present after navigating to ${moduleName}`);
        });
    }
}

/**
 * Wait for a Kendo grid to have at least one data row, or timeout gracefully.
 * Prevents capturing elements before the API data has loaded into the grid.
 */
async function waitForGridData(page: Page, moduleName: string, timeoutMs = 15_000): Promise<void> {
    await page.waitForFunction(
        () => {
            const grid = document.querySelector('.k-grid, kendo-grid');
            if (!grid) return true; // no grid on this page — proceed immediately
            // Any visible data row (not the loading placeholder row)
            const rows = grid.querySelectorAll(
                'tbody > tr:not(.k-loading-color-row):not(.k-no-data)'
            );
            return rows.length > 0;
        },
        { timeout: timeoutMs, polling: 500 },
    ).catch(() => {
        appLogger.info(`[Discovery] No grid data rows loaded for "${moduleName}" within ${timeoutMs}ms — proceeding`);
    });
}

/**
 * Discover a single page. Returns structured inventory.
 * Caller is responsible for browser lifecycle.
 */
export async function discoverSinglePage(
    hashRoute: string,
    moduleName: string,
    options?: {
        deepScan?: boolean;
        headless?: boolean;
        credentials?: typeof TESTING_CREDENTIALS;
    }
): Promise<PageInventory | null> {
    const creds = options?.credentials || TESTING_CREDENTIALS;
    const browser = await chromium.launch({ 
        headless: options?.headless ?? true,
        args: ['--disable-extensions']
    });
    const isDashboardModule = moduleName.toLowerCase().includes('dashboard');

    // Attempt to restore a previously saved authenticated session.
    // If successful, the login step is skipped entirely — saving ~10-15 s.
    let context = await BrowserSessionManager.tryRestoreContext(browser);
    const sessionWasRestored = !!context;

    if (!context) {
        context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    }

    const page = await context.newPage();
    const targetUrl = `${creds.baseUrl}${hashRoute}`;

    try {
        if (sessionWasRestored) {
            // ── Session-first path ────────────────────────────────────────────
            // Navigate to the app root first so the sidebar renders, then click the
            // sidebar link to trigger proper Angular router events. If the restored
            // session has expired, the root will redirect to /login.
            appLogger.info(`[Discovery] Restored session — navigating to app root for sidebar click`);
            await page.goto(creds.baseUrl, { waitUntil: 'load', timeout: 60_000 });

            const sessionExpired = await detectLoginRedirect(page, 12_000);

            if (sessionExpired) {
                appLogger.warn('[Discovery] Restored session expired — performing fresh login');
                BrowserSessionManager.clearSession();
                await performLogin(page, creds);
                await BrowserSessionManager.saveContext(context);
            } else {
                appLogger.info('[Discovery] Session valid — login skipped ✅');
            }
        } else {
            // ── Fresh-login path ──────────────────────────────────────────────
            await performLogin(page, creds);
            await BrowserSessionManager.saveContext(context);
        }

        // Step 2: Navigate to the module via sidebar click (V2) so Angular's router
        // transition fires fully — this renders toolbar buttons like "Add Entry" that
        // only appear after a real routing event, not a direct page.goto().
        await navigateViaMenu(page, hashRoute, moduleName, creds);

        // Final guard — permission or wrong route
        const currentUrl = page.url();

        if (isLoginRoute(currentUrl) || currentUrl.includes('not-found')) {
            throw new Error(
                `Module "${moduleName}" is not accessible (ended at ${currentUrl}). ` +
                `Verify the route ${hashRoute} and that the test account has access.`,
            );
        }

        // Step 3: Wait for content AND grid data to load.
        // First wait for any grid/toolbar element to appear in the DOM.
        await page.waitForSelector(
            'kendo-grid, .k-grid, .k-toolbar, [role="grid"], .k-button-group',
            { timeout: 12_000 }
        ).catch(() => {
            appLogger.info(`[Discover] No grid found for "${moduleName}" after 12s — proceeding with form elements`);
        });
        // Then poll for grid rows — ensures API data is loaded before we scan buttons.
        await waitForGridData(page, moduleName);

        // Step 4: Discover page elements
        const inventory = await PageElementDiscoveryService.discoverPage(page, {
            pageName: moduleName,
            section: moduleName,
            deepScan: options?.deepScan ?? false,
        });

        // FINAL VALIDATION: If we are NOT requesting the Dashboard, but the inventory
        // contains dashboard-only elements, then a silent fallback occurred.
        // We do this check AFTER discovery because some widgets take time to render.
        if (!isDashboardModule && inventory) {
            const hasDashboardWidgets = inventory.buttons.some(b => b.name === 'Toggle calendar') ||
                                        inventory.inputs.some(i => i.name === 'Begin typing gadget name');

            if (hasDashboardWidgets) {
                appLogger.warn(`[Discover] Discovery mismatch for ${moduleName}: Dashboard widgets detected. Clearing session.`);
                BrowserSessionManager.clearSession();
                throw new Error(
                    `Discovery mismatch: Requested "${moduleName}" but captured Dashboard ` +
                    `widgets. This usually means the module route is inactive or the ` +
                    `test user lacks permissions.`
                );
            }
        }

        // Step 5: Persist to element repository
        await PageElementDiscoveryService.saveToRepository(inventory, {
            relatedModule: moduleName,
            businessLogicHint: `Auto-discovered via API from ${moduleName} page`,
        });

        const elementCount =
            inventory.buttons.length + inventory.inputs.length +
            inventory.dropdowns.length + inventory.grids.length +
            inventory.tabs.length + inventory.modals.length +
            (inventory.checkboxes?.length ?? 0) + (inventory.radios?.length ?? 0);

        appLogger.info(`[Discover] ${moduleName}: ${inventory.summary}`, {
            source: 'PageDiscovery',
            module: moduleName,
            elementCount,
            sessionReused: sessionWasRestored,
        });

        return inventory;
    } catch (err: any) {
        // If we were using a restored session and failed, clear it so the next
        // run starts with a fresh login rather than a bad state.
        if (sessionWasRestored) {
            BrowserSessionManager.clearSession();
        }
        appLogger.warn(`[Discover] Failed: ${moduleName} — ${err.message}`);
        throw err;
    } finally {
        await browser.close();
    }
}

export async function discoverAllModules(
    deepScan: boolean = false,
    credentials = TESTING_CREDENTIALS
): Promise<ModuleDiscovery[]> {
    const browser = await chromium.launch({ 
        headless: true,
        args: ['--disable-extensions']
    });

    // Reuse saved session for batch runs — login once and share the context
    // across all modules. If no saved session, performLogin creates a fresh one.
    let context = await BrowserSessionManager.tryRestoreContext(browser);
    const sessionWasRestored = !!context;
    if (!context) {
        context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    }

    const page = await context.newPage();
    const results: ModuleDiscovery[] = [];

    try {
        // Session-first: if cookies are restored, probe before running full login.
        // Navigating directly to the first module reveals server-side session state.
        if (sessionWasRestored) {
            const probeUrl = `${credentials.baseUrl}${MODULE_ROUTES[0]?.[0] || '#/dashboard'}`;
            await page.goto(probeUrl, { waitUntil: 'load', timeout: 30_000 });
            const sessionExpired = await detectLoginRedirect(page, 10_000);
            if (sessionExpired) {
                appLogger.warn('[Discovery] Batch: restored session expired — performing fresh login');
                BrowserSessionManager.clearSession();
                await performLogin(page, credentials);
                await BrowserSessionManager.saveContext(context);
            } else {
                appLogger.info('[Discovery] Batch: session valid — login skipped ✅');
            }
        } else {
            await performLogin(page, credentials);
            await BrowserSessionManager.saveContext(context);
        }

        appLogger.info(`[Discovery] Authenticated, scanning ${MODULE_ROUTES.length} modules`);

        for (const [hashRoute, modName] of MODULE_ROUTES) {
            try {
                appLogger.info(`[Discovery] → ${modName}`);
                await page.goto(`${credentials.baseUrl}${hashRoute}`, {
                    waitUntil: 'load',
                    timeout: 60_000,
                });

                // Mid-loop session expiry check — re-login if the app bounced to /login
                const midExpired = await detectLoginRedirect(page, 10_000);
                if (midExpired) {
                    appLogger.warn(`[Discovery] Session expired before scanning ${modName} — re-logging in`);
                    BrowserSessionManager.clearSession();
                    await performLogin(page, credentials);
                    await BrowserSessionManager.saveContext(context);
                    await page.goto(`${credentials.baseUrl}${hashRoute}`, {
                        waitUntil: 'load', timeout: 60_000,
                    });
                    await page.waitForSelector('app-root > :not(router-outlet)', { timeout: 10_000 }).catch(() => {});
                }

                const inventory = await PageElementDiscoveryService.discoverPage(page, {
                    pageName: modName,
                    section: modName,
                    deepScan,
                });

                await PageElementDiscoveryService.saveToRepository(inventory, {
                    relatedModule: modName,
                });

                results.push({ moduleName: modName, hashRoute, inventory });
                console.log(`  ${inventory.summary}\n`);
            } catch (err: any) {
                console.warn(`  [Discover] Failed ${modName}: ${err.message}\n`);
                results.push({ moduleName: modName, hashRoute, inventory: null, error: err.message });
            }
        }
    } finally {
        await browser.close();
    }

    return results;
}

// Run if called directly
if (require.main === module) {
    run().catch(console.error);
}
