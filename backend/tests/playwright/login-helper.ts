/**
 * Login Helper for GlobalHR
 *
 * Provides reliable login functions used by all generated Playwright tests
 * and the TestExecutionService.
 *
 * Imported by generated tests via:
 *   import { performLogin } from '../../tests/playwright/login-helper';
 */

import { Page } from 'playwright';
import { waitForAngular, waitForAppReady } from './playwright-self-healing';
import { TESTING_CREDENTIALS } from './test-credentials';
import { fetchMenuData, ResolveRealMenuUrl, MenuItem } from '../../src/services/MenuDrivenNavigationService';

export interface LoginCredentials {
  baseUrl: string;
  apiBaseUrl?: string;
  idNumber: string;
  username: string;
  password: string;
}

/**
 * Perform login to GlobalHR application.
 *
 * Login flow (verified from harvester recordings):
 * 1. Navigate to {baseUrl}#/login
 * 2. Fill input[name="idnumber"] with ID number
 * 3. Fill input[name="username"] with username
 * 4. Fill input[name="password"] with password
 * 5. Click button.btn.btn-primary (Login button)
 * 6. Wait for redirect to dashboard/home
 *
 * @param page - Playwright page object
 * @param credentials - Login credentials (falls back to TESTING_CREDENTIALS)
 * @param timeoutMs - Maximum time to wait for login (default 60000ms)
 * @returns true if login succeeded, false otherwise
 */
export async function performLogin(
  page: Page,
  credentials?: LoginCredentials,
  timeoutMs: number = 60000,
): Promise<boolean> {
  const creds = credentials || TESTING_CREDENTIALS;
  if (!creds.baseUrl) {
    console.error('[Login] ERROR: baseUrl is missing from credentials');
    return false;
  }
  const cleanBaseUrl = creds.baseUrl.replace(/\/#\/.+$/, '').replace(/\/#$/, '').replace(/\/$/, '');
  const loginUrl = `${cleanBaseUrl}#/login`;

  try {
    // Step 1: Navigate to login page
    console.log(`[Login] Navigating to ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: 'load', timeout: timeoutMs });
    await waitForAngular(page);
    await page.waitForTimeout(1000);

    // Check if already logged in (redirected away from login)
    const currentUrl = page.url();
    if (!currentUrl.includes('/login') && !currentUrl.includes('/auth')) {
      console.log('[Login] Already logged in, skipping login.');
      return true;
    }

    // Step 2: Fill ID Number field
    console.log('[Login] Filling ID Number...');
    const idField = page.locator('input[name="idnumber"], input#idnumber, input#userName').first();
    await idField.waitFor({ state: 'visible', timeout: 15000 });
    await idField.fill(creds.idNumber);

    // Step 3: Fill Username field
    console.log('[Login] Filling Username...');
    const userField = page.locator('input[name="username"], input#userName').first();
    await userField.waitFor({ state: 'visible', timeout: 10000 });
    await userField.fill(creds.username);

    // Step 4: Fill Password field
    console.log('[Login] Filling Password...');
    const passField = page.locator('input[name="password"], input#password, input[type="password"]').first();
    await passField.evaluate((el: HTMLInputElement) => el.removeAttribute('readonly')).catch(() => {});
    await passField.click({ force: true }).catch(() => {});
    await page.waitForTimeout(100);
    await passField.fill(creds.password);

    // Step 5: Click Login button
    console.log('[Login] Clicking Login...');
    const loginBtn = page.locator('button.btn.btn-primary, button#btnLogin, button[type="submit"], button:has-text("LOG IN"), button:has-text("Login")').first();     
    await loginBtn.click({ timeout: 15000 });

    // Step 6: Wait for navigation after login (Angular hash route change)
    console.log('[Login] Waiting for navigation...');
    await page.waitForURL((url) => !url.href.includes('/login') && !url.href.includes('/auth'), { timeout: timeoutMs });
    await waitForAngular(page);
    await page.waitForTimeout(2000);

    // Step 7: Verify we're no longer on the login page
    const afterUrl = page.url();
    if (afterUrl.includes('/login') || afterUrl.includes('/auth')) {
      console.log('[Login] Still on login page after submit — credentials may be invalid or login failed.');
      return false;
    }

    console.log(`[Login] Successful. Current URL: ${afterUrl}`);
    return true;
  } catch (error: any) {
    console.error(`[Login] Failed: ${error.message}`);
    return false;
  }
}

/**
 * Login and navigate to a specific module route using Smart Navigation.
 *
 * Used by TestExecutionService for the full login → module navigation flow.
 *
 * @param page - Playwright page
 * @param credentials - Login credentials
 * @param moduleName - Module name for route construction (e.g., 'department')
 * @param fallbackUrl - Full fallback URL if module route can't be constructed
 * @returns Resolves when navigation is complete (does not throw)
 */
export async function loginAndNavigate(
  page: Page,
  credentials?: LoginCredentials,
  moduleName?: string,
  fallbackUrl?: string,
): Promise<void> {
  const creds = credentials || TESTING_CREDENTIALS;

  // Perform login
  const loginOk = await performLogin(page, creds, 60000);
  if (!loginOk) {
    console.warn('[LoginAndNavigate] Login failed, cannot navigate to module.');
    return;
  }

  // BUILD TARGET URL
  let targetUrl: string | null = null;
  const cleanBaseUrl = creds.baseUrl.replace(/\/#\/.+$/, '').replace(/\/#$/, '').replace(/\/$/, '');
  const apiBaseUrl = creds.apiBaseUrl || TESTING_CREDENTIALS.apiBaseUrl;
  console.log(`[SmartNav] cleanBaseUrl: ${cleanBaseUrl}`);
  console.log(`[SmartNav] apiBaseUrl: ${apiBaseUrl}`);

  if (moduleName) {
    console.log(`[SmartNav] Attempting to resolve route for: ${moduleName}`);
    
    try {
        // TIER 1: Real Flow (API)
        const menus = await fetchMenuData(page, apiBaseUrl);
        const nameLower = moduleName.toLowerCase().replace(/\s+/g, '');
        
        const findRecursive = (items: MenuItem[]): MenuItem | null => {
            for (const item of items) {
                const menuName = (item.menuName || '').toLowerCase().replace(/\s+/g, '');
                if (menuName === nameLower || menuName.includes(nameLower)) return item;
                if (item.children) {
                    const found = findRecursive(item.children);
                    if (found) return found;
                }
            }
            return null;
        };
        
        const menuObj = findRecursive(menus);
        if (menuObj) {
            const realPath = await ResolveRealMenuUrl(page, apiBaseUrl, menuObj.menuId);
            if (realPath) {
                targetUrl = `${cleanBaseUrl}/${realPath.replace(/^\//, '')}`.replace(/\/+#/, '#');
                console.log(`[SmartNav] ✅ API Resolved: ${targetUrl}`);
            }
        }
    } catch (apiErr: any) {
        console.warn(`[SmartNav] ⚠️ API Route discovery failed: ${apiErr.message}`);
    }

    // TIER 2: Smart Inference (Manual Mappings for common mismatches)
    if (!targetUrl) {
        const mappings: Record<string, string> = {
            'attendance request': '#/app.attendanceRequest',
            'leave request': '#/app.leaverequest',
            'ot request': '#/app.otrequest',
            'designation': '#/app.designation',
            'department': '#/app.department',
            'company profile': '#/app.companyprofile'
        };
        
        const mapped = mappings[moduleName.toLowerCase()];
        if (mapped) {
            targetUrl = `${cleanBaseUrl}/${mapped.replace(/^\//, '')}`.replace(/\/+#/, '#');
            console.log(`[SmartNav] 💡 Mapped from internal dictionary: ${targetUrl}`);
        }
    }

    // TIER 3: Simplistic Generation (Legacy behavior)
    if (!targetUrl) {
        const hashRoute = `#/app.${moduleName.toLowerCase().replace(/\s+/g, '')}`;
        targetUrl = `${cleanBaseUrl}/${hashRoute.replace(/^\//, '')}`.replace(/\/+#/, '#');
        console.log(`[SmartNav] ⚠️ Falling back to simplistic generation: ${targetUrl}`);
    }
  } else if (fallbackUrl) {
    targetUrl = fallbackUrl;
  } else {
    targetUrl = `${cleanBaseUrl}#/dashboard`;
  }

  try {
    console.log(`[Navigate] Going to: ${targetUrl}`);
    await page.goto(targetUrl!, { waitUntil: 'load', timeout: 60000 });
    await waitForAngular(page);
    await page.waitForTimeout(3000); // Let Angular lazy-load the component
    await waitForAppReady(page);
    console.log(`[Navigate] Arrived at: ${page.url()}`);
  } catch (error: any) {
    console.error(`[Navigate] Failed to reach ${targetUrl}: ${error.message}`);
    // One last try with the original fallback if we have it
    if (fallbackUrl && targetUrl !== fallbackUrl) {
        console.log(`[Navigate] Retrying with original fallback: ${fallbackUrl}`);
        await page.goto(fallbackUrl, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
    }
  }
}

/**
 * Login and prepare the page for testing.
 * Similar to performLogin but with additional stabilization.
 *
 * Used by auto-config generator scripts.
 *
 * @param page - Playwright page
 * @param credentials - Login credentials
 */
export async function loginAndPrepare(
  page: Page,
  credentials?: LoginCredentials,
): Promise<void> {
  const creds = credentials || TESTING_CREDENTIALS;

  const ok = await performLogin(page, creds, 60000);
  if (!ok) {
    throw new Error('Login failed — could not prepare testing session.');
  }

  // Additional stabilization
  await waitForAngular(page);
  await page.waitForTimeout(1000);
}
