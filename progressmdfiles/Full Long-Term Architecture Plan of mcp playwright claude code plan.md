Full Long-Term Architecture Plan
What You Want (Restated Precisely)
MCP Playwright as the live execution layer (replaces compiled scripts)
Script Library — when a test passes cleanly (no code faults), save those exact steps. Next run on same ticket: skip AI entirely, run saved script directly
Sprint Regression — run ALL GT tickets in a sprint at once, parallel, with a single report
Smart AI routing — AI only runs when: (a) no saved script exists, (b) saved script fails because UI changed (not because of test code fault)
The Core Insight: Three Run Types
TICKET MENTIONED
↓
┌─────────────────────────────────────────┐
│ Script Library Check │
│ Does a PASSING script exist? │
└─────────────────────────────────────────┘
│ │
YES NO
↓ ↓
Run Saved Script AI Pipeline
(no AI cost) (discover→generate→execute)
│ │
PASS? PASS?
│ │ │ │
YES NO YES NO
↓ ↓ ↓ ↓
Done Classify Save Script Classify
Failure Failure
│ │
UI Changed? Code Fault?
│ │ │ │
YES NO YES NO
↓ ↓ ↓ ↓
Re-discover Report Alert: Report:
Re-generate Code Fix Real Fail
Save New Fault Script (real bug)
Phase 0 — Database Schema (DB migration v25, v26)
test_scripts table (the script library)
CREATE TABLE test_scripts (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
ticket_id VARCHAR(50) NOT NULL, -- e.g. ATT-15
scenario_id VARCHAR(50) NOT NULL, -- e.g. SC-001
scenario_name TEXT,
module VARCHAR(100),
steps JSONB NOT NULL, -- [{action, target, value}] — MCP steps
pass_rate NUMERIC(5,2) DEFAULT 0, -- 0-100, last known pass rate
run_count INT DEFAULT 0,
pass_count INT DEFAULT 0,
last_run_at TIMESTAMPTZ,
last_pass_at TIMESTAMPTZ,
ui_hash VARCHAR(64), -- hash of snapshot when script was saved
source VARCHAR(20) DEFAULT 'ai', -- 'ai' | 'manual'
created_at TIMESTAMPTZ DEFAULT NOW(),
updated_at TIMESTAMPTZ DEFAULT NOW(),
UNIQUE(ticket_id, scenario_id)
);
sprint_runs table
CREATE TABLE sprint_runs (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
sprint_id VARCHAR(100) NOT NULL, -- Jira sprint ID
sprint_name VARCHAR(255),
project_key VARCHAR(50), -- GT project key
status VARCHAR(20) DEFAULT 'pending', -- pending/running/done/failed
ticket_count INT DEFAULT 0,
pass_count INT DEFAULT 0,
fail_count INT DEFAULT 0,
fault_count INT DEFAULT 0,
started_by VARCHAR(255),
started_at TIMESTAMPTZ DEFAULT NOW(),
completed_at TIMESTAMPTZ,
jira_comment_id VARCHAR(100) -- comment posted to sprint epic
);
sprint_run_results table
CREATE TABLE sprint_run_results (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
sprint_run_id UUID REFERENCES sprint_runs(id) ON DELETE CASCADE,
ticket_id VARCHAR(50) NOT NULL,
ticket_summary TEXT,
status VARCHAR(20), -- pass/fail/fault/skipped/error
script_source VARCHAR(20), -- 'saved'|'ai_generated'|'regenrated'
scenarios_total INT DEFAULT 0,
scenarios_pass INT DEFAULT 0,
scenarios_fail INT DEFAULT 0,
duration_ms INT,
failure_reason TEXT,
screenshot_url TEXT,
created_at TIMESTAMPTZ DEFAULT NOW()
);
Phase 1 — PlaywrightMcpClient
File: src/services/mcp/PlaywrightMcpClient.ts

Spawns @playwright/mcp as a stdio process. Implements JSON-RPC 2.0 client.

class PlaywrightMcpClient {
// Session management
static async create(options?: McpClientOptions): Promise<PlaywrightMcpClient>
async close(): Promise<void>

// Navigation
async navigate(url: string): Promise<void>

// Discovery
async snapshot(): Promise<string> // accessibility tree text
async screenshot(): Promise<string> // base64 PNG
async snapshotHash(): Promise<string> // SHA-256 of snapshot (for UI change detection)

// Interaction
async click(elementName: string): Promise<void>
async fill(fieldName: string, value: string): Promise<void>
async selectOption(fieldName: string, value: string): Promise<void>
async pressKey(key: string): Promise<void>
async waitForText(text: string, timeout?: number): Promise<void>
async waitForSelector(selector: string, timeout?: number): Promise<void>

// Login helper
async login(baseUrl: string, credentials: TestCredentials): Promise<void>
}
Key design: One PlaywrightMcpClient instance per test session. The MCP process stays alive for the entire session so login state is preserved across steps.

Phase 2 — McpDiscoveryService
File: src/services/discovery/McpDiscoveryService.ts

Replaces discover-page.ts + DiscoveryCacheService for inline discovery.

class McpDiscoveryService {
// Called during startSession — returns snapshot + hash
async discoverModule(
client: PlaywrightMcpClient,
moduleRoute: string
): Promise<McpDiscoveryResult>

// Returns snapshot hash to detect UI changes between runs
async getUiHash(client: PlaywrightMcpClient, moduleRoute: string): Promise<string>
}

interface McpDiscoveryResult {
snapshot: string // accessibility tree text
hash: string // SHA-256 for change detection
moduleRoute: string
capturedAt: Date
}
The snapshot text replaces DiscoveryCacheService.getPromptContext(). Vertex AI sees real elements, not stale cached ones.

Phase 3 — TestScriptStore (Script Library)
File: src/services/scripts/TestScriptStore.ts

class TestScriptStore {
// Check if a passing script exists for this ticket+scenario
async load(
ticketId: string,
scenarioId: string
): Promise<SavedScript | null>

// Save a script after a clean pass (no code faults)
async save(
ticketId: string,
scenarioId: string,
steps: McpStep[],
uiHash: string,
metadata: ScriptMetadata
): Promise<void>

// Record pass/fail outcome after execution (updates stats)
async recordOutcome(
ticketId: string,
scenarioId: string,
outcome: 'pass' | 'fail' | 'fault'
): Promise<void>

// Check if UI has changed since script was saved (hash comparison)
async hasUiChanged(
ticketId: string,
scenarioId: string,
currentHash: string
): Promise<boolean>

// Get all tickets that have saved scripts (for sprint regression)
async listSavedTickets(projectKey: string): Promise<string[]>
}
Save policy:

Save only when: all steps executed, status = PASS, zero code faults
Invalidate (mark stale) when: uiHash differs from saved hash
Phase 4 — SmartExecutionRouter
File: src/services/execution/SmartExecutionRouter.ts

The core intelligence. Routes each scenario to: saved script → AI generation → result classification.

class SmartExecutionRouter {
async run(
session: TestSession,
scenario: TestScenario,
client: PlaywrightMcpClient,
currentUiHash: string
): Promise<ScenarioResult>
}
Internal routing logic:

1. Load saved script for (ticketId, scenarioId)
   ├── Found AND ui_hash matches current hash:
   │ → Execute saved steps (McpTestExecutor)
   │ → PASS → record outcome, return
   │ → FAIL → classify failure:
   │ ├── CODE_FAULT → report, don't touch script
   │ └── REAL_FAIL → report regression bug
   │
   ├── Found BUT ui_hash differs (UI changed):
   │ → Re-run discovery (McpDiscoveryService)
   │ → Re-generate via AI (with fresh snapshot)
   │ → Execute
   │ → PASS → overwrite saved script with new steps + new hash
   │ → FAIL → report
   │
   └── Not found:
   → AI pipeline (discover → generate → execute)
   → PASS (no faults) → save script to library
   → PASS (with faults) → report faults, don't save
   → FAIL → report
   Failure classification (reuses existing FailureClassificationService):

CODE_FAULT — selector not found, script error, MCP error → the test code is wrong, not the app
REAL_FAIL — app behaved wrongly (wrong text, missing element, wrong state) → genuine bug
Phase 5 — McpTestExecutor
File: src/services/execution/McpTestExecutor.ts

Replaces JSONToPlaywrightCompiler. Executes McpStep[] by calling Playwright MCP tools directly.

class McpTestExecutor {
async execute(
steps: McpStep[],
client: PlaywrightMcpClient,
options?: ExecutionOptions
): Promise<ExecutionResult>
}

interface McpStep {
action: 'navigate'|'click'|'fill'|'select'|'waitForText'|
'assertVisible'|'assertText'|'screenshot'|'pressKey'
target?: string // element name (from accessibility tree) or URL
value?: string // fill value, expected text, etc.
description?: string
}
Step format is deliberately much simpler than the current TestSpecSchema. No Zod validation needed — if the AI returns [{action,target,value}] arrays, they just work. No more sanitiseSpec, no more 60-line schema.

Phase 6 — SprintRegressionRunner
File: src/services/sprint/SprintRegressionRunner.ts

class SprintRegressionRunner {
// Fetch all GT tickets in a sprint from Jira
async fetchSprintTickets(
sprintId: string,
userId: string,
pool: Pool
): Promise<SprintTicket[]>

// Run all tickets concurrently (max 3 parallel browser sessions)
async runSprint(
sprintRunId: string,
tickets: SprintTicket[],
userId: string,
pool: Pool,
onProgress: (update: SprintProgress) => void
): Promise<SprintSummary>
}
Concurrency: max 3 PlaywrightMcpClient instances at once (3 browser processes). Each processes one ticket at a time. Queue-based with p-limit.

Sprint result report posted to Jira as a comment on the sprint's epic/parent ticket (GT project):

🏃 Sprint Regression: Sprint 23 — 18 tickets
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Pass (saved script): 11
✅ Pass (AI generated): 3
❌ Fail (regression bug): 2
⚠️ Fault (script error): 1
⏭️ Skipped: 1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Duration: 4m 32s
Failures:
ATT-22 — Payroll slip date field regression (screenshot attached)
ATT-31 — Leave balance shows negative value
Faults (script errors, not app bugs):
ATT-44 — Selector not found: "Approve All" button (UI may have changed)
Phase 7 — API Routes + Frontend
New backend routes:
POST /api/testing/:ticketId/run → SmartExecutionRouter (single ticket)
GET /api/scripts/:ticketId → list saved scripts for a ticket
DELETE /api/scripts/:ticketId/:scenarioId → remove saved script (force re-generate)
GET /api/sprint/list → Jira sprint list for GT project
POST /api/sprint/run → start sprint regression
GET /api/sprint/:runId/status → poll progress (SSE stream)
GET /api/sprint/:runId/report → full report
Frontend additions (new panels in existing UI):
Script Library panel — table of saved scripts, pass rate, last run, delete button
Sprint Regression panel — sprint dropdown, "Run All" button, live progress bar, result table

## Phase 4.5 — Approve & Run Flow Fixes (Target Resolution Gate)

**Current "Approve and Run" Flow:**

1. **Approve** (`POST /api/testing/:ticketId/test-cases/approve`): Validates test cases exist, sets `approvedTestCases = true`, and syncs cases to Jira.
2. **Execute** (`POST /api/testing/:ticketId/execute`): Checks approval lock, then hands off to `TestingExecutionOrchestrator.execute()`.
3. **Orchestrator**: Locks session, sets phase to `executing`, loops over scenarios, and triggers `runWithMcp()`. Failed steps trigger `McpHealingService` and successful heals are saved back via `persistHealedSelector()`.

**The Bug:** The execution fails immediately because the Target Resolution gate allows natural language strings (e.g., "Save button") to bypass cache resolution by treating them as valid `selectorHint`s.

**To-Do List for Immediate Fixes:**

- [x] **Fix `hasUsableHint` Validation:** Update `backend/src/services/generation/TestSpecTargetResolver.ts`. `hasUsableHint` must enforce `looksLikeCssSelector(hint)`. This stops natural language from being treated as a valid CSS selector and forces it through the Discovery cache matching or LLM auto-retry.
- [x] **Robust Fallback in `McpTestExecutor`:** Ensure the executor checks selector validity before injection. If a target is strictly plain text, it should fallback to Playwright's `getByText()` or `getByRole()` instead of failing outright on `document.querySelector()`.
- [x] **Knowledge Loop Verification:** Ensure that once a step passes or heals, `persistHealedSelector()` actively updates `module_skills` and the AI prompts immediately pick up the verified selectors for subsequent runs.

## Phase 8 — Multi-Tenant & Multi-Route Scaling (Deep Dive Additions)

As the system scales to handle complex Jira tickets involving brand-new menus or data isolation rules (e.g., Employee A vs. Employee B), the architecture must support **Exploratory Crawling** and **Dual-Actor Execution**.

### 8.1 Exploratory Discovery for New Menus

When a ticket introduces a new module (e.g., "Add Label Setup under Master"), the system won't know the exact `#` route to hit directly.

- **TicketContextService Enhancement:** Analyzes the Jira ticket to extract an array of affected areas (e.g., `['Master / Label Setup', 'Performance Journal']`).
- **The Exploratory Crawler:**
  1. `McpDiscoveryService` lands on the dashboard.
  2. It captures the DOM of the global navigation sidebar.
  3. It uses a lightweight LLM call to map the requested menu path (e.g., "Master" -> "Label Setup") to the actual UI elements.
  4. It executes the clicks, extracts the newly revealed URL (`#/app.labelsetup`), and performs the standard UI capture.
- **Knowledge Persistence:** The successful navigation sequence is saved to `module_skills.navigation_path`, so future AI test generations know exactly how to reach the new module without re-exploring.

### 8.2 Data Isolation Testing (Multi-Actor Execution)

To test rules like "Employees can only see their own journal entries," the execution layer must simulate multiple users.

- **Dual-Account Provisioning:** The test environment must be configured with at least two baseline accounts (e.g., `TEST_USER_PRIMARY` and `TEST_USER_SECONDARY`).
- **Actor-Tagged Steps:** Test steps in the JSON specification can be tagged with an actor (e.g., `@actor: primary`, `@actor: secondary`).
- **McpTestExecutor Context Switching:**
  1. The executor runs the first set of steps (e.g., creating an entry) logged in as `Primary`.
  2. When it encounters a step tagged for `Secondary`, it gracefully closes the current `PlaywrightMcpClient` session.
  3. It immediately spawns a new session, logs in using the `TEST_USER_SECONDARY` credentials, and resumes executing the remaining verification steps (e.g., asserting the entry is hidden).
- **Alternative (God Mode):** If the HR system supports "Impersonation", the AI can be instructed to use the UI's impersonation feature to switch contexts without requiring a secondary login, simplifying execution.

**To-Do List for Phase 8:**

- [ ] Create `TicketContextService.ts` to parse multiple module routes from Jira descriptions using a lightweight LLM classification step.
- [ ] Implement an `explore()` mode in `McpDiscoveryService.ts` that navigates menus when the exact URL hash is unknown.
- [ ] Update `McpTestExecutor.ts` to parse `@actor:` tags in steps and perform `client.login()` swaps mid-test.
- [ ] Add `.env` support for `TEST_USER_SECONDARY` and `TEST_PASS_SECONDARY`.

Migration Plan (keep existing system running)
Week 1: Phase 0 + 1 (DB + PlaywrightMcpClient) — no breaking changes
Week 2: Phase 2 + 3 (Discovery + ScriptStore) — parallel with current cache
Week 3: Phase 4 + 5 (SmartRouter + McpExecutor) — replaces compiler
Week 4: Phase 6 + 7 (Sprint regression + UI) — additive only
Existing discover-page.ts, JSONToPlaywrightCompiler, DiscoveryCacheService stay in place during migration and are removed only after Phase 5 is validated.

Risk Table
Risk Severity Mitigation
@playwright/mcp process leak MEDIUM ProcessManager with exit hooks, session cleanup
Angular SPA login timing in MCP LOW Already solved — waitForText(knownElement)
AI returns non-array step format LOW JsonExtractor.tryArray() already handles this
Sprint run with 50+ tickets MEDIUM p-limit(3) concurrency, queue, timeout per ticket
UI hash false-positive (dynamic content) MEDIUM Hash only structural elements, ignore timestamps
Jira sprint API rate limit LOW 200ms delay between fetches
Estimated Effort
Phase Files Complexity Time
0: DB v25+v26 MigrationManager.ts LOW 2h
1: PlaywrightMcpClient 1 new file MEDIUM 1.5d
2: McpDiscoveryService 1 new file LOW 0.5d
3: TestScriptStore 1 new file LOW 0.5d
4: SmartExecutionRouter 1 new file HIGH 1.5d
5: McpTestExecutor 1 new file MEDIUM 1d
6: SprintRegressionRunner 2 new files HIGH 2d
7: Routes + Frontend 3–4 files MEDIUM 1.5d
Total ~10 files ~9 days
