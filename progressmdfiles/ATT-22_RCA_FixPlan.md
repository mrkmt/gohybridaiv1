# Root Cause Analysis (RCA) & Fix Plan: ATT-22

## 🏷️ Ticket Information
- **Ticket ID:** ATT-22
- **Module:** Department
- **Issue:** False "PASS" results in UI Wizard while browser execution was failing.

---

## 🔍 Root Cause Analysis

### 1. Environment Fault: Missing Browser Binary
The `@playwright/mcp` server was configured to use `chrome-for-testing`, but the binary was not installed in the environment (`~/.cache/ms-playwright`).
- **Symptom:** Logs showed `Error: Browser "chrome-for-testing" is not installed.`
- **Impact:** Every step "executed" but only returned the error string instead of performing the action.

### 2. Logic Bug: Inadequate Error Detection in MCP Client
The `PlaywrightMcpClient.ts` (located in `V1/backend/src/services/mcp/`) extracts the result of a tool call but fails to distinguish between a functional success and an MCP-level error string returned as text.
- **Symptom:** The client resolved the "Add New" button to an error message and continued execution.
- **Impact:** The `McpTestExecutor` saw a successful string return and marked the step as `PASS`.

### 3. Template Resolution Failure
The generated Playwright script used `{{timestamp_slice_0_4}}` and `{{timestamp_slice_5_upper}}` for the Short Code field.
- **Symptom:** `TemplateResolver.ts` does not support `timestamp_slice` patterns.
- **Impact:** The `JSONToPlaywrightCompiler` defaulted these values to empty strings, resulting in `universalFill(..., '')`.

---

## 🛠️ Fix Plan

### Phase 1: Environment Correction (Completed)
- [x] Run `npx @playwright/mcp install-browser chrome-for-testing` to ensure binaries are available for the MCP server.

### Phase 2: Code Hardening (Completed)
- [x] **Patch `PlaywrightMcpClient.ts`**: Updated `extractText` to detect string-based errors and throw a hard `Error`.
- [x] **Enhance `TemplateResolver.ts`**: Added support for `timestamp_slice_X_Y` and case transformation (`_upper`/`_lower`).

### Phase 3: Validation & Reset (Completed)
- [x] **Database Cleanup**: Deleted all 5 cached entries in `test_scripts` for `ATT-22`.
- [ ] **Re-run Test**: Execute the UI Wizard again to verify that the browser now spawns and the validation logic is actually tested.

---

## 📝 Technical Notes
- **Target Directory:** `V1/backend`
- **Service Impact:** Resolved "false pass" bug and improved data generation fidelity.

## Update 2026-05-04: Execution Hang Fix
- **Issue:** Test execution stuck after clicking "Save/Submit".
- **RCA:** `waitForAngularStable` was waiting indefinitely for Zone.js stability. Some pages with background timers or polling prevent Angular from ever reaching a "stable" state, causing `Promise.all(testabilities.map(t => t.whenStable(resolve)))` to hang forever.
- **Fix Applied:**
  - Added 5s timeout to `waitForAngularStable` with automatic fallback to fixed delay.
  - Added 60s default timeout to all MCP calls in `PlaywrightMcpClient`.
  - Added process-exit cleanup to `PlaywrightMcpClient` to reject pending promises.
- **Status:** Backend restarted. Pending user re-run.
