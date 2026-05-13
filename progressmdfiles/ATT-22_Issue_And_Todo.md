# ATT-22: Issue List & TODO Roadmap

## 🔴 Current Issues (Identified May 2, 2026)

### 1. Execution Stability & Silent Failures
- **Symptom:** UI Wizard reported "0 passed, 0 failed" while internal logs showed login failures or path errors.
- **Root Cause:** `PlaywrightMcpClient` was swallowing RPC errors; `JSONToPlaywrightCompiler` was emitting Windows absolute paths (`D:/...`) for shared helpers, causing imports to fail on the Linux VM.
- **Status:** **Partially Fixed** (Paths corrected, Client error detection improved).

### 2. Deep-Link Navigation Fragility (Angular Hash-Route)
- **Symptom:** Direct navigation to `#/app.department` often lands on `#/not-found` or a blank page.
- **Root Cause:** The Angular application's state (Module-level lazy loading) isn't always initialized correctly via deep-link. It expects a "User Click Path" (Sidebar: Master > Department).
- **Status:** **Investigating** (Verified via `verify_mcp_healing.ts` that `#/not-found` is hit).

### 3. Selector Hallucination in AI Generation
- **Symptom:** Generated test cases included assertions like `expect(...).toContainText("'Add New' button should be visible")`.
- **Root Cause:** AI was mixing "Plan" descriptions with "Assertion" logic, creating tests that check for the *instruction* text instead of the *UI element* state.
- **Status:** **Manual Correction Applied** to `ATT-22` script; long-term fix required in `PromptBuilderService`.

### 4. Brittle Login Logic
- **Symptom:** Mono-script `evaluate()` login was failing due to race conditions in Angular's Zone.js.
- **Root Cause:** Attempting to fill all fields and click in one block doesn't allow for event propagation between `idnumber` and `username`.
- **Status:** **Fixed** (Refactored `PlaywrightMcpClient` to use sequential native MCP tools).

---

## 📝 TODO List (Next Steps)

### Phase 1: Infrastructure Cleanup (Priority: High)
- [x] **Fix Compiler Paths:** Update `JSONToPlaywrightCompiler.ts` to use relative paths for helpers (Linux compatibility).
- [x] **Native MCP Login:** Replace monolithic JS login with sequential `browser_type` and `browser_click` calls.
- [ ] **Clean Generation Cache:** Clear `V1/backend/tests/generated/` of any scripts containing Windows paths to prevent accidental re-runs of broken code.

### Phase 2: Test Reliability (Priority: Medium)
- [ ] **Implement "Sidebar Navigation Skill":** Update `McpTestExecutor.ts` or the Compiler to prefer clicking through the sidebar (Master -> Module) instead of direct `page.goto()`.
- [ ] **Fix Assertion Hallucination:** Update `enterprise-execution-rules.ts` to strictly forbid AI from asserting on "Status" or "Instruction" text unless it is a visible Notification/Toast.
- [ ] **Brace Integrity Audit:** Permanently fix the syntax errors in `JsonTestGenerationService.ts` (TS1068) detected during this session.

### Phase 3: ATT-22 Verification (Priority: Critical)
- [ ] **Reproduce Bug:** Run the corrected `ATT-22` script and verify it fails on the 6-character Short Code (Actual: No error message).
- [ ] **Final Pass:** Once the bug is confirmed via script, transition the ticket to "Done" (if fix is already in environment) or "Bug Confirmed" with logs.

---

## 🛠️ Tools Created / Modified
- `V1/backend/verify_mcp_healing.ts`: Native MCP testing harness.
- `check_braces_dynamic.js`: Deep syntax integrity checker for Backend services.
- `V1/backend/src/services/mcp/PlaywrightMcpClient.ts`: Native-first refactor.
