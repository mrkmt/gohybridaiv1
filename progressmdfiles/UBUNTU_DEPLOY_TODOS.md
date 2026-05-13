# GoHybridAI — Ubuntu Deploy & Stability Plan
# Generated: 2026-04-28

---

## PHASE 0 — CRITICAL: Sync V1 from full (do before any deploy)

V1 has 5 stub/empty service files that need real implementations from `full/backend`.
These are NOT optional — execution and discovery will silently fail without them.

### 0-A: Copy empty stubs from full → V1

| File | Status in V1 | Source in full | Impact if skipped |
|------|-------------|----------------|-------------------|
| `src/services/execution/FailureClassificationService.ts` | Empty (1 line) | 22 KB real impl | All failures marked CODE_FAULT; no self-heal routing |
| `src/services/discovery/DiscoveryEnricher.ts` | Empty (1 line) | 6.8 KB real impl | No semantic tags; LLM guesses field roles |
| `src/services/generation/TestSpecTargetResolver.ts` | Empty (1 line) | 12 KB real impl | Natural-language targets pass Zod but fail at runtime |
| `src/services/discovery/ModuleRouteRegistry.ts` | Empty (1 line) | Real impl | Discovery cannot route to modules |
| `src/services/discovery/ai/AiModuleResolverService.ts` | Empty (1 line) | Real impl | AI fallback for unrecognised module names broken |

**Action:** For each file above, copy the full implementation:
```
cp full/backend/src/services/execution/FailureClassificationService.ts V1/backend/src/services/execution/
cp full/backend/src/services/discovery/DiscoveryEnricher.ts             V1/backend/src/services/discovery/
cp full/backend/src/services/generation/TestSpecTargetResolver.ts       V1/backend/src/services/generation/
cp full/backend/src/services/discovery/ModuleRouteRegistry.ts           V1/backend/src/services/discovery/
cp full/backend/src/services/discovery/ai/AiModuleResolverService.ts    V1/backend/src/services/discovery/ai/
```

### 0-B: Sync TestingWorkflowController.ts (full is 89 lines newer)

Full adds:
- `type ← issueType` field normalisation
- `artifactsPath` → session wiring
- Step-level detail in execution response (`steps[]` array)
- `caseId` + `caseName` + `selectorHealed` in result rows
- Both `executionLock: false` reset paths (lines 131 + 540 in full)

**Action:** Replace `V1/backend/src/controllers/TestingWorkflowController.ts`
with `full/backend/src/controllers/TestingWorkflowController.ts`.
Diff first: `diff full/.../TestingWorkflowController.ts V1/.../TestingWorkflowController.ts`

### 0-C: Sync AgentOrchestrator.ts (V1 is older 355-line version)

Full version (228 lines) removes file I/O deps (`fs`/`path`) and moves token tracking to
async helpers. It is cleaner and the version that all AGENTS.md fixes reference.

**Action:** Replace `V1/backend/src/services/AgentOrchestrator.ts`
with `full/backend/src/services/AgentOrchestrator.ts`.

### 0-D: Frontend — GoHybridChat duplicate results fix (already done in V1 this session)

- [x] `useExecutionWebSocket.ts` — wsLocal guard + CONNECTING check (done 2026-04-28)
- [x] `GoHybridChat.tsx` — memoized `executingTicketIds`, `completedExecutionsRef` (done 2026-04-28)

Verify the same fix is applied to `full/frontend` too:
- [ ] Check `full/frontend/src/hooks/useExecutionWebSocket.ts` for same guards
- [ ] Check `full/frontend/src/components/GoHybridChat.tsx` for `useMemo` + completion ref

---

## PHASE 1 — Ubuntu Server Setup

### 1-A: System prerequisites (run once on fresh Ubuntu 22.04 LTS)
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential nginx certbot python3-certbot-nginx ufw
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version  # must be 20.x
# PM2
sudo npm install -g pm2 ts-node typescript
# Playwright system deps
npx playwright install-deps chromium
# Verify chromium launches headless
chromium-browser --headless --no-sandbox --dump-dom about:blank | head -5
```

### 1-B: Directory layout
```
/opt/gohybridai/
├── backend/     ← git clone or rsync
├── frontend/    ← built dist/ served by nginx
├── .env         ← secrets (never commit)
└── logs/        ← PM2 logs
```

### 1-C: Backend .env required keys
```
NODE_ENV=production
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_NAME=gohybridai
DB_USER=...
DB_PASSWORD=...
JWT_SECRET=...               # 64-char random
JIRA_BASE_URL=...
JIRA_USER=...
JIRA_API_TOKEN=...
VITE_TEST_BASE_URL=...       # target app URL
VITE_TEST_USERNAME=...
VITE_TEST_PASSWORD=...
GOOGLE_APPLICATION_CREDENTIALS=/opt/gohybridai/backend/credentials.json
GEMINI_API_KEY=...
AI_PROVIDER=gemini           # or vertex
LINUX_BROWSER_ARGS=--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage
MCP_PLAYWRIGHT_PATH=/opt/gohybridai/backend/node_modules/.bin/playwright-mcp
```

### 1-D: ecosystem.config.js (PM2)
```js
module.exports = {
  apps: [{
    name: 'gohybridai-backend',
    script: 'ts-node',
    args: '--transpile-only src/app.ts',
    cwd: '/opt/gohybridai/backend',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '1200M',
    env_production: {
      NODE_ENV: 'production',
    },
    error_file: '/opt/gohybridai/logs/backend-err.log',
    out_file: '/opt/gohybridai/logs/backend-out.log',
    merge_logs: true,
    restart_delay: 5000,
    max_restarts: 10,
  }],
};
```

### 1-E: nginx/gohybridai.conf
```nginx
server {
    listen 80;
    server_name your-domain.com;

    # API proxy
    location /api/ {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
    }

    # WebSocket upgrade
    location /ws {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_read_timeout 86400s;
    }

    # Frontend SPA
    location / {
        root   /opt/gohybridai/frontend/dist;
        index  index.html;
        try_files $uri $uri/ /index.html;
    }
}
```

### 1-F: Frontend production build
```bash
cd /opt/gohybridai/frontend
# Must use relative API URL so nginx proxies correctly
VITE_API_URL="" VITE_WS_URL="" npm run build
# dist/ is now ready for nginx
```

### 1-G: UFW firewall
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo ufw status
```

### 1-H: PM2 startup
```bash
cd /opt/gohybridai/backend
npm install
npx ts-node scripts/run-migrations.ts   # apply all DB migrations
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup systemd  # follow the printed command to persist on reboot
```

---

## PHASE 2 — Stable Live Discovery

### 2-A: Missing: `GET /api/health` endpoint
Full backend needs this for smoke testing and PM2 restarts.
```typescript
// backend/src/routes/healthRouter.ts — add to existing file
router.get('/', (req, res) => {
  const pool = SharedBrowserPool.getInstance();
  const poolStats = pool.getStats();        // { active, idle, max }
  res.json({
    ok: true,
    uptime: Math.floor(process.uptime()),
    browserPool: poolStats,
    timestamp: new Date().toISOString(),
  });
});
```
Wire in `testingRouter.ts`: `router.use('/health', healthRouter)`.

### 2-B: Discovery stability hardening

- [ ] **`LINUX_BROWSER_ARGS` applied to ALL chromium launches**
  Check these 3 files each have `process.env.LINUX_BROWSER_ARGS?.split(',')` in their launch args:
  - `backend/src/services/discovery/TestingDiscoveryService.ts`
  - `backend/src/services/mcp/PlaywrightMcpClient.ts`
  - `backend/src/services/execution/TestingExecutionOrchestrator.ts`
  Pattern: `...(process.env.LINUX_BROWSER_ARGS?.split(',').filter(Boolean) ?? [])`

- [ ] **Discovery timeout guard** — set `PLAYWRIGHT_TIMEOUT=60000` in .env
  Current: some pages wait forever for Kendo grids → hanging discovery → locked session

- [ ] **Cache TTL check** — `DiscoveryCacheService`: confirm `MAX_AGE_MS = 24 * 60 * 60 * 1000`
  If stale cache exists for a module, force-bust it before first real run:
  `DELETE FROM discovery_cache WHERE module_name = 'appraisal_status';`

- [ ] **Poisoned cache prevention** — `detectDashboardFallback()` must be wired in V1's
  `TestingDiscoveryService._runLiveInternal()`. Check that the fallback guard fires before
  saving to cache when the crawl lands on `/dashboard` instead of the target module.

- [ ] **Discovery rate limiting** — max 1 concurrent live crawl per user
  Add: `if (this.crawlInProgress.has(userId)) throw new Error('Discovery already running');`
  in `TestingDiscoveryService.runLive()`.

### 2-C: ModuleRouteRegistry — verify all ATT-xx routes

After copying the real `ModuleRouteRegistry.ts` from full, manually verify these routes open
in the test app and update the file if any hash is wrong:
```
ATT-08:  #/app.leaveBalanceReport        ← UNVERIFIED (SPRINT_TODOS P1)
ATT-15:  check what module this maps to  ← run real fetch first
ATT-21:  Performance Appraisal → #/app.performanceAppraisal or similar
ATT-22:  designation/leave policy → check app URL hash
ATT-33:  leave policy → #/app.leavePolicy (already has skill selectors)
```
**How to verify:** Open test app in Chrome → navigate to module → copy URL hash → update registry.

---

## PHASE 3 — Stable Execution

### 3-A: MCP JSON-RPC `initialize` lifecycle fix (SPRINT_TODOS P1-CRITICAL)
Current `PlaywrightMcpClient` sends `initialize` as a regular tool call which MCP rejects.

Correct handshake sequence:
```
1. spawn mcp process
2. send: { jsonrpc:"2.0", method:"initialize", params:{...}, id:1 }
3. receive: { result: { capabilities:... } }
4. send: { jsonrpc:"2.0", method:"notifications/initialized" }  ← notification, no id
5. send: { jsonrpc:"2.0", method:"tools/list", id:2 }
6. receive: tool list → confirm browser_navigate etc. are available
7. begin test steps
```
File: `V1/backend/src/services/mcp/PlaywrightMcpClient.ts` → `initializeServer()` method.

### 3-B: FailureClassificationService integration (requires 0-A)

After copying the real service, wire `classifyFailureWithState()` into the execution orchestrator:
- `TestingExecutionOrchestrator.ts` → in the catch block after a step fails, pass
  `step.stateKey` and `priorSteps.map(s => s.stateKey)` to `classifyFailureWithState()`
- This surfaces STATE_MISMATCH errors immediately instead of generic CODE_FAULT

### 3-C: ExecutionLock — confirm reset in V1

The full backend fixed both reset paths (lines 131 + 540 in controller). Verify V1 has both:
```bash
grep -n "executionLock\|is_running" V1/backend/src/controllers/TestingWorkflowController.ts
```
Both should set `executionLock: false` / `is_running: false`.

### 3-D: `stopOnFailure: false` — confirm in MCP executor

All test cases must run even if one fails. Verify:
```bash
grep -n "stopOnFailure" V1/backend/src/services/mcp/McpTestExecutor.ts
```
Must be `false` or absent.

### 3-E: Self-heal telemetry endpoint

After 0-A copies real `FailureClassificationService`, the telemetry endpoint should auto-work:
```
GET /api/health/failure-telemetry
→ { categoryCounts: { SELECTOR_ERROR: N, TIMING_FAULT: M, ... }, heal: { attempts, successRate } }
```
Use this to tune self-heal thresholds after first 10 real runs.

---

## PHASE 4 — Knowledge & Skills Pipeline

### 4-A: System Knowledge ingestion into SkillRegistry

The `System Knowledge/` directory has rich GlobalHR user guides and ISTQB PDFs but they
are disconnected from the generation pipeline. Wire them:

- [ ] Add `SkillRegistryService.bootstrapFromDocuments()` that reads:
  - `System Knowledge/GlobalHR Userguides/*.docx` → extract business rules for each module
  - `System Knowledge/Jira/Functional and UI Jira/Jira.csv` → real ticket patterns as examples
  Parse with existing `DocumentParserService.ts` (backend/src/skills/).
  Store in `module_skills` table under `source: 'userguide'`.

- [ ] Wire into `AgentOrchestrator.buildSkillSelectorBlock()`:
  When generating for module X, inject matching user guide rules into the Planner prompt.
  Example: for "Leave Policy" module, inject the Leave User Guide business rules.

### 4-B: CSV skill extraction — verify ATT-33 patterns are active

The `scripts/csv-parser.ts` extracted 15 forms / 7,469 scenarios.
Confirm they reach the generation prompts:
```bash
grep -r "csv-extracted" V1/backend/src/services/skills/SkillRegistry.ts
```
If missing, copy the SkillRegistry.ts fix from full that loads CSV-extracted skills at startup.

### 4-C: Skill file health check (B4 — fix binary/corrupted files)

Two skill files crash the skill scan if they're encrypted/binary:
```
backend/skills/GlobalHR/business-logic/login-rules.json
backend/skills/GlobalHR/business-logic/generic-crud-flow.json
```
Fix in `CustomSkillManager.ts`:
```typescript
try {
  const raw = fs.readFileSync(filePath, 'utf-8');
  JSON.parse(raw);   // validate before using
} catch {
  logger.warn(`[Skills] Skipping unreadable skill file: ${filePath}`);
  continue;
}
```

### 4-D: Persist healed selectors back to skill files

`persistHealedSelector()` exists in `SmartSkillManager` but has never completed a full
heal cycle (per AGENTS.md #K3 note). After first real healed execution on Ubuntu:
1. Check `module_skills` table: `SELECT * FROM module_skills WHERE healed = true LIMIT 5;`
2. Confirm the healed selector appears in next generation prompt for same module
3. If not wired: add `SkillStore.getHealedSelectors(moduleName)` call in `AgentOrchestrator`

### 4-E: Jira CSV → knowledge enrichment

`System Knowledge/Jira/Functional and UI Jira/Jira.csv` has functional ticket patterns.
- [ ] Run `scripts/csv-parser.ts` against it → extract test scenarios grouped by module
- [ ] Store in `skills/Auto-Generated/jira-patterns/` (same format as existing csv-extracted)
- [ ] SkillRegistry loads at startup → AI sees real historical test patterns

---

## PHASE 5 — Smoke Test Checklist (post-deploy)

Run in order. Stop and fix before continuing if any fail.

```
[ ] GET /api/health → { ok: true, uptime: N, browserPool: {...} }
[ ] POST /api/auth/login → JWT returned, no 500
[ ] WS connect with JWT → auth_ok received in DevTools Network
[ ] ATT-22 detect → ticket card renders, linked chips visible
[ ] ATT-22 discovery → runs without hanging (< 60s), elementCount > 0
[ ] ATT-22 generate scenarios → 3-8 scenarios, no "MODULE_NOT_FOUND"
[ ] ATT-22 generate test cases → Playwright scripts compile, no unresolved targets
[ ] ATT-22 execute → MCP browser launches (check PM2 logs), steps stream via WS
[ ] ATT-22 results → exactly ONE results_card in UI (duplicate fix verified)
[ ] GET /api/health/failure-telemetry → returns category counts after execution
[ ] Upload to Jira → Jira comment created, ZIP attached, no 400 ADF error
```

---

## PHASE 6 — Monitoring & Stability (after first successful deploy)

- [ ] **PM2 log rotation** — `pm2 install pm2-logrotate`; set `max_size: 50M`, `retain: 7`
- [ ] **Nginx access log** — confirm slow requests (> 30s) are visible for discovery tuning
- [ ] **DB connection pool** — set `max: 10` in pg Pool config; monitor under concurrent users
- [ ] **Browser pool health check** — `SharedBrowserPool.startHealthMonitoring()` is wired;
  confirm it's actually closing stale browsers after discovery runs
- [ ] **SSL cert** — `sudo certbot --nginx -d your-domain.com` after smoke test passes on HTTP

---

## KNOWN DEFERRED ITEMS (from SPRINT_TODOS + AGENTS.md)

These are logged but not in scope for first stable deploy:

| Item | Source | Notes |
|------|--------|-------|
| Vertex AI SDK migration → `@google/genai` | SPRINT_TODOS P3 | Hard deadline June 24, 2026 |
| Discovery sidebar nav — all 6 selectors timeout | SPRINT_TODOS P3 | Inspect live DOM with Chrome DevTools |
| `test_scripts` user isolation | SPRINT_TODOS P3 | Two users on same ticket overwrite |
| B5 — Remove dead Vertex AI code in MultiAgentRouter | AGENTS.md | `@google-cloud/vertexai` still referenced |
| B6 — Consolidate prompt builders | AGENTS.md | Drift between 3 prompt builders |
| U1 — Step timeline: case grouping + artifact links | AGENTS.md | UI enhancement |
| #4 — Auto-bug reporter dedup | AGENTS.md | Spam risk on flaky tests |
| Discovery Phase 2 — AI Inventory Enrichment | SPRINT_TODOS P3 | `AiInventoryEnricherService.ts` |
| Discovery Phase 3 — AI-Driven MCP Exploration | SPRINT_TODOS P4 | `AiExplorerService.ts` |
| Phase 7 — PM2 cluster 2 workers + SSL + UFW | SPRINT_TODOS P4 | Post-stable only |

---

## QUICK REFERENCE — Key File Locations

```
Discovery pipeline:
  V1/backend/src/services/discovery/TestingDiscoveryService.ts   ← main orchestrator
  V1/backend/src/services/discovery/ModuleRouteRegistry.ts       ← STUB (copy from full)
  V1/backend/src/services/discovery/DiscoveryEnricher.ts         ← STUB (copy from full)
  V1/backend/src/services/discovery/ai/AiModuleResolverService.ts ← STUB (copy from full)

Execution pipeline:
  V1/backend/src/services/execution/TestingExecutionOrchestrator.ts
  V1/backend/src/services/execution/FailureClassificationService.ts ← STUB (copy from full)
  V1/backend/src/services/mcp/PlaywrightMcpClient.ts               ← MCP handshake fix needed
  V1/backend/src/services/mcp/McpTestExecutor.ts

Generation pipeline:
  V1/backend/src/services/AgentOrchestrator.ts                  ← older version (update from full)
  V1/backend/src/services/generation/TestSpecTargetResolver.ts  ← STUB (copy from full)
  V1/backend/src/services/generation/JsonTestGenerationService.ts

Controller:
  V1/backend/src/controllers/TestingWorkflowController.ts       ← needs full version

Skills/Knowledge:
  V1/backend/src/services/skills/SkillRegistryService.ts
  V1/backend/src/services/skills/CustomSkillManager.ts          ← needs binary skip fix
  V1/backend/skills/GlobalHR/forms/*.json                       ← stable selectors
  V1/backend/System Knowledge/GlobalHR Userguides/              ← NOT YET INGESTED
```
