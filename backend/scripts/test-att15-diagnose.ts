/**
 * test-att15-diagnose.ts
 * Deep diagnostic: what is actually in the DOM on the login page?
 */
import dotenv from 'dotenv';
dotenv.config();

import { chromium } from '@playwright/test';
import { TESTING_CREDENTIALS } from '../tests/playwright/test-credentials';

async function main() {
  console.log('🔬 Deep DOM diagnostic — login page\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  // Capture console errors
  const consoleMsgs: string[] = [];
  const page = await ctx.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') consoleMsgs.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', err => consoleMsgs.push(`[pageerror] ${err.message}`));

  // Capture failed network requests
  const failedRequests: string[] = [];
  page.on('requestfailed', req => {
    failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });

  console.log(`Navigating to: ${TESTING_CREDENTIALS.baseUrl}#/login`);
  await page.goto(`${TESTING_CREDENTIALS.baseUrl}#/login`, { waitUntil: 'load', timeout: 90_000 });
  console.log('✅ Navigation complete. Waiting 10s for Angular...');
  await page.waitForTimeout(10_000);

  const state = await page.evaluate(() => {
    const allInputs = Array.from(document.querySelectorAll('input')).map(el => ({
      name: el.getAttribute('name'),
      type: el.type,
      placeholder: el.placeholder,
      visible: (el as HTMLElement).offsetParent !== null,
      class: el.className,
      formControlName: el.getAttribute('formcontrolname') || el.getAttribute('formControlName'),
    }));

    const allForms = Array.from(document.querySelectorAll('form')).map(f => ({
      id: f.id,
      class: f.className,
      children: f.children.length,
    }));

    // Check Kendo-specific elements
    const kendoInputs = document.querySelectorAll('kendo-textbox, kendo-maskedtextbox, kendo-numerictextbox');
    const kendoCount = kendoInputs.length;

    // All element tag names (top-level custom elements)
    const tagCounts: Record<string, number> = {};
    document.querySelectorAll('*').forEach(el => {
      const tag = el.tagName.toLowerCase();
      if (tag.includes('-') || ['form', 'input', 'button', 'select', 'textarea'].includes(tag)) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    });

    const routerOutlet = document.querySelector('router-outlet');
    const appRoot = document.querySelector('app-root');

    return {
      url: window.location.href,
      hash: window.location.hash,
      domTotal: document.querySelectorAll('*').length,
      allInputs,
      allForms,
      kendoCount,
      tagCounts,
      hasRouterOutlet: !!routerOutlet,
      hasAppRoot: !!appRoot,
      appRootHTML: appRoot?.innerHTML?.slice(0, 500) || '(not found)',
      bodyText: document.body?.innerText?.slice(0, 500),
    };
  });

  console.log('\n── DOM State ──────────────────────────────────────────');
  console.log('URL:            ', state.url);
  console.log('Hash:           ', state.hash);
  console.log('Total DOM nodes:', state.domTotal);
  console.log('Has app-root:   ', state.hasAppRoot);
  console.log('Has router-outlet:', state.hasRouterOutlet);
  console.log('Inputs found:   ', state.allInputs.length);
  console.log('Forms found:    ', state.allForms.length);
  console.log('Kendo inputs:   ', state.kendoCount);

  if (Object.keys(state.tagCounts).length > 0) {
    console.log('\nRelevant elements:');
    for (const [tag, count] of Object.entries(state.tagCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${tag.padEnd(30)} ${count}`);
    }
  }

  console.log('\nApp-root innerHTML (first 500):');
  console.log(state.appRootHTML);

  console.log('\nBody text:');
  console.log(state.bodyText);

  if (consoleMsgs.length > 0) {
    console.log('\n── Console Errors ─────────────────────────────────────');
    consoleMsgs.forEach(m => console.log(' ', m));
  }

  if (failedRequests.length > 0) {
    console.log('\n── Failed Network Requests ────────────────────────────');
    failedRequests.slice(0, 20).forEach(r => console.log(' ', r));
  }

  await browser.close();
}

main().catch(err => {
  console.error('\n💥 Diagnostic crashed:', err.message);
  process.exit(1);
});
