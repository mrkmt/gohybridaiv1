Full System Deep-Dive Plan — GoHybridAI

Layer 1 — System ရဲ့ စစ်မှန်သောအခြေအနေ

28 DB tables    ✓ ရှိပြီ

MCP infra       ✓ ရှိပြီ (PlaywrightMcpClient, McpTestExecutor, TestScriptStore)

AI Brain        ✓ ရှိပြီ (module\_skills, skill\_patterns, knowledge\_vectors, business\_rules)

Sprint runner   ✓ ရှိပြီ

ဒါပေမဲ့ ချိတ်ဆက်မှု ကွဲပြားနေတာတွေ ရှိတယ် ↓

Layer 2 — AI Brain / Knowledge / Skill (ဘာရှိ ဘာပျောက်)

ရှိပြီသော Knowledge Layer

DB Tables:

&#x20; module\_skills     — business rules, navigation path, known selectors, test patterns per module

&#x20; skill\_patterns    — learned patterns from passing tests (file + DB)

&#x20; knowledge\_vectors — 768-dim embeddings (nomic-embed-text-v1.5) for semantic search

&#x20; business\_rules    — formula-based rules per module (confidence score ပါ)

&#x20; workflow\_rules    — Add/Edit/Delete workflow states per module (required fields, toast patterns)

Services:

&#x20; SkillStore           — reads module\_skills + skill\_patterns from DB

&#x20; SmartSkillManager    — selects relevant skills for prompts (file-based Auto-Generated/)

&#x20; UnifiedSkillResolver — resolves skill context: module → prompt context block

Problem: Knowledge Feedback Loop မရှိ

Currently:

&#x20; Test PASS → result saved → ✗ knowledge NOT updated

Should be:

&#x20; Test PASS → result saved → module\_skills update (healed selector saved)

&#x20;                          → skill\_patterns update (new pattern learned)

&#x20;                          → SkillRegistryService.register(healed selector)

&#x20; 

&#x20; Next ticket same module → SkillStore returns healed selector as first choice

&#x20;                         → AI uses it in generation → fewer failures

Problem: Skills Not Injected Into Healing

McpHealingService (planned) will call AI with:

&#x20; CURRENT (planned): snapshot + failed step only

&#x20; SHOULD BE:         snapshot + failed step + module\_skills context

&#x20;                    (AI knows field business rules → better healing)

Layer 3 — Database (ဘာသုံး ဘာမသုံး ဘာပြင်ရမည်)

Tables ဘာပြင်ရမည်

\-- 1. test\_sessions မှာ mcp\_steps မလိုဘူး

\--    TestScriptStore (test\_scripts table) မှာ သိမ်းမယ်

\--    test\_scripts table ရှိပြီ: steps JSONB column ပါပြီ ✓



\-- 2. test\_scripts table — scenario\_type column ထပ်ထည့်ရမယ်

ALTER TABLE test\_scripts

&#x20; ADD COLUMN IF NOT EXISTS scenario\_type TEXT DEFAULT 'happy\_path',

&#x20; -- 'happy\_path' | 'negative' | 'edge\_case' | 'regression'

&#x20; ADD COLUMN IF NOT EXISTS heal\_history JSONB DEFAULT '\[]';

&#x20; -- \[{step\_index, original\_selector, healed\_selector, healed\_at}]



\-- 3. healing\_counters (ရှိပြီ) — McpHealingService မှာ သုံးမည်

\--    error\_signature per ticket+case → heal attempt count → max 3 → give up



\-- 4. module\_skills — feedback loop update ပြင်ရမည်

\--    healing success → known\_selectors JSONB update

Table Usage Map (ဘာကို ဘာသုံးတယ်)

Table	Generation မှာ	Execution မှာ	Healing မှာ	Regression မှာ

test\_sessions	write scenarios/cases	write results/phase	read session	-

module\_skills	read → prompt inject	-	read → heal context	read

skill\_patterns	read → prompt inject	-	read	read

business\_rules	read → prompt inject	-	read	read

workflow\_rules	read → prompt inject	-	read	read

test\_scripts	write mcpSteps	read steps	write healed steps	read steps

healing\_counters	-	-	write/read count	-

sprint\_run\_results	-	-	-	write results

knowledge\_vectors	read (semantic)	-	read	-

Layer 4 — Full Flow (End to End)

USER                  FRONTEND              BACKEND               AI/BROWSER/DB

────                  ────────              ───────               ─────────────

1\. Jira ticket open

&#x20; "ATT-33"  ──────► POST /testing/chat/mention

&#x20;                     ↓ detect ticket ID

&#x20;                     ↓

&#x20; ◄─────────────── { ticket: ATT-33 }

2\. Start Testing ──► POST /testing/ATT-33/start

&#x20;                     ↓ TestingWorkflowController.startSession()

&#x20;                     ↓ DiscoveryCacheService.get('Leave Policy')

&#x20;                     │   HIT → return cached 3 elements

&#x20;                     │   MISS → runLiveBackground() → Playwright login → probe

&#x20;                     ↓

&#x20;                     ↓ JiraContextBuilder.build(ATT-33)

&#x20;                     ↓   → fetch linked tickets (AB-60)

&#x20;                     ↓   → resolve GrowthBook feature flag context

&#x20;                     ↓

&#x20;                     ↓ TestSessionService.createOrGet(ATT-33, userId)

&#x20;                     ↓   → DB: INSERT test\_sessions

&#x20;                     ↓

&#x20; ◄─────────────── { phase: 'discovery', sampleSelectors: \[...] }

3\. Generate Scenarios ► POST /testing/ATT-33/scenarios

&#x20;                     ↓ TestingGenerationService.generateScenarios()

&#x20;                     ↓ BUILD PROMPT:

&#x20;                     │   - Jira ticket + linked ticket summaries

&#x20;                     │   - Module: Leave Policy

&#x20;                     │   - Discovery cache (3 elements)

&#x20;                     │   - SkillStore.getContext('Leave Policy')

&#x20;                     │       → module\_skills (business rules)

&#x20;                     │       → skill\_patterns (learned selectors)

&#x20;                     │       → business\_rules (formula rules)

&#x20;                     ↓

&#x20;                     ↓ AI CALL 1: AiControllerService.generate('TEST\_GENERATION')

&#x20;                     ↓   Gemini → JSON array of scenarios

&#x20;                     ↓   \[{ id, title, tag: 'Negative'|'Happy Path'|... }]

&#x20;                     ↓

&#x20;                     ↓ TestSessionService.update(scenarios)

&#x20; ◄─────────────── { scenarios: \[5 scenarios] }

4\. Generate Test Cases ► POST /testing/ATT-33/test-cases/generate

&#x20;                     ↓ TestingGenerationService.generateTestCases()

&#x20;                     ↓ JsonTestGenerationService.generateAndCompile()

&#x20;                     ↓

&#x20;                     ↓ CONTEXT BUILD:

&#x20;                     │   ContextManager.trim(jiraData, 16k tokens)

&#x20;                     │   module\_skills → selectorReference

&#x20;                     │   workflow\_rules → enterprise rules

&#x20;                     │   knowledge\_vectors → semantic relevant rules

&#x20;                     ↓

&#x20;                     ↓ AI CALL 2: AgentOrchestrator.generateTestPlan()

&#x20;                     │   \[Planner Agent]

&#x20;                     │   Input: ticket + scope + scenarios

&#x20;                     │   Output: plain-English test strategy

&#x20;                     ↓

&#x20;                     ↓ AI CALL 3: AgentOrchestrator.generateJsonSpec()

&#x20;                     │   \[Coder Agent, structured=true]

&#x20;                     │   Input: test plan + UI Map + selectors

&#x20;                     │   Output: TestSpecification JSON

&#x20;                     │   Each scenario tagged: type + healStrategy

&#x20;                     ↓

&#x20;                     ↓ validateTestSpecification() → Zod schema check

&#x20;                     ↓ resolveSpecTargets() → match elements to discovery

&#x20;                     ↓ convertScenarioToMcpSteps() → McpStep\[] per scenario

&#x20;                     ↓

&#x20;                     ↓ \[NEW] TestScriptStore.save(pool, {

&#x20;                     │     ticketId, scenarioId, steps, scenario\_type

&#x20;                     │   }) for each scenario

&#x20;                     ↓

&#x20;                     ↓ TestSessionService.update(testCases, compiledScripts)

&#x20; ◄─────────────── { testCases: \[3 cases] }

5\. Approve \& Run ──► POST /testing/ATT-33/test-cases/approve

&#x20;                     ↓ session.approvedTestCases = true

&#x20;                     ↓ JiraUploadService.uploadTestCases() → Jira field update

&#x20; ◄─────────────── { success: true }

&#x20;                  ► POST /testing/ATT-33/execute

&#x20;                     ↓ sessions.assertApproved()

&#x20;                     ↓ sessions.acquireLock()

&#x20;                     ↓ phase = 'executing'

&#x20;                     ↓

&#x20;                     ↓ \[NEW FLOW] McpExecutionOrchestrator:

&#x20;                     │

&#x20;                     │  for each testCase (sequential):

&#x20;                     │

&#x20;                     │    \[1] TestScriptStore.load(ticketId, scenarioId)

&#x20;                     │         → steps = McpStep\[], scenario\_type

&#x20;                     │

&#x20;                     │    \[2] BUILD LOGIN OPTIONS (from env vars):

&#x20;                     │         url:      BASE\_URL

&#x20;                     │         username: TEST\_USERNAME

&#x20;                     │         password: TEST\_PASSWORD

&#x20;                     │         idNumber: TEST\_IDNUMBER

&#x20;                     │

&#x20;                     │    \[3] McpTestExecutor.run(steps, { loginOptions })

&#x20;                     │         → PlaywrightMcpClient.create()

&#x20;                     │         → login → navigate → interact

&#x20;                     │         → StepResult per step

&#x20;                     │

&#x20;                     │    \[4a] ALL PASS:

&#x20;                     │         TestScriptStore.recordOutcome('PASS')

&#x20;                     │         module\_skills update (healed selectors)

&#x20;                     │         SkillRegistryService.register()

&#x20;                     │         emit: execution:step (PASS)

&#x20;                     │

&#x20;                     │    \[4b] STEP FAILS:

&#x20;                     │         McpHealingService.classify(failedStep, snapshot)

&#x20;                     │         │

&#x20;                     │         ├─ ACTION\_FAIL (selector not found):

&#x20;                     │         │   healAction(step, snapshot, module\_skills)

&#x20;                     │         │   → Gemini: "Fix selector. Context: \[module skills]"

&#x20;                     │         │   → healed McpStep → retry

&#x20;                     │         │   → PASS: save healed steps, update module\_skills

&#x20;                     │         │   → FAIL: healing\_counters++, CODE\_FAULT

&#x20;                     │         │

&#x20;                     │         ├─ ASSERTION\_FAIL (negative/edge case):

&#x20;                     │         │   scenario\_type == 'negative':

&#x20;                     │         │     healAssertion(step, snapshot)

&#x20;                     │         │     → scan snapshot for any error text

&#x20;                     │         │     → text\_mismatch → update assertion → retry

&#x20;                     │         │     → no\_error → REAL\_BUG (bug may be fixed!)

&#x20;                     │         │

&#x20;                     │         └─ UNRECOVERABLE:

&#x20;                     │             TestScriptStore.recordOutcome('FAIL')

&#x20;                     │             classify: CODE\_FAULT | REAL\_BUG

&#x20;                     │             emit: execution:step (FAIL + reason)

&#x20;                     │

&#x20;                     ↓

&#x20;                     ↓ buildArtifactsZip()

&#x20;                     ↓ TestSessionService.update(results, 'completed')

&#x20;                     ↓ emit: execution:complete

&#x20; ◄─────────────── { results: \[...], summary: {pass:1, fail:2} }

&#x20; WebSocket ──────── streaming step events throughout

Layer 5 — Per-User Isolation (5 Users)

SHARED (per module, all users):

&#x20; DiscoveryCacheService    — discovery/cache/{module}.json (24h TTL)

&#x20; module\_skills            — business rules (same HR system, same rules)

&#x20; skill\_patterns           — learned selectors (shared = better for all)

&#x20; SharedBrowserPool        — max 5 concurrent (1 per user)

&#x20; PlaywrightMCPPool        — max 5 concurrent (1 per user)

ISOLATED (per user):

&#x20; test\_sessions            — WHERE user\_id = $userId

&#x20; jira\_config              — per-user Jira credentials

&#x20; api\_keys                 — per-user API tokens

&#x20; audit\_logs               — every action tracked to userId

&#x20; execution lock           — (ticketId, userId) pair — users don't block each other

PROBLEM ← need to fix:

&#x20; SmartSkillManager saves to:

&#x20;   skills/Auto-Generated/recording-patterns/\*.json  — shared filesystem

&#x20;   skills/Auto-Generated/jira-patterns/\*.json       — shared filesystem

&#x20; 

&#x20; 5 users writing concurrently → file race condition

&#x20; Fix: DB-backed skill\_patterns table ကို exclusively သုံး

&#x20;      file-based fallback ဖြုတ်

Layer 6 — Type-Aware Execution (Negative / Edge Case)

Scenario Types (generation prompt မှာ tag):

&#x20; happy\_path  → healAction() only (selector fix)

&#x20; negative    → healAction() + healAssertion()

&#x20; edge\_case   → pre-step constraints extract + healAction() + healAssertion()

&#x20; regression  → TestScriptStore replay only (no regenerate)

Heal Strategy per Step:

&#x20; browser\_navigate    → URL wrong → derive from MODULE\_ROUTES

&#x20; browser\_click       → selector not found → snapshot → fix

&#x20; browser\_type        → selector not found → snapshot → fix

&#x20; browser\_snapshot    → assertText wrong?

&#x20;   negative test:    → scan snapshot for similar error text

&#x20;                     → text\_mismatch → update → retry

&#x20;                     → no\_error → REAL\_BUG

&#x20;   happy\_path:       → expected element not visible → CODE\_FAULT

&#x20; browser\_select\_option → option not found → snapshot → list available options → fix

Edge Case Pre-step:

&#x20; extract from snapshot:

&#x20;   input maxlength, type="number" min/max, pattern

&#x20; generate test data:

&#x20;   boundary:  max+1 digit, min-1 digit

&#x20;   empty:     required field left blank

&#x20;   invalid:   pattern violation (letters in number field)

&#x20;   duplicate: reuse last created record code

&#x20; inject into McpStep before run

Layer 7 — What Needs to Be Built (Precise Gap List)

GAP 1 — TestingGenerationService.ts (3 lines)

&#x20; Drop mcpSteps → pass through

&#x20; + scenario\_type tag from AI response → store in McpStep metadata

GAP 2 — TestingWorkflowController.ts (15 lines)

&#x20; After generateTestCases: TestScriptStore.save() for each scenario

GAP 3 — McpHealingService.ts (NEW, \~200 lines)

&#x20; classify(failedStep, snapshot) → ACTION\_FAIL | ASSERTION\_FAIL | UNRECOVERABLE

&#x20; healAction(step, snapshot, moduleSkills) → McpStep | null

&#x20; healAssertion(step, snapshot) → UpdatedAssertion | REAL\_BUG | null

&#x20; extractFieldConstraints(snapshot) → FieldConstraint\[]

&#x20; generateEdgeCaseData(constraints) → TestData\[]

GAP 4 — TestingExecutionOrchestrator.ts (replace \~60 lines)

&#x20; Remove: TestExecutionService.executeAllTestCases()

&#x20; Add:    McpExecutionLoop (type-aware, with healing)

&#x20; Add:    loginOptions from env vars

&#x20; Add:    McpExecutionResult → TestResult mapping

&#x20; Add:    Knowledge feedback loop (module\_skills update on heal pass)

GAP 5 — test\_scripts table migration (1 SQL change)

&#x20; ADD COLUMN scenario\_type TEXT DEFAULT 'happy\_path'

&#x20; ADD COLUMN heal\_history JSONB DEFAULT '\[]'

GAP 6 — SmartSkillManager.ts (file race fix)

&#x20; Remove file-based save → DB only (skill\_patterns table)

&#x20; Already has mkdirSync fix but that's a band-aid — proper fix is DB-only

GAP 7 — Generation prompt update (\~10 lines)

&#x20; Add scenario type tag instruction to AI prompt

&#x20; Add healStrategy to each McpStep in convertScenarioToMcpSteps()

Implementation Order (ဘာ ဦးစွာ လုပ်ရမည်)

Phase A — DB migration (10 min)

&#x20; ALTER TABLE test\_scripts → scenario\_type, heal\_history

Phase B — Pipeline wire-up (30 min, 2 files)

&#x20; GAP 1: TestingGenerationService → pass mcpSteps + scenario\_type

&#x20; GAP 2: Controller → TestScriptStore.save() after generation

Phase C — Orchestrator swap (2 hrs, 1 file)

&#x20; GAP 4: Replace TestExecutionService with McpTestExecutor loop

&#x20;        + login options + result mapping + WebSocket events

Phase D — McpHealingService (2 hrs, 1 new file)

&#x20; GAP 3: classify + healAction + healAssertion

Phase E — Generation prompt + type tagging (30 min)

&#x20; GAP 7: scenario\_type in AI prompt + McpStep healStrategy

Phase F — SmartSkillManager DB-only (30 min)

&#x20; GAP 6: remove file-based skill saves

Phase G — Knowledge feedback loop (1 hr)

&#x20; After heal pass: module\_skills + skill\_patterns update

Total estimated effort: \~7-8 hours

Risk: LOW — 80% infrastructure exists, changes are surgical



Risks

Risk	Severity	Mitigation

PlaywrightMcpClient login ပြဿနာ (GlobalHR login form selectors)	HIGH	env vars မှာ selector override ထည့်

McpTestExecutor session expire mid-test	MEDIUM	step တိုင်း session valid check

Gemini healAction response malformed JSON	MEDIUM	structured=true + Zod parse + fallback null

5 users concurrently healing → Gemini rate limit	LOW	healing\_counters max 3 attempts, then CODE\_FAULT

test\_scripts table migration fails	LOW	IF NOT EXISTS guard on ALTER



