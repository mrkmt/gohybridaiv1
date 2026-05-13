/**
 * HarvesterNavigationService
 *
 * Uses harvester JSON step recordings to drive navigation fallbacks.
 * When direct URL navigation fails (Terms page, login redirect, lazy-load timeout),
 * this service reads a recorded user journey and replays it step by step.
 *
 * Data source: menu_expand_*.json files from the Go-Hybrid Harvester extension.
 * Each file records a real user clicking through the sidebar menu to reach a module.
 */

import { Page } from '@playwright/test';
import { healedClick, waitForAngular } from '../../tests/playwright/playwright-self-healing';

export interface HarvesterStep {
    type: string;
    elementType: string;
    selector: string;
    text: string;
    url?: string;
    componentInfo?: {
        businessName?: string;
        [key: string]: unknown;
    };
}

export interface HarvesterRecord {
    metadata: {
        moduleName: string;
        menuNames?: string[];
        sourceUrl: string;
    };
    data: {
        steps: HarvesterStep[];
    };
}

/**
 * Find navigation steps in a harvester record that match a target module.
 *
 * @param record - Harvester JSON record
 * @param targetModule - Module name to match (e.g., "Department", "Team Setup")
 * @returns Array of steps that lead to the target module, or null if not found
 */
export function findModuleNavigationSteps(
    record: HarvesterRecord,
    targetModule: string
): HarvesterStep[] | null {
    const targetLower = targetModule.toLowerCase();

    // Check if this record is relevant to the target module
    const menuNames = record.metadata.menuNames || [];
    const isRelevant = menuNames.some(name =>
        name.toLowerCase().includes(targetLower) || targetLower.includes(name.toLowerCase())
    );

    if (!isRelevant) {
        // Also check by URL — if any step navigates to a URL containing the module name
        const hasModuleUrl = record.data.steps.some(step =>
            step.url && step.url.toLowerCase().includes(targetLower.replace(/\s+/g, ''))
        );
        if (!hasModuleUrl) return null;
    }

    // Extract the navigation sequence: click menu items → final navigate step
    const navSteps: HarvesterStep[] = [];
    for (const step of record.data.steps) {
        if (step.type === 'click' && step.selector) {
            navSteps.push(step);
        }
        // Stop at the final navigate step — that's where the module loads
        if (step.type === 'navigate' && step.url) {
            navSteps.push(step);
            break;
        }
    }

    return navSteps.length > 0 ? navSteps : null;
}

/**
 * Replay harvester navigation steps on a live page.
 * Clicks through the sidebar menu exactly as a real user recorded it.
 *
 * @param page - Playwright page
 * @param steps - Navigation steps from harvester record
 * @param options - Optional configuration
 */
export async function replayHarvesterNavigation(
    page: Page,
    steps: HarvesterStep[],
    options?: {
        /** Wait for this URL after the final navigate step */
        waitForUrl?: string | RegExp;
        /** Wait for this selector to be visible after navigation */
        waitForSelector?: string;
        /** Timeout for the entire replay */
        timeout?: number;
    }
): Promise<void> {
    const timeout = options?.timeout ?? 30000;
    const lastStep = steps[steps.length - 1];

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];

        if (step.type === 'click' && step.selector) {
            // Use the recorded selector with healedClick for resilience
            await healedClick(page, step.selector, { timeout: Math.min(timeout, 15000) });
            await page.waitForTimeout(500); // Let the menu animation complete
        }

        if (step.type === 'navigate' && step.url) {
            // If this is the last step, wait for the target
            if (i === steps.length - 1) {
                if (options?.waitForUrl) {
                    await page.waitForURL(options.waitForUrl, { timeout });
                }
                if (options?.waitForSelector) {
                    await page.locator(options.waitForSelector).waitFor({ state: 'visible', timeout });
                }
            }
        }
    }

    // Final stabilization
    await waitForAngular(page);
    await page.waitForTimeout(1000);
}

/**
 * Full navigation: try direct URL first, fall back to harvester menu replay.
 *
 * @param page - Playwright page
 * @param targetUrl - Direct URL to try first (e.g., '#/app.department')
 * @param harvesterRecord - Harvester JSON record with menu click steps
 * @param targetModule - Module name for matching
 * @param options - Optional configuration
 * @returns true if navigation succeeded, false if both methods failed
 */
export async function navigateWithHarvesterFallback(
    page: Page,
    targetUrl: string,
    harvesterRecord: HarvesterRecord,
    targetModule: string,
    options?: {
        waitForSelector?: string;
        /** Direct navigation timeout */
        directTimeout?: number;
    }
): Promise<boolean> {
    const directTimeout = options?.directTimeout ?? 15000;

    // Step 1: Try direct URL navigation
    try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: directTimeout });
        await page.waitForTimeout(3000);
        await waitForAngular(page);

        // If a specific selector is expected, verify it's visible
        if (options?.waitForSelector) {
            await page.locator(options.waitForSelector).waitFor({ state: 'visible', timeout: directTimeout });
        }

        return true;
    } catch {
        // Direct navigation failed (Terms page, login redirect, lazy-load timeout)
    }

    // Step 2: Fall back to harvester menu replay
    const navSteps = findModuleNavigationSteps(harvesterRecord, targetModule);
    if (!navSteps) {
        return false;
    }

    try {
        await replayHarvesterNavigation(page, navSteps, {
            waitForUrl: targetUrl,
            waitForSelector: options?.waitForSelector,
            timeout: 30000,
        });
        return true;
    } catch {
        return false;
    }
}
