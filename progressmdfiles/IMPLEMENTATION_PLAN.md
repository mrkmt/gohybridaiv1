# GoHybridAI — MCP Execution Implementation Plan

## Overview

Replace legacy `spawn playwright test .spec.ts` execution with the Zero-Weakness Hybrid MCP
architecture. 80% of infrastructure already exists. This document covers all layers before
any code is written.

---

## System State (Pre-Implementation)

### What Already Exists

| Component | File | Status |
|---|---|---|
| `PlaywrightMcpClient` | `src/services/mcp/PlaywrightMcpClient.ts` | Ready |
| `McpTestExecutor` | `src/services/mcp/McpTestExecutor.ts` | Ready |
| `TestScriptStore` | `src/services/mcp/TestScriptStore.ts` | Ready (DB-backed) |
| `SmartExecutionRouter` | `src/services/mcp/SmartExecutionRouter.ts` | Ready |
| `SprintRegressionRunner` | `src/services/mcp/SprintRegressionRunner.ts` | Ready |
| `McpDiscoveryService` | `src/services/mcp/McpDiscoveryService.ts` | Ready |
| `PlaywrightMCPPool` | `src/services/mcp/PlaywrightMCPPool.ts` | Ready |
| `mcpSteps` generation | `JsonTestGenerationService.ts` line 265 | Generated but dropped |
| `module_skills` table | DB migration v18 | Exists, partially populated |
| `skill_patterns` table | DB migration v19 | Exists |
| `knowledge_vectors` table | DB migration v20 | Exists |
| `business_rules` table | DB migration v17 | Exists |
| `workflow_rules` table | DB migration v23 | Exists |
| `healing_counters` table | DB migration v24 | Exists |
| `test_scripts` table | DB migration v16 | Exists, missing 2 columns |

### What is Broken / Missing

| Gap | File | Issue | Fixed |
|---|---|---|---|
| GAP 1 | `TestingGenerationService.ts:105` | `mcpSteps` dropped — not passed through | DONE |
| GAP 2 | `TestingWorkflowController.ts` | `TestScriptStore.save()` never called after generation | DONE |
| GAP 3 | — | `McpHealingService.ts` does not exist | DONE |
| GAP 4 | `TestingExecutionOrchestrator.ts:67` | Still calls `TestExecutionService` (spawn node) | DONE |
| GAP 5 | `test_scripts` table | Missing `scenario_type` and `heal_history` columns | DONE (migration v29) |
| GAP 6 | `SmartSkillManager.ts:251` | File-based save without directory → ENOENT race condition | DONE (DB-only via setPool) |
| GAP 7 | `AgentOrchestrator.ts` prompt | Scenarios not tagged with `type` + `healStrategy` | DONE |

---

## Layer 1 — AI Brain / Knowledge / Skill

### Knowledge Sources (injected into AI prompts)

```
module_skills     (DB) — business rules, navigation path, known selectors per module
skill_patterns    (DB) — learned patterns from passing tests
business_rules    (DB) — formula-based validation rules per module (confidence score)
workflow_rules    (DB) — Add/Edit/Delete states, required fields, toast patterns
knowledge_vectors (DB) — 768-dim embeddings for semantic rule retrieval
DiscoveryCacheService — live/cached DOM inventory (buttons, inputs, grids, modals)
```

### AI Call Sequence (per ticket)

```
Call 1 — Scenario Generation (TEST_GENERATION role)
  Input:  Jira ticket + linked tickets + module + discovery elements + SkillStore context
  Output: JSON array [{ id, title, tag: 'Negative'|'Happy Path'|'Regression'|'Edge Case' }]
  Model:  Vertex AI Gemini 2.5 Flash
  Tokens: ~4k prompt / ~1k output

Call 2 — Test Plan (TEST_GENERATION role)  [AgentOrchestrator Phase 1]
  Input:  Jira ticket (trimmed 8k) + scope instructions + selected scenarios
  Output: Plain-English test strategy
  Model:  Vertex AI Gemini 2.5 Flash
  Tokens: ~8k prompt / ~2k output

Call 3 — JSON Spec Generation (CODE role, structured=true)  [AgentOrchestrator Phase 2]
  Input:  Test plan + UI Map (selectorReference) + enterprise rules + skill context
  Output: TestSpecification JSON (strict schema, Zod-validated)
  Model:  Vertex AI Gemini 2.5 Flash (responseMimeType: application/json)
  Tokens: ~16k prompt / ~8k output (maxTokens: 32768)

Call 4 — Step Healing [McpHealingService — on failure only]
  Input:  Failed McpStep + live accessibility snapshot + module_skills context
  Output: Corrected McpStep JSON or null
  Model:  Vertex AI Gemini 2.5 Flash (structured=true)
  Tokens: ~2k prompt / ~200 output
  Cost:   Only triggered on step failure (~5-15% of steps)
```

### Knowledge Feedback Loop (missing — will add)

```
Test PASS with healed selector:
  → module_skills.known_selectors UPDATE (append healed selector)
  → skill_patterns INSERT (new pattern from this run)
  → heal_history append to test_scripts row
  → SkillRegistryService.register(module, selector)

Next ticket same module:
  → SkillStore returns healed selector as first-choice
  → AI generation uses it → fewer failures → less healing cost
```

---

## Layer 2 — Database

### Tables Used in MCP Execution Flow

| Table | Generation | Execution | Healing | Regression |
|---|---|---|---|---|
| `test_sessions` | write scenarios/cases | write phase/results | read session | — |
| `test_scripts` | write mcpSteps | read steps | write healed steps | read steps |
| `module_skills` | read → prompt | — | read → context | read |
| `skill_patterns` | read → prompt | — | write (new pattern) | read |
| `business_rules` | read → prompt | — | read | read |
| `workflow_rules` | read → prompt | — | read | read |
| `healing_counters` | — | — | read/write count | — |
| `sprint_run_results` | — | — | — | write |
| `knowledge_vectors` | read (semantic) | — | — | — |
| `audit_logs` | write | write | write | write |

### Schema Changes Required

```sql
-- GAP 5: test_scripts needs 2 new columns
ALTER TABLE test_scripts
  ADD COLUMN IF NOT EXISTS scenario_type TEXT NOT NULL DEFAULT 'happy_path',
  -- values: 'happy_path' | 'negative' | 'edge_case' | 'regression'
  ADD COLUMN IF NOT EXISTS heal_history JSONB NOT NULL DEFAULT '[]';
  -- [{step_index, original, healed, healed_at, success}]

-- No other schema changes needed — all other tables exist and are correct
```

### Per-User Data Isolation

| Resource | Scope | Notes |
|---|---|---|
| `test_sessions` | `WHERE user_id = $userId` | Full isolation |
| `jira_config` | `WHERE user_id = $userId` | Per-user Jira credentials |
| `api_keys` | `WHERE user_id = $userId` | Per-user API tokens |
| `audit_logs` | `user_id` column on every row | Full traceability |
| Discovery cache | Per module (shared) | Same HR app → same elements for all users |
| `module_skills` | Per module (shared) | Business rules are global to the HR system |
| `skill_patterns` | Per module (shared) | Healed selectors benefit all users |
| `test_scripts` | Per ticket+scenario | Not user-scoped (ticket is the key) |
| Browser pool | `SharedBrowserPool` max 5 | 1 per concurrent user |
| MCP pool | `PlaywrightMCPPool` max 5 | 1 per concurrent user |
| Execution lock | `(ticketId, userId)` | Users don't block each other |

---

## Layer 3 — API Endpoints (unchanged)

All existing endpoints remain. No new endpoints needed for Phase A–D.

```
POST /api/testing/:ticketId/start              — init session + discovery
POST /api/testing/:ticketId/scenarios          — AI scenario generation
POST /api/testing/:ticketId/test-cases/generate — AI test case gen + save mcpSteps to DB
POST /api/testing/:ticketId/test-cases/approve  — set approved flag
POST /api/testing/:ticketId/execute             — MCP execution (Phase C changes here)
POST /api/testing/:ticketId/execute/retry       — retry failed cases
GET  /api/mcp/scripts                          — view saved passing scripts
GET  /api/mcp/scripts/stats                    — aggregate script library stats
POST /api/mcp/sprint/run                       — sprint regression batch
```

Future endpoints (Phase G+):
```
GET  /api/testing/:ticketId/heal-history        — view healing log per ticket
GET  /api/module-skills/:moduleName             — view learned selectors per module
```

---

## Layer 4 — Full End-to-End Flow (Post-Implementation)

```
USER ACTION               BACKEND SERVICES                    AI / BROWSER / DB
───────────               ────────────────                    ─────────────────

1. Start ticket
   POST /start
     TestSessionService.createOrGet()           → INSERT test_sessions
     DiscoveryCacheService.get(module)
       HIT  → return cached elements
       MISS → runLiveBackground() → Playwright → PageElementDiscoveryService
     JiraContextBuilder.build(ticketId)         → fetch linked tickets
     return { phase:'discovery', sampleSelectors }

2. Generate Scenarios
   POST /scenarios
     SkillStore.getContext(module)              → read module_skills, skill_patterns
     AI CALL 1: generateScenarios()            → Gemini → JSON[{id,title,tag,type}]
     TestSessionService.update(scenarios)       → UPDATE test_sessions

3. Generate Test Cases
   POST /test-cases/generate
     JsonTestGenerationService.generateAndCompile()
       ContextManager.trim(jiraData)            → token budget management
       AI CALL 2: generateTestPlan()            → Gemini → plain-English strategy
       AI CALL 3: generateJsonSpec()            → Gemini structured → TestSpecification
       validateTestSpecification()              → Zod schema check
       resolveSpecTargets()                     → match elements to discovery cache
       convertScenarioToMcpSteps()             → McpStep[] per scenario + scenario_type tag
     [NEW] for each scenario:
       TestScriptStore.save(pool, {            → INSERT test_scripts
         ticketId, scenarioId, steps,            (steps JSONB, scenario_type)
         scenario_type, status:'PENDING'
       })
     TestSessionService.update(testCases)      → UPDATE test_sessions

4. Approve
   POST /test-cases/approve
     TestSessionService.approve()              → approved_test_cases = true
     JiraUploadService.uploadTestCases()       → Jira custom field update

5. Execute
   POST /execute
     sessions.assertApproved()                → 409 if not approved
     sessions.acquireLock()                   → 409 if already running
     phase = 'executing'

     [NEW] for each testCase (sequential, concurrency=1):

       [Step A] Load steps from DB
         TestScriptStore.load(pool, ticketId, scenarioId)
         → { steps: McpStep[], scenario_type }

       [Step B] Build login options
         { url: BASE_URL, username: TEST_USERNAME,
           password: TEST_PASSWORD, idNumber: TEST_IDNUMBER,
           usernameSelector, passwordSelector, submitSelector }

       [Step C] Execute
         McpTestExecutor.run(steps, { loginOptions, headless:true })
         → PlaywrightMcpClient.create()
         → login → navigate → per-step actions
         → { passed, stepResults, durationMs }

       [Step D-Pass] All steps passed
         TestScriptStore.recordOutcome('PASS')
         module_skills update (selector confirmed)
         SkillRegistryService.register()
         emit: execution:step (all PASS)

       [Step D-Fail] A step failed
         McpHealingService.classify(failedStep, snapshot)

         ACTION_FAIL (selector timeout/not found):
           moduleSkills = SkillStore.getContext(module)
           healedStep = McpHealingService.healAction(step, snapshot, moduleSkills)
           → AI CALL 4: Gemini → corrected McpStep
           if healedStep:
             retry step → PASS → save healed steps to TestScriptStore
             module_skills.known_selectors += healedStep.selector
             heal_history append to test_scripts
           else:
             healing_counters++ → max 3 → CODE_FAULT

         ASSERTION_FAIL (scenario_type == 'negative' or 'edge_case'):
           healedAssertion = McpHealingService.healAssertion(step, snapshot)
           → scan snapshot for any error/validation text
           → text_mismatch: update assertion text → retry
           → no_error: REAL_BUG (application bug confirmed or already fixed)

         UNRECOVERABLE:
           TestScriptStore.recordOutcome('FAIL')
           classify: CODE_FAULT | REAL_BUG
           emit: execution:step (FAIL + category + reason)

     buildArtifactsZip()
     TestSessionService.update(results, phase:'completed')
     emit: execution:complete { results, summary }

6. Retry (optional)
   POST /execute/retry
     filter results → failed only
     repeat Step 5 for failed cases
     merge: existing passed + new results

7. Upload to Jira
   POST /results/upload
     JiraUploadService.uploadResults()
     attach artifacts ZIP
     update Jira ticket comment

8. Sprint Regression (overnight batch)
   POST /mcp/sprint/run
     SprintRegressionRunner.run(sprintId)
     for each ticket in sprint:
       SmartExecutionRouter.route()
         has saved steps? → McpTestExecutor replay (zero AI)
         no steps?        → generateAndCompile → McpTestExecutor → save
         UI drift?        → re-discover → regenerate → execute → save
     sprint_run_results INSERT per ticket
     Jira comment + notification
```

---

## Layer 5 — Type-Aware Execution

### Scenario Types

| Type | Tag (from AI) | Healing Strategy |
|---|---|---|
| `happy_path` | `Happy Path` | `healAction()` only — fix wrong selector |
| `negative` | `Negative` | `healAction()` + `healAssertion()` — error may be different text or absent |
| `edge_case` | `Edge Case` | pre-step constraints extract + `healAction()` + `healAssertion()` |
| `regression` | `Regression` | `TestScriptStore` replay only — no AI regenerate |

### McpStep Heal Strategy Tag (in generation)

```typescript
// convertScenarioToMcpSteps() will add:
{
  action: 'browser_snapshot',
  assertText: 'Leave Policy not found.',
  assertType: 'error_message',          // 'error_message' | 'success_message' | 'visible'
  healStrategy: 'update_or_real_bug'    // 'update_or_real_bug' | 'selector_fix' | 'skip'
}
```

### McpHealingService Decision Tree

```
classify(failedStep, snapshot):
  step.action == browser_navigate  → UNRECOVERABLE (route wrong)
  step.action == browser_click |
               browser_type |
               browser_select_option  → ACTION_FAIL
  step.action == browser_snapshot
    with assertText              → ASSERTION_FAIL
  default                        → ACTION_FAIL

healAction(step, snapshot, moduleSkills):
  prompt = "Step failed: {step JSON}
            Live page state: {snapshot.text}
            Module business rules: {moduleSkills}
            Return corrected McpStep JSON only. null if unrecoverable."
  AI CALL → parse → Zod validate → McpStep | null

healAssertion(step, snapshot):
  scan snapshot.text for any error/validation patterns
  if similar text found (fuzzy match >80%):
    → return { ...step, assertText: foundText } (update assertion)
  if no error text found:
    → return 'REAL_BUG'  (expected error did not appear)
  if unexpected content:
    → return 'INVESTIGATE'

Edge Case Pre-step:
  extractFieldConstraints(snapshot):
    → input[maxlength], input[type="number"][min][max], input[pattern]
    → select options list
  generateEdgeCaseData(constraints):
    boundary: max+1, min-1, empty, special_chars, duplicate_code
  inject into McpStep.text before run
```

---

## Layer 6 — Multi-User (5 Users) Resource Limits

```
SharedBrowserPool:    setMaxConcurrent(5)   — 1 Playwright browser per user
PlaywrightMCPPool:    setMaxSize(5)         — 1 MCP process per user
WorkerQueue:
  discovery slots:    3 max concurrent      — heaviest operation (login + probe)
  execution slots:    5 max concurrent      — MCP replay is lighter
PM2 workers:          2 (Node.js processes) — balance CPU + RAM
PostgreSQL pool:      max: 20              — 2 workers × 10 conn each
```

---

## Layer 7 — Files to Change / Create

### New Files

| File | Size | Purpose |
|---|---|---|
| `src/services/mcp/McpHealingService.ts` | ~220 lines | classify + healAction + healAssertion + edge case data |

### Modified Files

| File | Change | Lines |
|---|---|---|
| `src/services/generation/TestingGenerationService.ts` | Pass `mcpSteps` + `scenario_type` through | ~5 |
| `src/controllers/TestingWorkflowController.ts` | Call `TestScriptStore.save()` after generation | ~20 |
| `src/services/execution/TestingExecutionOrchestrator.ts` | Replace `TestExecutionService` with `McpTestExecutor` loop + healing | ~100 |
| `src/services/AgentOrchestrator.ts` (prompt) | Add `type` + `healStrategy` tags to scenario generation | ~10 |
| `src/services/skills/SmartSkillManager.ts` | DB-only save (remove file-based, race condition fix) | ~20 |

### Retired (kept, bypassed)

| File | Status |
|---|---|
| `src/services/execution/TestExecutionService.ts` | Orchestrator no longer calls it |
| `src/services/execution/SelfHealingService.ts` | Replaced by `McpHealingService` |
| `src/services/generation/JSONToPlaywrightCompiler.ts` | Generation still compiles but execution ignores compiled scripts |

---

## Implementation Phases

### Phase A — DB Migration (10 min) [DONE]
- ALTER TABLE `test_scripts` → add `scenario_type`, `heal_history`
- Migration v29 added to `MigrationManager.ts`

### Phase B — Pipeline Wire-up (30 min) [DONE]
- `TestingGenerationService.ts`: `mcpSteps` added to `GenerationTestCaseResult` interface + return value
- `TestingWorkflowController.ts`: `TestScriptStore.save()` loop after generation + `buildScenarioTypeMap()`

### Phase C — Orchestrator Swap (2 hrs) [DONE]
- `TestingExecutionOrchestrator.ts`: full rewrite — `TestExecutionService` replaced with `McpTestExecutor` loop
- Login options from env vars (`TEST_USERNAME`, `TEST_PASSWORD`, `TEST_IDNUMBER`, `BASE_URL`)
- `McpExecutionResult` → `TestResult` mapping
- WebSocket events: `execution:step`, `execution:log`, `execution:progress`, `execution:complete`
- Healing wired: `McpHealingService.classify()` → `healAction()` / `healAssertion()` on step fail
- `TestScriptStore.save()` on pass, `recordOutcome()` on fail

### Phase D — McpHealingService (2 hrs) [DONE]
- `McpHealingService.ts`: classify + healAction + healAssertion + extractFieldConstraints + generateEdgeCaseData
- Wired into orchestrator `tryHeal()` method

### Phase E — Scenario Type Tagging (30 min) [DONE]
- `AgentOrchestrator.ts`: added `type` + `healStrategy` to JSON schema example + rule 9
- `TestingGenerationService.ts`: extracts `scenarioTypeMap` from spec, added to `GenerationTestCaseResult`
- `TestingWorkflowController.ts`: prefers AI-sourced `scenarioTypeMap` over tag-based heuristic

### Phase F — SmartSkillManager DB-only (30 min) [DONE]
- `SmartSkillManager.ts`: added `setPool()`, DB upsert via `upsertToDb()`, DB-backed `loadSkillIndex()`
- File writes only fire when no pool is injected (backward-compat fallback)
- `api/server.ts`: `SmartSkillManager.setPool(pool)` wired at startup

### Phase G — Knowledge Feedback Loop (1 hr) [DONE]
- `TestingExecutionOrchestrator.ts`: `persistHealedSelector()` helper
- After ACTION_FAIL heal passes: writes healed selector to `module_skills.known_selectors` (JSONB merge) AND inserts row into `skill_patterns`
- Future AI prompts for same module will see the correct selector in skill context

---

## Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| GlobalHR login selectors wrong in `loginOptions` | HIGH | Configurable via env var overrides; fallback to `.k-textbox` patterns |
| Session expires mid-test (8h TTL) | MEDIUM | `BrowserSessionManager` check before each step; re-login if needed |
| Gemini `healAction` returns malformed JSON | MEDIUM | `structured=true` + Zod parse + null fallback → `CODE_FAULT` |
| 5 users healing simultaneously → Gemini 429 | LOW | `healing_counters` max 3 attempts per case; exponential backoff |
| `test_scripts` migration fails on existing data | LOW | `IF NOT EXISTS` guard; default values are safe |
| `McpTestExecutor` step timeout (page detached) | MEDIUM | `stopOnFailure=true`; classify as `CODE_FAULT`; don't retry infinitely |
| `SmartSkillManager` concurrent DB write (5 users) | LOW | PostgreSQL `ON CONFLICT DO UPDATE` is safe for concurrent upserts |

---

## Success Criteria

| Metric | Target |
|---|---|
| 409 Conflict on execute | Gone (fixed) |
| Compiled script `.spec.ts` spawn | Gone (MCP replaces) |
| `VisualForensicsService` import error | Gone (SelfHealingService retired) |
| `SmartSkillManager` ENOENT | Gone (DB-only) |
| Browser session conflict (parallel) | Gone (concurrency=1) |
| Self-healing on selector fail | Working (McpHealingService) |
| Negative test assertion adapt | Working (healAssertion) |
| Second run same ticket | Zero AI cost (TestScriptStore replay) |
| Sprint regression | Working (SprintRegressionRunner activated) |
| 5 users concurrent | Stable (pool limits enforced) |
