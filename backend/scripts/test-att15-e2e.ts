/**
 * test-att15-e2e.ts
 *
 * Full end-to-end pipeline test for ATT-15:
 *   Jira fetch → Discovery cache → Scenario generation → Test case generation
 *
 * Calls services directly — no HTTP server needed, no auth required.
 * Shows exactly what the AI produces at each stage so weaknesses are visible.
 *
 * Run:
 *   npx ts-node --transpile-only --project tsconfig.json scripts/test-att15-e2e.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { DiscoveryCacheService } from '../src/services/discovery/DiscoveryCacheService';
import { JsonTestGenerationService } from '../src/services/generation/JsonTestGenerationService';
import { TESTING_CREDENTIALS } from '../tests/playwright/test-credentials';

// TestingGenerationService is loaded dynamically because the file may be
// unavailable in some environments. We fall back to mock scenarios if needed.
let TestingGenerationService: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  TestingGenerationService = require('../src/services/generation/TestingGenerationService').TestingGenerationService;
} catch {
  // Will use mock scenarios in generateScenarios()
}

const TICKET_ID = 'ATT-15';
const JIRA_BASE = `https://${process.env.JIRA_DOMAIN}/rest/api/3`;
const JIRA_AUTH = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');

function sep(title: string) {
  const line = '═'.repeat(60);
  console.log(`\n${line}\n ${title}\n${line}`);
}
function ok(label: string, val: unknown) {
  const str = typeof val === 'object' ? JSON.stringify(val).slice(0, 200) : String(val);
  console.log(`  ✅ ${label}: ${str}`);
}
function warn(label: string, val: unknown) {
  console.log(`  ⚠️  ${label}: ${val}`);
}

// ── 1. Jira fetch ────────────────────────────────────────────────────────────

async function fetchJiraTicket() {
  sep(`1. Jira — ${TICKET_ID}`);
  const res = await axios.get(`${JIRA_BASE}/issue/${TICKET_ID}`, {
    headers: { Authorization: `Basic ${JIRA_AUTH}`, Accept: 'application/json' },
    timeout: 15_000,
  });
  const f = res.data.fields;
  const summary     = f?.summary || '';
  const issueType   = f?.issuetype?.name || 'Story';
  const status      = f?.status?.name || '';
  const description = (f?.description?.content?.[0]?.content?.[0]?.text || '').slice(0, 500);
  const comments: string[] = (f?.comment?.comments || []).map((c: any) =>
    c?.body?.content?.[0]?.content?.[0]?.text || ''
  ).filter(Boolean).slice(0, 5);

  ok('Ticket ID',    res.data.key);
  ok('Summary',      summary);
  ok('Type',         issueType);
  ok('Status',       status);
  ok('Description',  description || '(empty)');
  if (comments.length) ok('Comments', comments.join(' | ').slice(0, 200));

  const module = DiscoveryCacheService.detectModuleFromText(summary) || 'Performance Journal';
  ok('Detected module', module);

  return { key: res.data.key, summary, issueType, status, description, comments, module };
}

// ── 2. Discovery cache ───────────────────────────────────────────────────────

async function checkDiscovery(moduleName: string) {
  sep(`2. Discovery Cache — "${moduleName}"`);
  const status = DiscoveryCacheService.getStatus(moduleName);
  if (!status.fresh) {
    warn('Cache', `STALE/MISSING (${status.age}) — scenarios will use generic context`);
    warn('Fix', 'Run: npx ts-node scripts/test-att15-discovery.ts');
    return;
  }
  ok('Cache age', status.age);
  ok('Element count', status.elementCount);

  const cache = DiscoveryCacheService.get(moduleName)!;
  const inv   = cache.inventory;
  ok('Buttons',   inv.buttons.map(b => b.name).filter(Boolean).join(', ') || '(none)');
  ok('Inputs',    inv.inputs.map(i => i.name).filter(Boolean).join(', ') || '(none)');
  ok('Dropdowns', inv.dropdowns.map(d => d.name).filter(Boolean).join(', ') || '(none)');

  const ctx = DiscoveryCacheService.getPromptContext(moduleName, 10);
  if (ctx) {
    console.log('\n  Prompt context preview (first 600 chars):');
    console.log(ctx.slice(0, 600).split('\n').map(l => '    ' + l).join('\n'));
  }
}

// ── 3. Scenario generation ───────────────────────────────────────────────────

async function generateScenarios(ticket: any): Promise<any[]> {
  sep(`3. Scenario Generation (AI-backed)`);

  const session = {
    ticketId: ticket.key,
    ticket: {
      summary:     ticket.summary,
      description: ticket.description,
      issueType:   ticket.issueType,
      module:      ticket.module,
      comments:    ticket.comments,
    },
  };

  console.log('  Calling TestingGenerationService.generateScenarios...');
  const startMs = Date.now();

  let scenarios: any[];
  if (TestingGenerationService) {
    const svc = new TestingGenerationService();
    const result = await svc.generateScenarios(session);
    scenarios = result.scenarios;
  } else {
    // Mock scenarios — used when TestingGenerationService is unavailable
    console.log('  ⚠️  TestingGenerationService unavailable — using mock scenarios');
    scenarios = [
      { source: 'mock', selected: true,  tag: 'Happy',    title: 'Create a new Performance Journal entry with valid title and description, verify it appears in the list.' },
      { source: 'mock', selected: true,  tag: 'Happy',    title: 'Sort journal entries by Newest, verify order is most-recent-first.' },
      { source: 'mock', selected: true,  tag: 'Edge',     title: 'Attempt to create a journal entry with an empty title, verify validation error.' },
      { source: 'mock', selected: false, tag: 'Edge',     title: 'Navigate using pagination controls (Next Page, Last Page, First Page), verify correct page transitions.' },
      { source: 'mock', selected: false, tag: 'Negative', title: 'Change Rows per page setting, verify displayed rows update accordingly.' },
    ];
  }
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

  console.log(`\n  Generated ${scenarios.length} scenarios in ${elapsed}s:\n`);
  for (const s of scenarios) {
    const flag = s.source === 'ai' ? '🤖' : '📋';
    const sel  = s.selected ? '✓' : '○';
    console.log(`  [${sel}] ${flag} [${s.tag.padEnd(12)}] ${s.title}`);
  }

  const seededFallback = scenarios.some((s: any) => s.source !== 'ai') ||
    scenarios.some((s: any) => s.title.startsWith('Happy path:') && scenarios.length <= 5);
  if (seededFallback) {
    warn('\n  ⚠️  SEEDED FALLBACK detected', 'AI planner returned generic templates — check Vertex AI credentials');
  } else {
    console.log('\n  ✅ Scenarios appear AI-generated (ticket-specific content)');
  }

  return scenarios;
}

// ── 4. Test case generation ──────────────────────────────────────────────────

async function generateTestCases(ticket: any, scenarios: any[]) {
  sep(`4. Test Case Generation (JSON + Playwright)`);

  const selectedScenarios = scenarios.filter(s => s.selected);
  console.log(`  Selected scenarios (${selectedScenarios.length}): ${selectedScenarios.map(s => s.title).join(' | ').slice(0, 200)}`);
  console.log('\n  Calling JsonTestGenerationService.generateAndCompile...');
  console.log('  (This calls Vertex AI — may take 30-120s)\n');

  const startMs = Date.now();

  const result = await JsonTestGenerationService.generateAndCompile({
    ticketId:     ticket.key,
    summary:      ticket.summary,
    description:  ticket.description,
    module:       ticket.module,
    issueType:    ticket.issueType === 'Bug' ? 'Bug' : 'Story',
    baseUrl:      TESTING_CREDENTIALS.baseUrl,
    credentials: {
      username:  TESTING_CREDENTIALS.username,
      password:  TESTING_CREDENTIALS.password,
      idNumber:  TESTING_CREDENTIALS.idNumber,
    },
    scenarios:    selectedScenarios,
    comments:     ticket.comments,
    customInstructions: [],
  });

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`  Completed in ${elapsed}s`);
  console.log(`  Success: ${result.success}`);

  if (!result.success) {
    console.log('\n  ❌ GENERATION FAILED:');
    (result.errors || []).forEach(e => console.log('    -', e));
    return result;
  }

  // Quality score
  if (result.qualityScore) {
    const q = result.qualityScore;
    sep('  Quality Score');
    console.log(`  Overall:      ${q.overall}/100 (${q.grade})`);
    console.log(`  Completeness: ${q.dimensions?.completeness ?? '?'}/100`);
    console.log(`  Specificity:  ${q.dimensions?.specificity ?? '?'}/100`);
    console.log(`  Coverage:     ${q.dimensions?.coverage ?? '?'}/100`);
    if (q.issues?.length) {
      console.log('  Issues:');
      q.issues.slice(0, 10).forEach((i: any) => console.log(`    [${i.severity}] ${i.message}`));
    }
  }

  // Test cases summary
  const spec = result.specification;
  if (spec?.scenarios?.length) {
    sep(`  Test Cases (${spec.scenarios.length} scenarios)`);
    for (const scenario of spec.scenarios) {
      console.log(`\n  📋 ${scenario.name} [${scenario.priority}]`);
      if (scenario.preconditions?.length) {
        console.log(`     Preconditions: ${scenario.preconditions.join('; ')}`);
      }
      console.log(`     Steps (${scenario.steps?.length || 0}):`);
      (scenario.steps || []).slice(0, 8).forEach((step: any, i: number) => {
        const stepType = step.type || step.action || '?';
        const target = step.element || step.field || step.target || step.selector || step.url || '';
        const val    = step.value  ? ` = "${String(step.value).slice(0, 40)}"` : '';
        const hint   = step.selectorHint ? ` [hint: ${step.selectorHint.slice(0, 30)}]` : '';
        console.log(`       ${i + 1}. [${stepType}] → "${target}"${val}${hint}`);
        if (step.assertion) console.log(`          assert: ${step.assertion}`);
      });
      if ((scenario.steps?.length || 0) > 8) {
        console.log(`       ... +${(scenario.steps?.length || 0) - 8} more steps`);
      }
      if (scenario.expectedOutcome) {
        console.log(`     Expected: ${scenario.expectedOutcome}`);
      }
    }
  }

  // Compiled script preview
  if (result.compiledScript) {
    sep('  Compiled Playwright Script (first 60 lines)');
    const lines = result.compiledScript.split('\n').slice(0, 60);
    lines.forEach((l, i) => console.log(`  ${String(i + 1).padStart(3)}  ${l}`));
    if (result.compiledScript.split('\n').length > 60) {
      console.log(`  ... (${result.compiledScript.split('\n').length} total lines)`);
    }
  }

  if (result.scriptPath) {
    console.log(`\n  Script saved: ${result.scriptPath}`);
  }

  // Show McpStep[] output (Phase 2 validation)
  if (result.mcpSteps && Object.keys(result.mcpSteps).length > 0) {
    console.log(`\n  McpStep[] (for TestScriptStore — ${Object.keys(result.mcpSteps).length} scenario(s)):`);
    for (const [scenarioId, steps] of Object.entries(result.mcpSteps)) {
      console.log(`    ${scenarioId}: ${steps.length} steps → ${steps.map((s: any) => s.action).join(', ')}`);
    }
  }

  if (result.tokensUsed) {
    const t = result.tokensUsed;
    console.log(`\n  Tokens: prompt=${t.prompt} completion=${t.completion} total=${t.total}`);
  }

  return result;
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 GoHybridAI — ATT-15 Full Pipeline E2E Test');
  console.log(`   Time:    ${new Date().toISOString()}`);
  console.log(`   App URL: ${TESTING_CREDENTIALS.baseUrl}`);
  console.log(`   Jira:    ${JIRA_BASE}\n`);

  // Step 1: Jira
  const ticket = await fetchJiraTicket();

  // Step 2: Discovery
  await checkDiscovery(ticket.module);

  // Step 3: Scenarios
  const scenarios = await generateScenarios(ticket);
  if (!scenarios.length) {
    console.log('\n❌ No scenarios generated — cannot proceed to test case generation');
    process.exit(1);
  }

  // Step 4: Test cases
  const result = await generateTestCases(ticket, scenarios);

  // Final summary
  sep('Pipeline Summary');
  console.log(`  Ticket:     ${ticket.key} — ${ticket.summary}`);
  console.log(`  Module:     ${ticket.module}`);
  console.log(`  Scenarios:  ${scenarios.length} (${scenarios.filter((s: any) => s.selected).length} selected)`);
  console.log(`  Generation: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
  if (result.qualityScore) {
    console.log(`  Quality:    ${result.qualityScore.overall}/100 (${result.qualityScore.grade})`);
  }
  console.log(`  Cases:      ${result.specification?.scenarios?.length ?? 0}`);
  console.log(`  Script:     ${result.scriptPath || '(not saved)'}`);
  console.log('');
}

main().catch(err => {
  console.error('\n💥 Pipeline crashed:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
