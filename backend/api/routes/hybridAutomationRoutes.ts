import { Router } from 'express';
import { chromium, Page } from 'playwright';
import { successResponse, internalError, errorResponse } from '../utils/responseHelpers';

export function createHybridAutomationRouter() {
    const router = Router();
    let sharedPage: Page | null = null;
    let browser: any = null;

    /**
     * Start a browser session or attach to existing one
     */
    router.post('/start', async (req, res) => {
        try {
            if (!browser) {
                browser = await chromium.launch({ headless: false }); // Visible for debugging
                const context = await browser.newContext();
                sharedPage = await context.newPage();
            }
            const { url } = req.body;
            if (url) await sharedPage!.goto(url, { waitUntil: 'networkidle' });
            
            successResponse(res, { message: 'Browser ready', url: sharedPage!.url() });
        } catch (err: any) { internalError(res, err.message); }
    });

    /**
     * Capture UI State: Screenshot + Metadata
     */
    router.get('/state', async (req, res) => {
        if (!sharedPage) return errorResponse(res, 400, 'NO_SESSION', 'Start a session first');
        try {
            const screenshot = await sharedPage.screenshot({ type: 'jpeg', quality: 60 });
            const base64 = screenshot.toString('base64');

            // 1. Experimental Aria-Snapshot (The 'Semantic' View)
            let ariaTree = '';
            try {
                // @ts-ignore - experimental feature
                ariaTree = await (sharedPage as any).accessibility.snapshot();
            } catch (e) {
                ariaTree = 'Not available';
            }

            // 2. Extract "Semantic DOM" — only elements AI cares about
            const elements = await sharedPage.evaluate(() => {
                const results: any[] = [];
                const interesting = document.querySelectorAll('button, input, a, [role="button"], .k-button, .k-grid');
                interesting.forEach((el: any, i) => {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        results.push({
                            id: i,
                            tag: el.tagName,
                            text: el.innerText?.substring(0, 50) || el.placeholder || el.ariaLabel || '',
                            role: el.getAttribute('role') || '',
                            classes: el.className,
                            rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
                        });
                    }
                });
                return results;
            });

            successResponse(res, { 
                screenshot: base64, 
                elements,
                ariaSnapshot: ariaTree,
                url: sharedPage.url(),
                title: await sharedPage.title()
            });
        } catch (err: any) { internalError(res, err.message); }
    });

    /**
     * Execute Action from AI
     */
    router.post('/execute', async (req, res) => {
        if (!sharedPage) return errorResponse(res, 400, 'NO_SESSION', 'Start a session first');
        const { action, target, value } = req.body;

        try {
            console.log(`[Hybrid] Executing ${action} on ${target}`);
            
            // Resolve target (could be a selector or an element ID from our state)
            let selector = target;
            if (typeof target === 'number') {
                // It's an index from our state capture
                selector = `button, input, a, [role="button"], .k-button`; // Simplify for demo
                const elements = await sharedPage.$$(selector);
                if (elements[target]) {
                    if (action === 'CLICK') await elements[target].click();
                    if (action === 'TYPE') await elements[target].fill(value);
                    return successResponse(res, { status: 'done' });
                }
            }

            // Fallback to text-based matching if selector fails
            if (action === 'CLICK') {
                await sharedPage.click(`text="${target}"`, { timeout: 5000 }).catch(async () => {
                    await sharedPage.click(`.k-button:has-text("${target}")`);
                });
            } else if (action === 'TYPE') {
                await sharedPage.fill(`input[placeholder*="${target}"], label:has-text("${target}") + input`, value);
            } else if (action === 'WAIT') {
                await sharedPage.waitForTimeout(parseInt(value) || 2000);
            }

            successResponse(res, { status: 'done' });
        } catch (err: any) { internalError(res, `Action failed: ${err.message}`); }
    });

    return router;
}
