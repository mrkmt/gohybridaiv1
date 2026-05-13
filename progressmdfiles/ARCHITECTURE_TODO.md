# GoHybridAI — Long-Term Architecture TODO
> Target: 3-5 concurrent users | Ubuntu 16 GB RAM VM | Vertex AI (Gemini 2.5 Flash) + @playwright/mcp
> Last updated: 2026-04-25

---

## ✅ DONE

### AI JSON Generation (Stable — Runs 14-23)
- [x] `structured=true` → `responseMimeType: 'application/json'` — syntactically valid JSON guaranteed
- [x] `patchEnvelope()` — injects missing `ticketId/feature/module`, unwraps AI wrapper keys
- [x] `repairMissingCommas()` — state-machine comma repair
- [x] `stripJsonComments()` — JSONC cleaner
- [x] `recoverTruncatedJson()` — handles `testScenarios/testCases/cases/tests/test_cases` key variants (Run 17)
- [x] `cleanJsonResponse()` fast-path — `JSON.parse()` first, skips repair if valid (Run 19)
- [x] `sanitiseSpec` — handles `step.action` and `step.type` dual-field
- [x] `ASSERT_PSEUDO_TYPES` — assert-like actions promoted, not dropped
- [x] `AiControllerService.generate()` — `structured` boolean param added
- [x] `AgentOrchestrator.generateJsonSpec()` — concrete JSON example, Rules 9+10 (Run 18+22)
- [x] `TestScriptStore.save()` — `last_pass_at` fixed from `'NOW()'` string to `new Date()`
- [x] `SmartExecutionRouter.route()` — null-script guard for McpStep-only rows
- [x] `TestSpecSchema.normaliseStepType()` — `waitforselector`, `waitforresponse`, `selectoption`, `uploadfile` (Run 20)
- [x] `TestSpecSchema.ASSERTION_TYPE_MAP` — all negative visibility aliases added
- [x] `TemplateResolver.buildDefaultContext()` — `{{timestamp}}` (YYYYMMDD_HHmmss), `{{unique_id}}`, `{{random}}`
- [x] `JSONToPlaywrightCompiler` — template check uses `getUnresolvedVariables(resolvedValue)` (Run 22)

### MCP Infrastructure
- [x] `PlaywrightMcpClient.ts` — JSON-RPC 2.0 client, `browser_*` tool names
- [x] `PlaywrightMCPPool.ts` — singleton persistent browser with auth state file
- [x] `McpDiscoveryService.ts` — live snapshot with primary→fallback login
- [x] `TestScriptStore.ts` — DB-backed, McpStep[] JSONB + selectorHash
- [x] `SmartExecutionRouter.ts` — routing with UI-drift detection
- [x] `McpTestExecutor.ts` — all 15 `browser_*` actions + legacy upgrade
- [x] `mcp.types.ts` — Zod discriminated union for McpStep
- [x] DB migration v27 — `steps JSONB + scenario_name + pass_count + last_pass_at`

### ATT-15 Pipeline
- [x] Full E2E pipeline: Jira → Discovery → Scenarios → JSON → Script → McpStep[]
- [x] Run 23: ✅ STABLE — 3/3 scenarios, 5+5+7 steps, no warnings, `{{timestamp}}` resolved

### Phase 3.5 — Jira Context Intelligence ✅ 2026-04-25
- [x] `src/types/jira-context.types.ts` — `JiraTicketContext`, `TicketClassification`, `Platform`, `CompletionStatus`, `TestingScope`, `TicketSubtype`
- [x] `JiraContextBuilder.ts` — fetches ticket + linked tickets (1 level, parallel), attachment metadata, 30-min DB cache in `jira_context_cache`
- [x] `TicketClassifier.ts` — pure classifier: platform/completionStatus/testingScope/ticketSubtype + `scopeInstructions` string
- [x] `AttachmentAnalyzer.ts` — images → Gemini Vision (base64 multimodal), PDFs → text extraction, videos → metadata note
- [x] `AgentOrchestrator` — `buildScopeBlock()` injects `## SCOPE & TYPE INSTRUCTIONS` into both planning + coding prompts
- [x] `JsonGenerationOptions.ticketClassification` field added — backward compatible
- [x] DB migration v28 — `jira_context_cache` (TTL 30 min) + `module_skills` tables

### Phase 3.6 — SkillStore ✅ 2026-04-25
- [x] `SkillStore.ts` — CRUD for `module_skills`: `get()`, `getContext()` (<500 token output), `upsert()`, `recordSuccess()`, `list()`, `getStats()`, `delete()`

### Infrastructure Fixes ✅ 2026-04-25
- [x] `api/app.ts` — reconstructed from binary corruption: Express factory, CORS, multer, all routers mounted, error handler
- [x] `api/routes/settingsRoutes.ts` — reconstructed: `GET/PUT /api/settings/profiles`, health check
- [x] Swagger UI wired at `/api-docs` (swagger-jsdoc + swagger-ui-express already installed)
- [x] `createSettingsRouter()` mounted at `/api/settings`

---

## 🔲 TODO

### Phase 3 — Smart Routing Wire-up (Priority: HIGH) ~2 days
Connect `SmartExecutionRouter` into the main pipeline so second runs skip AI entirely.

- [ ] **3.1** `TestingExecutionOrchestrator`: get live UI hash before test run
  ```typescript
  const uiHash = await McpDiscoveryService.getSnapshotHash(module, baseUrl, credentials);
  ```
- [ ] **3.2** Wire `SmartExecutionRouter.route()` into execution loop
  - `runScript` → `McpTestExecutor.run(steps)` (MCP replay)
  - `generateScript` → `JsonTestGenerationService.generateAndCompile()`
  - PASS → `TestScriptStore.save(steps, uiHash)` + `SkillStore.recordSuccess()`
- [ ] **3.3** Frontend: Script Library panel
  - Table: ticketId | scenarioId | module | passRate | runCount | lastRun | [Delete]
  - API: `GET /api/scripts` (paginated) + `DELETE /api/scripts/:ticketId/:scenarioId`

### Phase 3.5 — Wire Context Intelligence into Live Pipeline (Priority: HIGH) ~1 day
The services exist — they need to be called from the main test generation entry point.

- [ ] **3.5.5** In `MultiAgentRouter` or `TestingExecutionOrchestrator`:
  ```typescript
  const ctx = await JiraContextBuilder.build(ticketId, pool);
  const cls = TicketClassifier.classify(ctx);
  const enriched = await AttachmentAnalyzer.analyze(ctx.attachments, jiraAuthHeader);
  options.ticketClassification = cls;
  options.attachmentSummaries = enriched.filter(a => a.aiSummary).map(a => a.aiSummary!);
  ```
- [ ] **3.5.6** Wire `SkillStore.getContext(module, pool)` → `options.skillContext`
  - Replace verbose DiscoveryCacheService dump with compact SkillStore output
  - Target: 500 tokens vs current 3 000 tokens (6x saving per run)

### Phase 3.7 — Swagger API Documentation (Priority: MEDIUM) ~2 days
`swagger-jsdoc` + `swagger-ui-express` installed and mounted at `/api-docs` — needs JSDoc annotations.

- [ ] **3.7.1** Add `@swagger` JSDoc annotations to `coreRoutes.ts`
  - `/api/dashboard`, `/api/pipeline/process`, `/api/execute`, `/api/investigate`
  - `/api/settings/discovery`, `/api/scripts` (new)
- [ ] **3.7.2** Add `@swagger` JSDoc annotations to `jiraRoutes.ts`
  - `/api/jira/ticket/:id`, `/api/jira/generate`, `/api/jira/sync`, `/api/jira/config`
- [ ] **3.7.3** Add `@swagger` JSDoc annotations to `mcpRoutes.ts` + `hybridAutomationRoutes.ts`
- [ ] **3.7.4** Add shared schema definitions (components/schemas) for:
  - `JiraTicket`, `TestSpecification`, `McpStep[]`, `JsonTestGenerationResult`, `TicketClassification`
- [ ] **3.7.5** Frontend: link to `/api-docs` from the settings panel or sidebar

### Phase 4 — Sprint Regression (Priority: LOW) ~3 days
- [ ] **4.1** Finish `SprintRegressionRunner.ts` — `fetchSprintTickets()` + `runSprint()` with concurrency limit
- [ ] **4.2** Frontend: Sprint Regression panel (sprint dropdown + progress bar + result table)
- [ ] **4.3** Jira API: post sprint result as comment on sprint epic

### Phase 5 — Production Hardening for Ubuntu VM (Priority: HIGH before go-live) ~3 days
Targeting 3-5 concurrent users on Ubuntu 16 GB RAM.

- [ ] **5.1** PM2 cluster mode — `ecosystem.config.js` with `instances: 2`, `exec_mode: 'cluster'`
  - 2 Node workers × ~600 MB = ~1.2 GB Node; leave 12 GB for Chromium instances
  - Chromium per user: ~400 MB → max 5 users = 2 GB Chromium headless
- [ ] **5.2** PostgreSQL connection pool tuning
  - `max: 20` (current), `idleTimeoutMillis: 30000` — review under 5 concurrent users
  - Add `pg_stat_activity` monitoring endpoint
- [ ] **5.3** Playwright browser per-request isolation
  - Each test run spawns its own `npx @playwright/mcp` process
  - Add hard cap: max 3 concurrent Playwright processes (`Semaphore` in `SmartExecutionRouter`)
  - Processes exit after test completes — no zombie processes
- [ ] **5.4** Memory guard — `process.memoryUsage()` check before spawning Playwright
  - If `heapUsed > 1.5 GB` → queue the request instead of spawning immediately
- [ ] **5.5** Request queue for AI calls — max 3 concurrent Vertex AI calls (API rate limit protection)
- [ ] **5.6** Nginx reverse proxy config for Ubuntu
  - SSL termination, gzip, `proxy_read_timeout 120s` for long AI calls
  - Frontend static files served by Nginx, not Node
- [ ] **5.7** Systemd service file for auto-restart on VM reboot
- [ ] **5.8** Log rotation: `winston-daily-rotate-file` or `pm2 log-rotate`

### Phase 6 — SDK Migration (Priority: MEDIUM — deadline June 2026)
`@google-cloud/vertexai` deprecated June 24 2025, removed June 24 2026.

- [ ] **6.1** Migrate `MultiAgentRouter.callVertex()` from `@google-cloud/vertexai` to `@google/genai`
  - New SDK: `import { GoogleGenAI } from '@google/genai'`
  - `generateContent()` → `models.generateContent()` new signature
  - Multimodal: `inlineData` format unchanged
- [ ] **6.2** Remove `@google-cloud/vertexai` from `package.json`
- [ ] **6.3** Test: Run ATT-15 pipeline with new SDK, verify structured=true still works

---

## Concurrency Model — 3-5 Users on 16 GB Ubuntu VM

```
Ubuntu 16 GB RAM
├── Nginx (SSL + static)          ~50 MB
├── Node.js backend (PM2 x2)      ~1.2 GB  (2 workers × 600 MB)
├── PostgreSQL                    ~512 MB
├── Chromium headless (max 3)     ~1.2 GB  (3 concurrent tests × 400 MB)
├── Vertex AI calls (async)       0 MB local (cloud)
└── OS + buffer                   ~2 GB
Total peak:                       ~5 GB  ← comfortably fits 16 GB
```

**Concurrency limits:**
- AI calls: max 3 concurrent (Vertex AI quota + latency)
- Playwright processes: max 3 concurrent (memory bound)
- DB connections: max 20 (pool)
- WebSocket connections: unlimited (lightweight)

**Second-run performance (cached scripts):**
- Saved McpStep[] → replay in 5-15s, $0 AI cost, 0 Chromium spawn
- Only first run per ticket needs 30-60s AI + browser

---

## Architecture Decisions (Locked)

| Decision | Choice | Reason |
|---|---|---|
| AI reasoning | Vertex AI Gemini 2.5 Flash | Stable, `structured=true` works |
| JSON output | `responseMimeType: 'application/json'` | Eliminates comma/truncation bugs |
| Browser automation | `@playwright/mcp` (`browser_*`) | Official Microsoft package |
| AI orchestration | Vertex AI SDK (not Gemini CLI) | Already wired, no redundancy |
| Script caching | `TestScriptStore` → `test_scripts` JSONB | $0 replay on second run |
| Concurrency | Per-request Playwright process + semaphore | Isolates failures, no shared state |
| Auth state | `auth_state.json` | Login once per server start |
| Deployment | PM2 + Nginx on Ubuntu | Simple, proven for 5-user teams |
| API docs | swagger-jsdoc + swagger-ui-express at `/api-docs` | Already installed, needs annotations |

---

## File Map

```
backend/
├── api/
│   ├── app.ts                           ✅ reconstructed 2026-04-25
│   ├── swagger.ts                       ✅ spec defined; wired at /api-docs
│   ├── MultiAgentRouter.ts              ✅ structured=true + vision multimodal
│   └── routes/
│       ├── coreRoutes.ts                ✅ (needs @swagger JSDoc — TODO 3.7.1)
│       ├── jiraRoutes.ts                ✅ (needs @swagger JSDoc — TODO 3.7.2)
│       ├── mcpRoutes.ts                 ✅ (needs @swagger JSDoc — TODO 3.7.3)
│       ├── hybridAutomationRoutes.ts    ✅
│       ├── crawlerRoutes.ts             ✅
│       └── settingsRoutes.ts            ✅ reconstructed 2026-04-25
├── src/
│   ├── services/
│   │   ├── generation/
│   │   │   ├── JsonTestGenerationService.ts  ✅ ticketClassification field added
│   │   │   ├── TestSpecSchema.ts             ✅ all step types + assertion aliases
│   │   │   └── AgentOrchestrator.ts          ✅ buildScopeBlock() injected
│   │   ├── jira/
│   │   │   ├── JiraContextBuilder.ts         ✅ created 2026-04-25
│   │   │   ├── TicketClassifier.ts           ✅ created 2026-04-25
│   │   │   ├── AttachmentAnalyzer.ts         ✅ created 2026-04-25
│   │   │   └── JiraTicketOrchestrator.ts     ✅ existing (linked ticket fetch)
│   │   ├── mcp/
│   │   │   ├── PlaywrightMCPPool.ts          ✅ singleton + auth state
│   │   │   ├── McpDiscoveryService.ts        ✅ live snapshot + fallback
│   │   │   ├── TestScriptStore.ts            ✅ McpStep[] + selectorHash
│   │   │   ├── SmartExecutionRouter.ts       ⚠️  needs wire-up (TODO 3.2)
│   │   │   ├── McpTestExecutor.ts            ✅ all browser_* actions
│   │   │   └── SprintRegressionRunner.ts     🔲 TODO 4.1
│   │   ├── skills/
│   │   │   └── SkillStore.ts                 ✅ created 2026-04-25
│   │   └── shared/
│   │       └── MigrationManager.ts           ✅ v28: jira_context_cache + module_skills
│   └── types/
│       ├── mcp.types.ts                      ✅ McpStep Zod union
│       └── jira-context.types.ts             ✅ created 2026-04-25
└── scripts/
    └── test-att15-e2e.ts                     ✅ Run 23 STABLE
```

---

## Next 3 Sessions — Priority Order

| Session | Task | Est. |
|---------|------|------|
| Next | Wire 3.5.5: call JiraContextBuilder+TicketClassifier from pipeline entry point | 2h |
| Next | Wire 3.5.6: SkillStore.getContext() → options.skillContext | 1h |
| Next | Phase 3.1+3.2: SmartExecutionRouter into TestingExecutionOrchestrator | 3h |
| After | Phase 3.3: Script Library frontend panel + GET/DELETE API | 3h |
| After | Phase 3.7.1-3.7.2: Swagger annotations on core + jira routes | 2h |
| Later | Phase 5: PM2 + Nginx + memory guard for Ubuntu deploy | 4h |
| Later | Phase 6: Migrate to @google/genai (deadline June 2026) | 2h |
