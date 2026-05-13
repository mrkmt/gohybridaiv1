# GoHybridAI — Roadmap

## Stack

| Layer | Tech |
|---|---|
| Backend | Node.js / TypeScript / Express — port 4001 |
| Frontend | React / Vite — port 4200 |
| AI | Vertex AI Gemini 2.5 Flash (UnifiedAIOrchestrator) |
| Browser | Playwright (discovery + execution) |
| DB | PostgreSQL (pg pool) |
| Auth | JWT + bcrypt |
| Target deployment | Ubuntu 22.04 LTS — 5 concurrent users |

---

## Done

### Infrastructure
- [x] Binary-corrupted files reconstructed: `app.ts`, `settingsRoutes.ts`, `JiraConfigService.ts`, `JiraClientFactory.ts`, `TestingGenerationService.ts`
- [x] `authRouter` + `testingRouter` mounted and reachable end-to-end
- [x] `AuthService.setPool(pool)` — login works

### Discovery pipeline
- [x] `MODULE_ROUTES` 14 → 85 entries, `MODULE_ALIASES` 15 → 60 entries
- [x] `runLiveBackground` self-deadlock fixed
- [x] Nav/sidebar element pollution, Kendo grid wait, TOCTOU race, session expiry guard all fixed
- [x] Grid/modal/menu rich extraction; icon-only buttons captured

### Execution pipeline (bugs fixed)
- [x] **409 Conflict** — `approveAndExecute` calls `/approve` before `/execute`
- [x] **1-of-5 test cases** — `maxTokens` 8192 → 32768 in `agent_profiles.json`
- [x] **React duplicate key** — `key={s.selector || s.name}`
- [x] **SelfHealingService bad import** — `./VisualForensicsService` → `../VisualForensicsService`
- [x] **SmartSkillManager ENOENT** — `mkdirSync` before writeFileSync (band-aid, now fully DB-only)
- [x] **Parallel browser session conflict** — concurrency 3 → 1 (sequential)
- [x] **MCP process exits code 1** — removed invalid `--output-format=markdown` flag from PlaywrightMcpClient spawn
- [x] **DB `inconsistent types` on recordOutcome** — split `$3` into `$3::text` + `$4::int`
- [x] **Jira Test Case format unreadable** — `humanStep()` helper + ordered list ADF; removed "Type: Alternative" noise
- [x] **AI hallucinating UI elements** — AgentOrchestrator rule 4: only use elements from UI Map
- [x] **MCP login fails** — `PlaywrightMcpClient.login()` rewritten: Angular-aware JS injection, navigate to `#/login` explicitly, correct fill order (idNumber → username → password)
- [x] **Login multi-selector strings** — `buildLoginOptions()` selectors simplified to single specific CSS selectors
- [x] **browser_navigate uses relative URLs** — `McpTestExecutor` resolves `/#/route` against `BASE_URL`; 2 s Angular stability wait added after every navigate
- [x] **browser_evaluate never actually called** — `McpTestExecutor` now calls `client.evaluate()` for evaluate steps
- [x] **AI generates relative goto URLs** — AgentOrchestrator rule 5a + example URL updated to full absolute form
- [x] **`browser_fill` tool does not exist** — `PlaywrightMcpClient.fill()` changed from `browser_fill` → `browser_type`; params updated (`value` → `text`)
- [x] **MCP silent failures — vacuous PASS** — `PlaywrightMcpClient.click()` + `fill()` + `selectOption()` check `isError` and throw; `McpTestExecutor.browser_click` has selectorHint Angular-aware `dispatchEvent` fallback
- [x] **GB (linked backlog) ticket context not passed to AI** — `TestingGenerationService.generateTestCases()` extracts `session.ticket.gbContext` → `description`, `businessRules`, `jiraComments` options
- [x] **SkillStore never wired in active generation path** — `generateTestCases()` accepts `pool?: Pool`, calls `SkillStore.getContext()`, passes as `options.skillContext`
- [x] **Discovery V2** — `navigateViaMenu()` sidebar-click nav; Kendo inputs in `discoverInputs`; `deepScanModals()` open/capture/close; `waitForGridData()` row-count poll; `deepScan: true` enabled; `setInterval.unref()`
- [x] **GB ticket UI** — `GBTicketContext` type; `LinkedRequirementCard` collapsible component in `GoHybridChat.part1.tsx`; enriched session fetched after `startSession()` to populate `gbContext`
- [x] **Discovery Mismatch Guard** — added `detectDashboardFallback()` heuristic to `discover-page.ts`; crawler now rejects discoveries that silently redirect to Dashboard; poisoned caches deleted
- [x] **TestSpec schema robustness** — `sanitiseSpec()` now coerces string `timeout` and `contains` fields from AI into number/boolean types; prevents Zod validation crashes
- [x] **AI Timeout Extension** — increased hardcoded timeout from 60s to 180s in `AiControllerService.ts` to support complex Test Specification generation (Phase 2)
- [x] **Hardened Discovery Guard** — moved `detectDashboardFallback` check to *after* element extraction in `discover-page.ts`; now validates the final inventory names, ensuring Dashboard widgets are never accidentally cached as module elements

### MCP Zero-Weakness Hybrid Architecture (Phases A–G — all done)
- [x] **Phase A** — DB migration v29: `scenario_type` + `heal_history` on `test_scripts`
- [x] **Phase B** — `TestingGenerationService` passes `mcpSteps` + `scenarioTypeMap` through; controller saves to `TestScriptStore`
- [x] **Phase C** — `TestingExecutionOrchestrator` full rewrite: McpTestExecutor loop, login from env vars, healing wired, WebSocket events
- [x] **Phase D** — `McpHealingService.ts` created: `classify()`, `healAction()`, `healAssertion()`, `extractFieldConstraints()`, `generateEdgeCaseData()`
- [x] **Phase E** — `AgentOrchestrator` schema + rules updated with `type` + `healStrategy` per scenario
- [x] **Phase F** — `SmartSkillManager` DB-only writes via `setPool()` + `upsertToDb()`; wired at server startup
- [x] **Phase G** — `persistHealedSelector()` writes healed element back to `module_skills` + `skill_patterns` after successful heal

### Tests (TDD — all green)
- [x] 34 tests passing (`TestingDiscoveryService` 12 + `TestingGenerationService` 22)

---

## Now — Active Issues

### Critical (block accurate test results)
- [x] **TEST_PASSWORD not in `.env`** — already present
- [x] **MCP login + navigation** — fixed (see Done)
- [x] **`browser_fill` does not exist** — fixed (see Done)
- [x] **MCP steps silently pass on error** — fixed (see Done)
- [x] **Ref-based click for non-accessible-name elements** — selectorHint fallback uses Angular-aware `dispatchEvent(new MouseEvent('click', { bubbles: true }))` instead of `el.click()`
- [x] **UI never shows linked GB ticket data** — `LinkedRequirementCard` component added to `GoHybridChat.part1.tsx`; rendered inside `TicketCard` when `ticket.gbContext` is present; `GoHybridChat.tsx` fetches enriched session after `startSession()` to populate `gbContext`; `GBTicketContext` type added to `frontend/src/types/index.ts`

### High
- [x] **Discovery doesn't find toolbar "Add" button** — `navigateViaMenu()` added
- [x] **`discoverInputs` misses Kendo-specific inputs** — Kendo component selectors added + deduplication
- [x] **Modal discovery requires `deepScan=true`** — `deepScanModals()` rewritten; `deepScan: true` enabled
- [x] **`runLive` 60s `setInterval` leaks into Jest** — `.unref()` added
- [x] **`waitForAngularStable` doesn't wait for grid data** — `waitForGridData()` row-count poll added

### Medium
- [ ] **Vertex AI SDK deprecated June 24 2026** — hard deadline to migrate to `@google/genai`

---

## Done (this sprint — 2026-04-26)

### Linked ticket display overhaul
- [x] `TestingJiraService` — `collectAllLinkedTickets()`: includes GB backlog ticket, dev (AD/GD) tickets, and same-project GT tickets (labeled `tested`)
- [x] `findLinkedGBKey()` — fixed `??` → `||` so explicit `null` outwardIssue/inwardIssue values are handled
- [x] `LinkedTicket.type` union extended with `'tested'` in both backend `TicketInfo` and frontend `types/index.ts`
- [x] `TicketCard` — `LinkedRequirementCard` removed; all linked tickets now shown as color-coded chips: Bug=red, Story=purple, Dev=sky, Tested=teal
- [x] `detectTicket()` — applies `gbTicket → gbContext` mapping so chips appear immediately on ticket detection (before startSession)

### Bot comment filter
- [x] `fetchGBTicket()` — filters GoHyAI automation comments (`BOT_BODY_PATTERNS`) before surfacing PO acceptance criteria

### Description pollution fix
- [x] `startSession()` — only uses GB description as fallback when AT ticket description is < 30 chars; GT ticket keeps its own description

### TestSpec validation crash fix
- [x] `TestSpecSchema.sanitiseSpec()` — `assertText`: coerces `expected: boolean/number → string`; `assertVisible`: converts AI-emitted `expected: true/false` to correct `visible: boolean` field and drops `expected`

### Scenario cap increase
- [x] `AgentOrchestrator` Rule 12: cap 3 → 8 scenarios; added Rule 13: one scenario per data variation for negative/edge_case types
- [x] `TestingGenerationService.parseScenarios()` slice 5 → 8

### Generation cache
- [x] `generateTestCases()` — session-level cache: if all requested scenarioIds already have test cases, returns cached immediately (0 AI tokens); partial cache: only regenerates missing IDs and merges

### Real token tracking
- [x] `AiControllerService.generateWithUsage()` — new method returning `{ response, usage }` with real `prompt_tokens`, `completion_tokens`, `total_tokens` from Vertex AI
- [x] `AgentOrchestrator.orchestrateGeneration()` — accumulates real usage across Phase 1 + Phase 2; returns `tokenUsage` in `OrchestrationResult`
- [x] `JsonTestGenerationService` — replaces hardcoded `{ prompt: 1000, completion: 500, total: 1500 }` with real counts from orchestrator

---

## Short-Term (next 2 weeks)

### Step 1 — Verify MCP execution quality
- [ ] **Re-run ATT-15 and ATT-22** → confirm fill steps type text, click steps land, assertions check correct selectors
- [ ] Fix Angular-aware click for icon/Kendo buttons — verify `dispatchEvent` fallback triggers correctly
- [ ] Verify heal triggers on first failure and saves healed steps to `test_scripts`

### Step 2 — Discovery sidebar navigation
- [ ] Inspect actual GlobalHR sidebar DOM — find real CSS class structure (all 6 candidate selectors timed out)
- [ ] Fix `navigateViaMenu()` with correct selector patterns for Angular Material/Kendo drawer
- [ ] **Re-run discovery for Performance Journal** — verify "Add Entry" button + modal fields appear in cached inventory

### Step 3 — SkillStore verification
- [x] `SkillStore.getContext()` wired into `TestingGenerationService.generateTestCases()`
- [x] Zod validation on 4 key endpoints
- [ ] Verify known selectors from `module_skills` appear in AI prompts after a successful heal cycle
- [ ] Rate limiting on discovery endpoints (prevent browser storm during concurrent sessions)

### Phase 3.7 — API hygiene remaining
- [ ] Rate limiting on discovery endpoints (prevent browser storm)

---

## Long-Term Roadmap

### Phase 4 — Smart discovery (Q3 2026)
Goal: discovery understands ticket intent, not just page structure.

- [ ] `TicketContextService`: extract action verbs + field names from Jira summary+description
- [ ] Targeted modal trigger: if ticket says "add", click Add New → capture modal fields → close → cache separately
- [ ] `SkillStore` persistence: confirmed passing selectors per module per action; first-choice on future tickets
- [ ] Discovery diff: compare new inventory against cached version, alert if critical buttons disappeared

---

### Phase 5 — AI SDK migration (deadline June 2026)
Hard deadline: `@google-cloud/vertexai` SDK deprecated June 24, 2026.

- [ ] Migrate to `@google/genai` SDK
- [ ] `UnifiedAIOrchestrator` adapter swap — no other files should change
- [ ] Validate token counting + streaming still works under new SDK
- [ ] Update `agent_profiles.json` model names if changed
- [ ] Run all 34 existing tests green after migration

---

### Phase 6 — MCP Self-Healing at scale (Q3 2026)
Extends Phase 3.6 with production-grade healing and regression library.

- [ ] `McpHealingService` battle-tested: heal success rate target >85% on selector failures
- [ ] `TestScriptStore` DB-backed (currently file-based): PostgreSQL table `test_scripts(ticket_id, scenario_id, steps jsonb, run_count, last_passed_at)`
- [ ] `SprintRegressionRunner` activated: batch overnight run for all 85 modules
- [ ] Per-module health score: pass rate, selector age, discovery freshness — stored in DB
- [ ] Diff report: compare week-over-week results, surface regressions before sprint review

---

### Phase 7 — Ubuntu Production (5 users) (Q3-Q4 2026)
Goal: stable, zero-downtime deployment for a team of 5 QA engineers on Ubuntu 22.04 LTS.

#### 7.1 — Server requirements

```
Minimum spec (5 concurrent users):
  CPU:  4 vCPU (Playwright is CPU-heavy during execution)
  RAM:  16 GB (500 MB per Playwright browser × 5 = 2.5 GB + Node + PG + OS headroom)
  Disk: 50 GB SSD (artifacts, videos, screenshots accumulate fast)
  OS:   Ubuntu 22.04 LTS
```

#### 7.2 — Process architecture

```
                    ┌─────────────────────────┐
Internet / LAN ───► │   Nginx (port 80/443)   │
                    │   SSL termination        │
                    │   WebSocket upgrade      │
                    └────────┬────────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
        /api  ▼        /     ▼        /ws   ▼
   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
   │ PM2 Cluster  │  │ Nginx static │  │ PM2 Cluster  │
   │ Backend x2   │  │ (Vite build) │  │ (same procs) │
   │ port 4001    │  │              │  │ WS passthru  │
   └──────┬───────┘  └──────────────┘  └──────────────┘
          │
   ┌──────┴───────────────────────────┐
   │          Resource Pool           │
   │  SharedBrowserPool (max 5)       │  ← one Playwright browser per user
   │  PlaywrightMCPPool (max 5)       │  ← one MCP process per user
   │  WorkerQueue (discovery: 3 max)  │  ← prevent browser storm
   └──────┬───────────────────────────┘
          │
   ┌──────┴───────┐
   │ PostgreSQL   │  ← sessions, test_scripts, users, jira_configs
   └──────────────┘
```

#### 7.3 — Concurrency limits for 5 users

| Resource | Limit | Reason |
|---|---|---|
| `SharedBrowserPool.maxConcurrent` | 5 | One Playwright browser per user |
| `PlaywrightMCPPool.maxSize` | 5 | One MCP process per user |
| `WorkerQueue` discovery slots | 3 | Discovery is heaviest (login + full page scan) |
| `WorkerQueue` execution slots | 5 | Execution lighter with MCP replay |
| PM2 backend workers | 2 | CPU-bound AI calls; more workers = more RAM |
| PG pool `max` | 20 | 2 workers × 10 connections each |

#### 7.4 — Setup tasks

- [ ] `scripts/setup-ubuntu.sh` — Node 20 LTS, PM2, Nginx, Playwright system deps (`npx playwright install-deps`), PostgreSQL 15
- [ ] `ecosystem.config.js` — PM2 cluster config: 2 workers, auto-restart on crash, log rotation
- [ ] Nginx config: `/api` + `/ws` → 4001 (with `proxy_read_timeout 600s` for execution), `/` → 4200 static
- [ ] SSL: Let's Encrypt (`certbot`) or internal CA cert
- [ ] `LOCAL_STORAGE_PATH=/opt/gohybridai/storage` — shared volume, not `__dirname`
- [ ] PostgreSQL: create `gohybridai` DB + user, run migrations, enable `pg_stat_statements`
- [ ] Firewall: UFW rules — 22 (SSH), 80, 443 open; 4001/4200 internal only
- [ ] Log rotation: `pm2-logrotate` module, keep 30 days
- [ ] `scripts/deploy.sh` — `git pull → npm ci → npm run build:frontend → pm2 reload`

#### 7.5 — User management

- [ ] Admin-only user creation endpoint (`POST /api/admin/users`) — no self-registration for internal tool
- [ ] Per-user Jira config (already exists in `JiraConfigService`)
- [ ] Per-user session history viewable in UI (own tickets only)
- [ ] Role: `admin` (create users, view all sessions) vs `tester` (own sessions only)

#### 7.6 — Health check + monitoring

- [ ] `GET /api/health` → returns `{ db: ok, aiPool: ok, browserPool: { active, max }, mcpPool: { active, max }, uptime }`
- [ ] PM2 monitoring: `pm2 monit` + `pm2 plus` optional
- [ ] Weekly artifact cleanup cron: delete screenshots/videos older than 30 days
- [ ] Disk usage alert: warn if `/opt/gohybridai/storage` > 40 GB

---

### Phase 8 — Sprint regression + batch (Q4 2026)
Goal: overnight batch run across all tickets in current sprint; surface regressions before standup.

- [ ] `SprintRegressionRunner` integration with Jira sprint board: fetch all tickets in active sprint
- [ ] Queue-based batch: run discover → generate → execute for all sprint tickets overnight (3 AM)
- [ ] `SmartExecutionRouter` reuses saved `TestScriptStore` scripts — AI only called on new tickets or UI drift
- [ ] Diff report: compare results sprint-over-sprint — new failures = potential regression
- [ ] Notification: email/Slack summary when batch completes (pass/fail counts, new failures highlighted)
- [ ] Dashboard page: per-ticket status, last run time, selector health score, discovery freshness

---

### Phase 9 — Multi-user dashboard + telemetry (2027)

- [ ] Admin dashboard: all users' active sessions, running browser count, AI token usage per user/month
- [ ] AI cost tracking: tokens per ticket, cost estimate (Vertex AI pricing), monthly report
- [ ] Selector health score per module: % of saved steps that still pass without healing
- [ ] `SkillStore` cross-user sharing: healed selectors from one user's ticket help another user's same-module ticket
- [ ] Playwright trace viewer integration: click failed step → see Playwright trace inline in UI

---

## Key File Map

```
backend/
  api/
    app.ts                            — Express app, route mounts, middleware
    routes/settingsRoutes.ts          — Settings CRUD
    agent_profiles.json               — AI model profiles (maxTokens, temperature)
  src/
    routes/
      authRouter.ts                   — POST /api/auth/login|logout|me
      testingRouter.ts                — POST /api/testing/start|scenarios|test-cases|approve|execute
    services/
      shared/AuthService.ts           — JWT + bcrypt, setPool()
      JiraConfigService.ts            — Jira credentials storage + env fallback
      jira/JiraClientFactory.ts       — Axios client builder with Basic auth
      discovery/
        DiscoveryCacheService.ts      — Cache read/write, MODULE_ALIASES, getPromptContext
        TestingDiscoveryService.ts    — runLiveBackground / runLive / _runLiveInternal
        PageElementDiscoveryService.ts — DOM probes: buttons/inputs/grids/modals/menus
        BrowserSessionManager.ts     — Playwright storageState persist (8h TTL)
      generation/
        TestingGenerationService.ts   — Vertex AI scenario + test-case generation
        JsonTestGenerationService.ts  — AgentOrchestrator multi-phase generation, mcpSteps output
        JSONToPlaywrightCompiler.ts   — RETIRING in Phase 3.6 → replaced by McpTestExecutor
      mcp/
        PlaywrightMcpClient.ts        — JSON-RPC client to @playwright/mcp child process
        McpTestExecutor.ts            — Executes McpStep[] list via PlaywrightMcpClient
        McpHealingService.ts          — (Phase 3.6 NEW) snapshot + Gemini heal on step fail
        SmartExecutionRouter.ts       — saved script reuse vs regenerate decision
        TestScriptStore.ts            — save/load passing McpStep[] per ticket+scenario
        SprintRegressionRunner.ts     — batch overnight runner (Phase 8)
        McpDiscoveryService.ts        — live accessibility snapshot for prompt context
        PlaywrightMCPPool.ts          — pool of MCP processes (cap for multi-user)
      execution/
        TestingExecutionOrchestrator.ts — session lock, phase updates, result merging
        TestExecutionService.ts         — (legacy compiled script runner — retiring Phase 3.6)
      session/
        TestSessionService.ts         — PostgreSQL-backed session store
      skills/
        SkillRegistryService.ts       — selector hint registry
        SkillStore.ts                 — confirmed passing selectors per module
      shared/
        AiControllerService.ts        — routes AI calls via MultiAgentRouter
      AgentOrchestrator.ts            — Planning + Coding two-phase AI flow
      UnifiedAIOrchestrator.ts        — Vertex AI Gemini 2.5 Flash wrapper
  scripts/
    discover-page.ts                  — MODULE_ROUTES (85 entries), discoverSinglePage
    setup-ubuntu.sh                   — (Phase 7 NEW) Ubuntu server setup
    deploy.sh                         — (Phase 7 NEW) build + PM2 reload

frontend/
  src/
    components/
      GoHybridChat.tsx                — Main chat UI, wizard cards
      GoHybridChat.part1.tsx          — DiscoveryCard, ScenarioCard, TestCaseCard
    hooks/
      useApi.ts                       — API client, approveAndExecute flow
    contexts/
      AuthContext.tsx                 — JWT auth state
```

---

## Environment Variables (required)

```
# Auth
JWT_SECRET=

# Database
DATABASE_URL=

# Vertex AI
GOOGLE_APPLICATION_CREDENTIALS=
VERTEX_PROJECT_ID=
VERTEX_LOCATION=

# Jira (fallback when user has no saved config)
JIRA_DOMAIN=
JIRA_EMAIL=
JIRA_API_TOKEN=

# Test site credentials (Playwright login)
TEST_USERNAME=
TEST_IDNUMBER=
BASE_URL=

# Storage
LOCAL_STORAGE_PATH=   (defaults to backend/local_storage — MUST set in production)

# Production only
NODE_ENV=production
PORT=4001
```

---

## Ubuntu Deployment Checklist (Phase 7)

```
Server setup:
  [ ] Ubuntu 22.04 LTS installed
  [ ] Node 20 LTS via nvm
  [ ] PM2 installed globally
  [ ] Nginx installed + configured
  [ ] PostgreSQL 15 installed + DB created
  [ ] Playwright system deps: npx playwright install-deps chromium
  [ ] UFW firewall: 22, 80, 443 open
  [ ] SSL cert installed

App setup:
  [ ] Repo cloned to /opt/gohybridai
  [ ] backend/.env configured (all vars above)
  [ ] npm ci in backend/
  [ ] npm ci + npm run build in frontend/
  [ ] DB migrations run
  [ ] ecosystem.config.js configured (2 workers)
  [ ] pm2 start ecosystem.config.js
  [ ] pm2 save + pm2 startup

Verify:
  [ ] GET /api/health returns 200
  [ ] Login works for all 5 users
  [ ] WebSocket connects (ws://server/ws)
  [ ] Discovery runs without browser crash
  [ ] PM2 auto-restarts on crash (kill -9 test)
  [ ] Nginx serves frontend static correctly
```
