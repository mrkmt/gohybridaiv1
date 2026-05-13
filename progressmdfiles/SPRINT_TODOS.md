# GoHybridAI — Sprint Status
# Last updated: 2026-04-28 (Post-Stability Audit)

---

## DONE

### Core Infrastructure & Stability
- [x] Binary-corrupted files reconstructed (`app.ts`, `settingsRoutes.ts`, `JiraConfigService.ts`, etc.)
- [x] `authRouter` + `testingRouter` mounted and reachable
- [x] Login works (`AuthService.setPool(pool)`)
- [x] DB migrations v1–v29 applied (includes `scenario_type` + `heal_history` on `test_scripts`)
- [x] **Session Reset Fix** — Changed `is_running: false` to `executionLock: false` in `TestingWorkflowController.ts`.
- [x] **MCP JSON-RPC Handshake** — Verified compliance and fixed hardcoded `--browser=chrome` in `PlaywrightMcpClient.ts`.
- [x] **Health Monitoring** — Enhanced `/api/health` with `SharedBrowserPool` stats and uptime.

### Discovery Pipeline
- [x] `ModuleRouteRegistry.ts` — single source of truth for 86 module routes.
- [x] **AiModuleResolverService.ts** — Phase 1 AI integration for module detection (resolves ATT-08 type failures).
- [x] Grid/modal/menu rich extraction; icon-only buttons captured.
- [x] `KendoSelectors.ts` — single source of truth for Kendo functional classes.
- [x] Ubuntu headless support: `--no-sandbox` applied to all Playwright/MCP launch points.

### MCP Execution & Healing
- [x] **SkillStore.ts Fix** — Extraction now uses `step.element` (matching `McpStep` schema); known_selectors now populating.
- [x] **TestCase Cache Fix** — Added `scenarioId` to `TestCase` objects; generation cache hit rate restored.
- [x] `McpHealingService.ts`: `classify()`, `healAction()`, `healAssertion()`, `extractFieldConstraints()`.
- [x] **Login failure hard-stop** — Orchestrator now throws if login fails (detected via URL check).

### Frontend / UI
- [x] **Global System Alert** — Sticky banner in `GoHybridChat.tsx` for deployment status.
- [x] **Multi-Chat WS Support** — `useExecutionWebSocket.ts` rewritten for background logging across multiple sessions.
- [x] **Auto-Logout** — `auth:expired` event listener triggers logout on token expiry.
- [x] Description truncation at 200 chars in `TicketCard`.
- [x] Multi-chat Bug A/B/C fixed (targetId threading, multi-subscription).

### Deployment (Ubuntu)
- [x] `scripts/deploy-ubuntu.sh` — Full Node/PM2/Playwright/MCP distribution setup.
- [x] `scripts/copy-to-server.sh` — Rsync-based sync script.
- [x] `nginx/gohybridai.conf` — Optimized proxy config for API/WS.
- [x] `ecosystem.config.js` — PM2 worker configuration.

---

## TO DO

### P1 — Verify (Execution Phase)

- [ ] **ATT-15 linked ticket chips** — confirm AB-18, AD-1, AD-2 chips appear on real fetch.
- [ ] **ATT-22 end-to-end** — run full generate → execute → heal cycle.
- [ ] **ATT-08 Discovery Verification** — confirm `#/app.leaveBalanceReport` route works.

### P3 — Medium-term

- [ ] **Discovery Phase 2 — AI Inventory Enrichment**
  - async AI post-processing: adds semantic labels/purpose to `PageInventory`.
- [ ] **Vertex AI SDK migration** — Migrate `@google-cloud/vertexai` → `@google/genai` (Deadline: June 2026).
- [ ] **Discovery sidebar navigation** — Fix timeouts on specific modules via verified CSS classes.
- [ ] **Rate limiting** — prevent browser storm (5 concurrent users).
- [ ] **User isolation** — currently `test_scripts` keyed by ticket only; needs per-user keys.

### P4 — Long-term

- [ ] **Discovery Phase 3 — AI-Driven MCP Exploration**
  - AI agent discovers validation rules and conditional states.
- [ ] Sprint regression overnight batch runner.
- [ ] Multi-user dashboard + per-user token cost tracking.
