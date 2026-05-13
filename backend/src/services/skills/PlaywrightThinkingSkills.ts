/**
 * PlaywrightThinkingSkills.ts
 *
 * Reusable "thinking" patterns for writing perfect Playwright scripts.
 * These are the proven strategies discovered from real test execution on GlobalHR Cloud.
 * 
 * Each skill is a self-contained pattern that can be used by:
 *   - AI test generation (prompted via enterprise execution rules)
 *   - JSONToPlaywrightCompiler (emits code using these patterns)
 *   - Self-healing service (applies these when tests fail)
 *   - UI discovery (validates pages against these expectations)
 *
 * CORE PRINCIPLE: Every generated test should follow these patterns automatically.
 * No hardcoding — all patterns are parameterized and reusable.
 */

// ─── Skill 1: Navigation with Fallback Chain ─────────────────────────────────
/**
 * THINKING: "How do I get to the right page?"
 * Don't assume direct URL works. Try real user flow first, then API menu, then direct URL.
 * 
 * PATTERN:
 *   1. Sidebar clicks (Master → Department) — matches real user behavior
 *   2. Menu API (GetUserLevelMenuData) — uses live system data
 *   3. Direct URL (last resort) — may hit Terms page or login redirect
 */
export const NavigationSkill = `
NAVIGATION PATTERN (use in every test):
  1. Try sidebar menu clicks first:
     - Click parent menu group (e.g., "Master") → wait for submenu
     - Click target menu item (e.g., "Department") → wait for navigation
     - Wait for page's main element (e.g., .k-grid)
  2. If sidebar fails, try Menu API:
     - Fetch GetUserLevelMenuData from browser auth context
     - Find target by URL or name match
     - Click through parent → child path
  3. If API fails, try direct URL:
     - goto(fullUrl) with domcontentloaded
     - Wait for Angular stabilization
     - Wait for main element (.k-grid)
  4. Never assume navigation succeeds — always verify with a visible element
`;

// ─── Skill 2: Unique Test Data Generation ────────────────────────────────────
/**
 * THINKING: "What data should I use so tests don't conflict?"
 * Never hardcode "HR" or "Human Resources" — they may already exist.
 * Generate unique data per run using timestamp suffixes.
 * 
 * PATTERN:
 *   const ts = Date.now().toString(36).slice(-5);
 *   const shortCode = \`T\${ts.slice(0,4).toUpperCase()}\`;  // "TLX4K" (max 5 chars)
 *   const name = \`AutoTest_\${ts}\`;  // "AutoTest_lx4k9"
 */
export const UniqueDataSkill = `
UNIQUE TEST DATA PATTERN:
  - Generate unique identifiers per test run using Date.now().toString(36)
  - For Short Code (max 5 chars): \`T\${ts.slice(0,4).toUpperCase()}\`
  - For Name: \`AutoTest_\${ts}\` or \`TestDept_\${ts}\`
  - Log the generated data at test start for traceability
  - Use the unique values in ALL fill steps and grid verifications
  - This prevents "duplicate" errors and makes each run independent
`;

// ─── Skill 3: API Response Capture ───────────────────────────────────────────
/**
 * THINKING: "How do I know the save actually worked?"
 * Don't just check for visual changes — capture the actual API response.
 * Set up the listener BEFORE clicking Save, not after.
 * 
 * PATTERN:
 *   const apiPromise = page.waitForResponse(
 *     r => r.url().includes('/api/department') && r.request().method() === 'POST',
 *     { timeout: 30000 }
 *   );
 *   // ... click Save ...
 *   const resp = await apiPromise;
 *   const status = resp?.status();  // 200, 201, 400, 500
 *   const body = await resp?.json();  // Log key fields only
 */
export const ApiResponseSkill = `
API RESPONSE CAPTURE PATTERN:
  1. Set up waitForResponse listener BEFORE the action that triggers the API
  2. Match by URL pattern AND HTTP method (POST for create, PUT for edit)
  3. After action, await the response promise
  4. Capture: status code, URL, key response fields (id, name, status)
  5. Log summary only (not full body) to avoid token bloat
  6. If status !== 200/201, flag as potential failure
  7. If no response captured, log warning — save may have been client-side only
`;

// ─── Skill 4: Popup/Notification Detection ───────────────────────────────────
/**
 * THINKING: "What did the system tell me after the action?"
 * GlobalHR shows feedback via: toast notifications, Kendo dialogs, or silent saves.
 * Check all three patterns — don't assume one specific notification type.
 * 
 * PATTERN:
 *   Check notification toasts: .k-notification-*, .notification-*, .alert-*
 *   Check dialog popups: .k-dialog without form fields
 *   Check [role="alert"] elements
 *   If nothing found → silent save (acceptable for some modules)
 */
export const NotificationSkill = `
POPUP/NOTIFICATION DETECTION PATTERN:
  1. Wait 1-2 seconds after save for notification to appear
  2. Check toast notifications (multiple selector patterns):
     - .k-notification-info, .k-notification-success, .k-notification-warning, .k-notification-error
     - .notification-success, .notification-warning, .notification-info
     - .alert-success, .alert-warning, .alert-danger
     - [role="alert"]
  3. Check dialog popups (dialogs without form inputs):
     - .k-dialog:not(:has(input[formcontrolname]))
     - [role="dialog"]:not(:has(input[formcontrolname]))
  4. Extract and log the notification text
  5. Classify: success (contains "success"/"saved"), warning (contains "warn"/"exist"), error (contains "error"/"fail")
  6. If no notification found → log as "silent save" (not a failure)
`;

// ─── Skill 5: Grid Verification with Unique Data ────────────────────────────
/**
 * THINKING: "How do I prove my record was saved correctly?"
 * Don't check for hardcoded text. Use the unique test data to find the exact row.
 * Then verify multiple fields match (name AND short code).
 * 
 * PATTERN:
 *   const row = page.locator('.k-grid-content tbody tr').filter({ hasText: uniqueName }).first();
 *   const found = await row.isVisible({ timeout: 10000 });
 *   if (found) {
 *     const rowText = await row.textContent();
 *     if (rowText.includes(uniqueShortCode)) { // both fields match }
 *   }
 */
export const GridVerificationSkill = `
GRID VERIFICATION PATTERN:
  1. Wait 1-2 seconds after save for grid to refresh
  2. Use unique test name to find the exact row:
     - filter({ hasText: uniqueName }) — finds row containing our unique data
  3. Wait for row visibility with timeout (10-15 seconds)
  4. If found:
     - Extract row text content
     - Verify Short Code also matches (cross-field verification)
     - Log success with both values confirmed
  5. If NOT found:
     - Log the actual grid content (first 2-3 rows only, truncated)
     - Log row count (helps diagnose if grid is empty or has wrong data)
     - Throw descriptive error with the unique name that wasn't found
  6. Never use hardcoded values like "Human Resources" — always use generated unique data
`;

// ─── Skill 6: Form Field Filling (Kendo-Aware) ───────────────────────────────
/**
 * THINKING: "How do I fill fields that might be Kendo-wrapped or Angular-bound?"
 * GlobalHR forms use Kendo floating labels, formControlName bindings, and sometimes
 * native inputs. Try the most specific selector first, then fall back.
 * 
 * PATTERN:
 *   1. kendo-floatinglabel:has-text("Field Name") input
 *   2. input[formcontrolname="FieldName"]
 *   3. input[name="FieldName"]
 *   4. label:has-text("Field Name") ~ input
 *   Use universalFill with isKendo: true for Kendo-aware filling
 */
export const FormFillingSkill = `
FORM FILLING PATTERN (Kendo-Aware):
  1. Build selector chain (most specific → most generic):
     - kendo-floatinglabel:has-text("Field Name") input
     - kendo-textbox:has-text("Field Name") input
     - input[formcontrolname="FieldName"], input[formControlName="FieldName"]
     - input[name="FieldName"]
     - label:has-text("Field Name") ~ input
  2. Use universalFill() with { isKendo: true, slowTyping: true } for Kendo fields
  3. Use universalFill() with { isKendo: false } for native inputs
  4. After fill: await kendoStabilizationDelay() for Angular change detection
  5. For dropdowns:
     - Native select: selectOption({ label: value })
     - Kendo dropdown: click trigger → wait for .k-popup → click option
     - Kendo combobox: type text → press Enter
  6. For required fields: fill before optional fields
  7. After filling: wait for Save button to become enabled (Angular validation)
`;

// ─── Skill 7: Save Button State Monitoring ───────────────────────────────────
/**
 * THINKING: "Is the form ready to submit?"
 * Save buttons are often disabled until required fields are filled and valid.
 * Wait for the button to enable before clicking — don't click a disabled button.
 * 
 * PATTERN:
 *   const enabled = await waitForSaveEnabled(page, 10000);
 *   if (!enabled) { console.warn('Save not enabled — form may have validation errors'); }
 */
export const SaveButtonStateSkill = `
SAVE BUTTON STATE PATTERN:
  1. After filling all fields, wait for Save button to become enabled
  2. Use waitForSaveEnabled(page, timeout) — polls isDisabled() state
  3. If Save is NOT enabled after timeout:
     - Check for validation errors (.text-danger, .ng-invalid)
     - Log which fields may be missing or invalid
     - Either fix the fields or proceed with a warning
  4. Save button selectors (in priority order):
     - button.btn.btn-primary:has-text("Save")
     - button.btn.btn-success:has-text("Save")
     - button.btn.btn-primary
     - button:has(.k-i-check), button:has(.k-i-save)
     - button[type="submit"]
`;

// ─── Skill 8: Error/Validation Detection ─────────────────────────────────────
/**
 * THINKING: "What went wrong if the test fails?"
 * When a save fails, capture the actual error message — don't just say "failed."
 * Check multiple error locations: inline field errors, toast notifications, dialog popups.
 * 
 * PATTERN:
 *   const errors = await page.locator('.text-danger, .validation-error, .k-invalid, [role="alert"]').allTextContents();
 */
export const ErrorDetectionSkill = `
ERROR/VALIDATION DETECTION PATTERN:
  1. After failed save attempt, scan for errors in multiple locations:
     - .text-danger (inline field errors)
     - .validation-error (Angular validation messages)
     - .k-invalid (Kendo validation state)
     - [role="alert"] (accessibility alert)
     - .k-notification-error, .notification-error, .alert-danger (toast errors)
  2. Extract all error text (truncate to 200 chars each)
  3. Log errors with context: "Save failed: [error messages]"
  4. Classify error type:
     - Validation: "required", "must be", "invalid", "max length"
     - Duplicate: "already exists", "duplicate", "unique"
     - Permission: "denied", "unauthorized", "forbidden"
     - Infrastructure: "timeout", "network", "unreachable"
`;

// ─── Skill 9: Icon-Only Button Selection ─────────────────────────────────────
/**
 * THINKING: "The button has no text — how do I click it?"
 * Kendo UI toolbar buttons are often icon-only (no text, no aria-label).
 * has-text() and getByRole() will ALWAYS fail on these.
 * Use title attributes, icon classes, or position-based selection.
 * 
 * PATTERN:
 *   button[title="Add New"] — most reliable (if title attribute exists)
 *   button:has(.k-i-plus) — Kendo icon class
 *   .k-header button.k-button:last-of-type — position in toolbar
 *   .btn.btn-primary.me-2.ms-0 — specific class pattern from harvester
 */
export const IconOnlyButtonSkill = `
ICON-ONLY BUTTON PATTERN:
  NEVER use: button:has-text("Add New") or getByRole('button', { name: 'Add New' })
  These WILL fail on icon-only buttons (no text content).

  USE these strategies (in priority order):
  1. Title attribute: button[title="Add New"], [title*="Add" i]
  2. Kendo icon class: button:has(.k-i-plus), button:has(.k-i-check), button:has(.k-i-x)
  3. Harvester-proven class: .btn.btn-primary.me-2.ms-0 (for Add New)
  4. Position-based: .k-header button.k-button:first-of-type (first toolbar button)
  5. Generic primary: button.btn.btn-primary (if only one primary button exists)

  Common icon-only buttons and their Kendo icon classes:
  - Add New → .k-i-plus, .k-i-add
  - Save → .k-i-check, .k-i-save
  - Cancel → .k-i-x, .k-i-cancel
  - Edit → .k-i-pencil, .k-i-edit
  - Delete → .k-i-close, .k-i-delete, .k-i-trash
  - Refresh → .k-i-reload, .k-i-refresh
  - Export → .k-i-download, .k-i-file
`;

// ─── Skill 10: Tab Navigation for Multi-Tab Forms ────────────────────────────
/**
 * THINKING: "The form has multiple tabs — am I on the right one?"
 * GlobalHR forms often split fields across tabs (Basic Info, Additional Info, etc.)
 * Before filling fields, verify or switch to the correct tab.
 * 
 * PATTERN:
 *   Click tab by text: .k-tabstrip-items .k-item:has-text("Tab Name")
 *   Wait for tab content to load: waitForAngular()
 *   Verify expected fields are visible before filling
 */
export const TabNavigationSkill = `
TAB NAVIGATION PATTERN:
  1. Before filling fields, check which tab is active:
     - .k-tabstrip-items .k-state-active (Kendo tabstrip)
     - ul.nav-tabs .nav-item.active (Bootstrap tabs)
  2. If wrong tab is active, switch:
     - Click tab by text: .k-link-text:has-text("Tab Name")
     - Or: .k-tabstrip-items .k-item:has-text("Tab Name")
     - Wait 500ms + waitForAngular() after click
  3. After switching, verify expected fields are visible
  4. Common tab names in GlobalHR:
     - Basic Information, Company Policy, Generate Number
     - Additional Information, Personal Details, Employment
`;

// ─── Skill 11: Required Field Detection ──────────────────────────────────────
/**
 * THINKING: "Which fields must be filled before I can save?"
 * Detect required fields by scanning for: required attribute, red asterisks,
 * Angular validation classes, and floating label indicators.
 * 
 * PATTERN:
 *   - HTML5 required attribute: [required]
 *   - Angular validation: .ng-invalid.ng-dirty
 *   - Visual indicators: label with red asterisk, .text-danger
 *   - Kendo floating labels: kendo-label with required marker
 */
export const RequiredFieldDetectionSkill = `
REQUIRED FIELD DETECTION PATTERN:
  1. Scan form for required indicators:
     - [required] attribute on inputs
     - ng-required="true" (Angular)
     - .ng-invalid.ng-dirty or .ng-invalid.ng-touched (Angular validation state)
     - Labels with red asterisk: label .text-danger, label:has-text("*")
     - Kendo floating labels with required marker
  2. Fill ALL required fields before attempting Save
  3. After filling, wait for Save button to become enabled
  4. If Save remains disabled, check which required fields are empty/invalid
`;

// ─── Skill 12: Wait for Angular/Kendo Stabilization ──────────────────────────
/**
 * THINKING: "Is the page ready for interaction, or is Angular still processing?"
 * Angular SPAs have background change detection, loading masks, and Kendo animations.
 * Never interact with elements while these are active.
 * 
 * PATTERN:
 *   await waitForAngular(page);  // Wait for Zone.js stabilization
 *   await waitForLoadingMask(page);  // Wait for .k-loading-mask to disappear
 *   await kendoStabilizationDelay(page);  // Wait for Kendo animations
 *   await page.waitForTimeout(500);  // Brief buffer for rendering
 */
export const StabilizationSkill = `
ANGULAR/KENDO STABILIZATION PATTERN:
  Before EVERY interaction:
    1. await waitForAngular(page);  // Zone.js stable
    2. await waitForLoadingMask(page);  // No .k-loading-mask visible
  
  After EVERY interaction:
    3. await page.waitForTimeout(500);  // Brief rendering buffer
    4. await kendoStabilizationDelay(page);  // Kendo animations complete
  
  After navigation:
    5. await page.waitForTimeout(3000);  // Angular lazy-load module
    6. await waitForAngular(page);
    7. await waitForLoadingMask(page);
  
  NEVER use: networkidle (Angular background polling makes it timeout)
  ALWAYS use: domcontentloaded for page.goto()
`;

// ─── Master Skill: Complete Test Flow ────────────────────────────────────────
/**
 * THINKING: "What's the complete flow for a perfect test?"
 * This combines all 12 skills into a single execution blueprint.
 * Every generated test should follow this exact flow.
 */
export const CompleteTestFlowSkill = `
COMPLETE TEST FLOW (apply to every CRUD test):

  ┌─ SETUP ──────────────────────────────────────────────────┐
  │ 1. Generate unique test data (timestamp-based)           │
  │ 2. Login (check if already logged in first)              │
  │ 3. Navigate to target module (sidebar → API → URL)       │
  │ 4. Wait for page load (.k-grid visible)                  │
  └──────────────────────────────────────────────────────────┘

  ┌─ CREATE ─────────────────────────────────────────────────┐
  │ 5. Set up API response listener (BEFORE action)          │
  │ 6. Click Add New (icon-aware selector)                   │
  │ 7. Wait for form to appear (dialog or inline)            │
  │ 8. Detect required fields                                │
  │ 9. Fill required fields (Kendo-aware)                    │
  │ 10. Fill optional fields                                 │
  │ 11. Wait for Save button enabled                         │
  │ 12. Click Save                                           │
  │ 13. Await API response (capture status, body summary)    │
  │ 14. Capture notification/popup text                      │
  │ 15. Verify record in grid (unique name + short code)     │
  └──────────────────────────────────────────────────────────┘

  ┌─ VALIDATE ───────────────────────────────────────────────┐
  │ 16. If save failed: detect validation errors             │
  │ 17. If grid verification failed: log actual grid content │
  │ 18. Classify result: PASS, FAIL (validation), FAIL (API) │
  └──────────────────────────────────────────────────────────┘

  ┌─ CLEANUP (optional) ─────────────────────────────────────┐
  │ 19. Delete test record if created                        │
  │ 20. Verify record removed from grid                      │
  └──────────────────────────────────────────────────────────┘
`;

// ─── Export all skills as a single reference object ──────────────────────────
export const PlaywrightThinkingSkills = {
  navigation: NavigationSkill,
  uniqueData: UniqueDataSkill,
  apiResponse: ApiResponseSkill,
  notification: NotificationSkill,
  gridVerification: GridVerificationSkill,
  formFilling: FormFillingSkill,
  saveButtonState: SaveButtonStateSkill,
  errorDetection: ErrorDetectionSkill,
  iconOnlyButton: IconOnlyButtonSkill,
  tabNavigation: TabNavigationSkill,
  requiredFieldDetection: RequiredFieldDetectionSkill,
  stabilization: StabilizationSkill,
  completeFlow: CompleteTestFlowSkill,
};

/**
 * Get all skills as a single prompt block for AI test generation.
 * This is injected into the JSON test generation prompt.
 */
export function getSkillsPrompt(): string {
  return `
=== PLAYWRIGHT THINKING SKILLS (MUST FOLLOW) ===

These are proven patterns from real test execution on GlobalHR Cloud.
Apply ALL relevant skills when generating test steps.

${Object.values(PlaywrightThinkingSkills).join('\n\n')}

=== END THINKING SKILLS ===
`;
}
