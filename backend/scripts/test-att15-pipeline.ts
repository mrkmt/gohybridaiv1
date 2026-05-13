/**
 * test-att15-pipeline.ts
 *
 * End-to-end integration test for the discovery → scenario → generation
 * pipeline using real Jira ticket ATT-15.
 *
 * Run:  npx ts-node --transpile-only --project tsconfig.json scripts/test-att15-pipeline.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { DiscoveryCacheService } from '../src/services/discovery/DiscoveryCacheService';
import { BrowserSessionManager } from '../src/services/discovery/BrowserSessionManager';
import { TESTING_CREDENTIALS } from '../tests/playwright/test-credentials';

const JIRA_BASE = `https://${process.env.JIRA_DOMAIN}/rest/api/3`;
const JIRA_AUTH = Buffer.from(
  `${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`
).toString('base64');

const TICKET_ID = 'ATT-15';

// ── Helpers ────────────────────────────────────────────────────────────────────

function ok(label: string, value: unknown) {
  console.log(`  ✅  ${label}:`, typeof value === 'object' ? JSON.stringify(value).slice(0, 120) : value);
}
function warn(label: string, value: unknown) {
  console.log(`  ⚠️   ${label}:`, value);
}
function fail(label: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  ❌  ${label}: ${msg}`);
}
function section(title: string) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(` ${title}`);
  console.log('═'.repeat(60));
}

// ── 1. Jira connectivity + ticket fetch ────────────────────────────────────────

async function testJiraFetch(): Promise<any> {
  section('1. Jira — Fetch ATT-15');

  try {
    const res = await axios.get(`${JIRA_BASE}/issue/${TICKET_ID}`, {
      headers: { Authorization: `Basic ${JIRA_AUTH}`, Accept: 'application/json' },
      timeout: 15_000,
    });

    const issue = res.data;
    const summary  = issue.fields?.summary || '(no summary)';
    const issueType = issue.fields?.issuetype?.name || 'Unknown';
    const status   = issue.fields?.status?.name || 'Unknown';
    const desc     = (issue.fields?.description?.content?.[0]?.content?.[0]?.text || '').slice(0, 200);

    ok('Ticket ID',   issue.key);
    ok('Summary',     summary);
    ok('Type',        issueType);
    ok('Status',      status);
    ok('Description', desc || '(empty)');

    // Detect module from summary
    const module = DiscoveryCacheService.detectModuleFromText(summary) || 'General';
    ok('Detected module', module);

    return { key: issue.key, summary, issueType, status, description: desc, module };
  } catch (err) {
    fail('Jira fetch', err);
    return null;
  }
}

// ── 2. Discovery cache status ──────────────────────────────────────────────────

async function testDiscoveryCache(moduleName: string) {
  section(`2. Discovery Cache — "${moduleName}"`);

  const status = DiscoveryCacheService.getStatus(moduleName);
  if (status.fresh) {
    ok('Cache status', `FRESH — ${status.age} old, ${status.elementCount} elements`);
    ok('Discovered at', status.discoveredAt);

    const cache = DiscoveryCacheService.get(moduleName);
    if (cache) {
      ok('Buttons', cache.inventory.buttons.map(b => b.name).join(', ') || '(none)');
      ok('Inputs',  cache.inventory.inputs.map(i => i.name).join(', ') || '(none)');
      ok('Dropdowns', cache.inventory.dropdowns.map(d => d.name).join(', ') || '(none)');

      // New fields from our rewrite
      for (const g of cache.inventory.grids || []) {
        ok('Grid columns', g.columns.join(', '));
        if ((g as any).toolbarButtons?.length) ok('Grid toolbar', (g as any).toolbarButtons.join(', '));
        if ((g as any).actionButtons?.length)  ok('Grid row actions', (g as any).actionButtons.join(', '));
        if ((g as any).filterColumns?.length)  ok('Grid filters', (g as any).filterColumns.join(', '));
      }

      for (const m of cache.inventory.modals || []) {
        if (m.title) {
          ok(`Modal "${m.title}" fields`, (m as any).fields?.join(', ') || '(none)');
          ok(`Modal "${m.title}" actions`, (m as any).actionButtons?.join(', ') || '(none)');
        }
      }

      if ((cache.inventory as any).menus?.length) {
        ok('Menus', ((cache.inventory as any).menus as any[]).map((m: any) => `${m.label}(${m.type}): ${m.items.slice(0,3).join(',')}`).join(' | '));
      }
    }
  } else {
    warn('Cache status', `STALE / MISSING — auto-discovery would fire here in production`);
    warn('Action needed', `Run: POST /api/testing/${TICKET_ID}/discovery/run to populate`);
  }
}

// ── 3. Browser session state ───────────────────────────────────────────────────

async function testBrowserSession() {
  section('3. Browser Session Manager');

  const hasSession = BrowserSessionManager.hasValidSession();
  if (hasSession) {
    ok('Saved session', 'EXISTS and within TTL — login would be SKIPPED on next discovery');
  } else {
    warn('Saved session', 'None / expired — next discovery will perform fresh login');
  }

  ok('Test credentials loaded', `user="${TESTING_CREDENTIALS.username}" idnumber="${TESTING_CREDENTIALS.idNumber}"`);
  ok('Base URL', TESTING_CREDENTIALS.baseUrl);
  ok('Credentials valid', Boolean(TESTING_CREDENTIALS.username && TESTING_CREDENTIALS.password));
}

// ── 4. Module route lookup ─────────────────────────────────────────────────────

async function testModuleRoute(moduleName: string) {
  section(`4. Module Route Lookup — "${moduleName}"`);

  try {
    const { MODULE_ROUTES } = await import('./discover-page');
    const canonical = DiscoveryCacheService.normalizeModuleName(moduleName);
    const match = MODULE_ROUTES.find(([, name]) => name.toLowerCase() === canonical.toLowerCase());

    if (match) {
      ok('Route found', `${match[1]} → ${match[0]}`);
      ok('Full URL', `${TESTING_CREDENTIALS.baseUrl}${match[0]}`);
    } else {
      warn('No route mapping', `"${moduleName}" is not in MODULE_ROUTES — add it to discover-page.ts`);
      console.log('  Available modules:', MODULE_ROUTES.map(([, n]) => n).join(', '));
    }
  } catch (err) {
    fail('Module route lookup', err);
  }
}

// ── 5. Prompt context preview ──────────────────────────────────────────────────

async function testPromptContext(moduleName: string) {
  section(`5. Discovery Prompt Context — "${moduleName}"`);

  const ctx = DiscoveryCacheService.getPromptContext(moduleName, 12);
  if (ctx) {
    ok('Prompt context (first 400 chars)', ctx.slice(0, 400));
  } else {
    const seeded = DiscoveryCacheService.getSeededPromptContext(moduleName);
    warn('Using SEEDED fallback context (no live cache)', seeded?.slice(0, 200) || '(none)');
  }
}

// ── MAIN ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🧪  GoHybridAI — ATT-15 Pipeline Integration Test');
  console.log(`    Ticket:  ${TICKET_ID}`);
  console.log(`    Jira:    ${JIRA_BASE}`);
  console.log(`    App URL: ${TESTING_CREDENTIALS.baseUrl}`);
  console.log(`    Time:    ${new Date().toISOString()}\n`);

  // Step 1: Fetch ticket from Jira
  const ticket = await testJiraFetch();
  if (!ticket) {
    console.log('\n❌ Cannot continue — Jira fetch failed.');
    process.exit(1);
  }

  // Step 2–5: Use the detected module
  const moduleName = ticket.module;
  await testDiscoveryCache(moduleName);
  await testBrowserSession();
  await testModuleRoute(moduleName);
  await testPromptContext(moduleName);

  section('Summary');
  console.log(`  Ticket:        ${ticket.key} — ${ticket.summary}`);
  console.log(`  Module:        ${moduleName}`);
  console.log(`  Issue type:    ${ticket.issueType}`);
  console.log(`  Cache status:  ${DiscoveryCacheService.getStatus(moduleName).fresh ? '✅ Fresh' : '⚠️  Stale — auto-discovery needed'}`);
  console.log(`  Session:       ${BrowserSessionManager.hasValidSession() ? '✅ Reusable' : '⚠️  Login required'}`);
  console.log('\n  Next step: Run POST /api/testing/ATT-15/start to trigger auto-discovery\n');
}

main().catch(err => {
  console.error('\n💥 Test script crashed:', err.message);
  process.exit(1);
});
