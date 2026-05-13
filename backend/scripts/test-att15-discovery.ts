/**
 * test-att15-discovery.ts
 *
 * Runs LIVE Playwright discovery against the Performance Journal page
 * (ATT-15 module) and prints the full inventory — buttons, icon buttons,
 * grid toolbar/actions/filters, modal fields, menus.
 *
 * Run:
 *   npx ts-node --transpile-only --project tsconfig.json scripts/test-att15-discovery.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { discoverSinglePage, MODULE_ROUTES } from './discover-page';
import { DiscoveryCacheService } from '../src/services/discovery/DiscoveryCacheService';
import { BrowserSessionManager } from '../src/services/discovery/BrowserSessionManager';
import type { PageInventory, GridInfo, ModalInfo, MenuInfo } from '../src/services/discovery/PageElementDiscoveryService';

const MODULE_NAME = 'My Performance Journal';

function section(title: string) {
  console.log(`\n${'═'.repeat(60)}\n ${title}\n${'═'.repeat(60)}`);
}
function row(label: string, value: string | number | boolean) {
  console.log(`  ${String(label).padEnd(22)} ${value}`);
}

async function main() {
  console.log('\n🔍  Live Discovery — ATT-15 (Performance Journal)');
  console.log(`    URL: https://test.globalhr.com.mm/ook#/app.performancejournal`);
  console.log(`    Time: ${new Date().toISOString()}\n`);

  // Resolve hash route
  const canonical = DiscoveryCacheService.normalizeModuleName(MODULE_NAME);
  const match = MODULE_ROUTES.find(([, name]) => {
    const normalizedMatch = DiscoveryCacheService.normalizeModuleName(name);
    return normalizedMatch.toLowerCase() === canonical.toLowerCase() || name.toLowerCase() === MODULE_NAME.toLowerCase();
  });
  if (!match) {
    console.error(`❌  No route for "${MODULE_NAME}" — add it to MODULE_ROUTES`);
    process.exit(1);
  }
  const [hashRoute] = match;

  // Session info
  const hadSession = BrowserSessionManager.hasValidSession();
  console.log(`🔑  Saved session: ${hadSession ? '✅ will reuse (login skipped)' : '⚠️  none — fresh login required'}`);
  console.log(`    Credentials: user="${process.env.TEST_USERNAME}" id="${process.env.TEST_IDNUMBER}"`);
  console.log('\n⏳  Starting Playwright browser (headless)...\n');

  const startMs = Date.now();

  // Quick sanity check — what does the login page actually render?
  {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pg = await ctx.newPage();
    const { TESTING_CREDENTIALS: creds } = await import('../tests/playwright/test-credentials');

    await pg.goto(`${creds.baseUrl}#/login`, { waitUntil: 'load', timeout: 90_000 });
    await pg.waitForTimeout(8_000);

    const pageState = await pg.evaluate(() => ({
      url: window.location.href,
      title: document.title,
      inputCount: document.querySelectorAll('input').length,
      inputs: Array.from(document.querySelectorAll('input')).map(i => ({
        name: i.getAttribute('name'), type: i.type, placeholder: i.placeholder,
      })),
      bodyText: document.body?.innerText?.slice(0, 300),
      hasAngular: typeof (window as any).ng !== 'undefined' || typeof (window as any).getAllAngularRootElements === 'function',
    }));

    console.log('\n🔬 Page state after load+8s:');
    console.log('   URL:        ', pageState.url);
    console.log('   Title:      ', pageState.title);
    console.log('   Angular:    ', pageState.hasAngular ? 'YES' : 'NO');
    console.log('   Inputs found:', pageState.inputCount);
    console.log('   Input fields:', JSON.stringify(pageState.inputs));
    console.log('   Body text:  ', pageState.bodyText?.replace(/\n/g, ' ').slice(0, 200));

    await browser.close();
  }

  let inventory: PageInventory | null = null;
  try {
    inventory = await discoverSinglePage(hashRoute, MODULE_NAME, {
      deepScan: false,
      headless: true,
    });
  } catch (err: any) {
    console.error(`\n❌  Discovery failed: ${err.message}`);
    process.exit(1);
  }

  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
  const nowHadSession = BrowserSessionManager.hasValidSession();

  // ── Results ────────────────────────────────────────────────────────────────
  section('Discovery Complete');
  row('Elapsed', `${elapsedSec}s`);
  row('URL', inventory.url);
  row('Page title', inventory.pageTitle);
  row('Session saved', nowHadSession ? '✅ yes (reuse next time)' : '❌ no');
  row('State key', inventory.defaultStateKey || '—');

  // ── Buttons ────────────────────────────────────────────────────────────────
  section(`Buttons (${inventory.buttons.length})`);
  for (const b of inventory.buttons) {
    const tag = b.type === 'icon-button' ? '[ICON]' : '[BTN] ';
    console.log(`  ${tag} "${b.name}" → ${b.selector} [enabled=${b.isEnabled}]`);
  }
  if (inventory.buttons.length === 0) console.log('  (none found)');

  // ── Inputs ────────────────────────────────────────────────────────────────
  section(`Inputs (${inventory.inputs.length})`);
  for (const i of inventory.inputs) {
    console.log(`  "${i.name}" (${i.type}) → ${i.selector}`);
  }
  if (inventory.inputs.length === 0) console.log('  (none found)');

  // ── Dropdowns ─────────────────────────────────────────────────────────────
  section(`Dropdowns (${inventory.dropdowns.length})`);
  for (const d of inventory.dropdowns) {
    console.log(`  "${d.name}" → ${d.selector}`);
  }
  if (inventory.dropdowns.length === 0) console.log('  (none found)');

  // ── Grids (rich) ──────────────────────────────────────────────────────────
  section(`Grids (${inventory.grids.length})`);
  for (const g of inventory.grids as GridInfo[]) {
    console.log(`  Grid: ${g.selector} [Kendo=${g.isKendo}]`);
    console.log(`    Columns:        ${g.columns.join(', ') || '(none)'}`);
    console.log(`    Toolbar btns:   ${g.toolbarButtons?.join(', ') || '(none)'}`);
    console.log(`    Row actions:    ${g.actionButtons?.join(', ') || '(none)'}`);
    console.log(`    Filter row:     ${g.hasFilter ? 'YES' : 'NO'} | Filterable: ${g.filterColumns?.join(', ') || '—'}`);
    console.log(`    Rows visible:   ${g.estimatedRowCount}`);
    console.log(`    Has toolbar:    ${g.hasToolbar} | Search: ${g.hasSearch} | Export: ${g.hasExport}`);
  }
  if (inventory.grids.length === 0) console.log('  (none found)');

  // ── Tabs ──────────────────────────────────────────────────────────────────
  if (inventory.tabs.length > 0) {
    section(`Tabs (${inventory.tabs.length})`);
    for (const t of inventory.tabs) {
      console.log(`  Strip: ${t.selector}`);
      console.log(`    Tabs: ${t.tabs.join(', ')}`);
    }
  }

  // ── Modals (rich) ─────────────────────────────────────────────────────────
  section(`Modals (${inventory.modals.length})`);
  for (const m of inventory.modals as ModalInfo[]) {
    console.log(`  "${m.title || '(untitled)'}" → ${m.selector}`);
    console.log(`    Fields:  ${m.fields?.join(', ') || '(none)'}`);
    console.log(`    Actions: ${m.actionButtons?.join(', ') || '(none)'}`);
    console.log(`    Close:   ${m.hasCloseButton}`);
  }
  if (inventory.modals.length === 0) console.log('  (none visible — use deepScan=true to probe Add/Edit modals)');

  // ── Menus ─────────────────────────────────────────────────────────────────
  const menus = (inventory as any).menus as MenuInfo[] | undefined;
  if (menus && menus.length > 0) {
    section(`Menus (${menus.length})`);
    for (const m of menus) {
      console.log(`  [${m.type}] "${m.label}" → ${m.selector}`);
      console.log(`    Items: ${m.items.slice(0, 10).join(', ')}`);
    }
  }

  // ── Pagination ────────────────────────────────────────────────────────────
  if (inventory.pagination) {
    section('Pagination');
    const p = inventory.pagination;
    console.log(`  Selector: ${p.selector}`);
    console.log(`  Page numbers: ${p.hasPageNumbers} | Size selector: ${p.hasPageSizeSelector}`);
    console.log(`  Prev/Next: ${p.hasNextPrev} | Total count: ${p.hasTotalCount}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  section('Summary');
  console.log(`  ${inventory.summary}`);

  // ── Save to cache ─────────────────────────────────────────────────────────
  DiscoveryCacheService.save(inventory, hashRoute, undefined, MODULE_NAME);
  const cacheStatus = DiscoveryCacheService.getStatus(MODULE_NAME);
  console.log(`\n✅  Cache saved: ${cacheStatus.elementCount} elements | Age: ${cacheStatus.age}`);
  console.log('\n  Pipeline is ready — /scenarios will now use real selectors.\n');
}

main().catch(err => {
  console.error('\n💥  Script crashed:', err.message, '\n', err.stack);
  process.exit(1);
});
