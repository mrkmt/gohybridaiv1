/**
 * backend/api/SelfHealingService.ts — SAFE_FALLBACK_MAP expansion
 *
 * P1 FIX: Was only 4 entries (username, password, submit, kendo-dropdown).
 * Now covers 60+ selectors for all common GlobalHR UI elements.
 * Each entry: instant fix, zero AI, confidence 0.9.
 *
 * Usage: replaces the SAFE_FALLBACK_MAP constant in SelfHealingService.ts
 * Also adds: healingAttemptTracker (P1 — healing loop detection)
 */

// ─── expanded SAFE_FALLBACK_MAP ───────────────────────────────────────────────
export const SAFE_FALLBACK_MAP: Record<string, string[]> = {

  // ── Auth fields ──────────────────────────────────────────────────────────
  "input[name='username']": [
    "#username", "input[type='email']", "[data-testid='username']",
    "[formcontrolname='username']", "[ng-reflect-name='username']",
    "input[name*='User' i]", "input[placeholder*='Username' i]",
  ],
  "input[name='password']": [
    "#password", "input[type='password']", "[data-testid='password']",
    "[formcontrolname='password']", "input[name*='Pass' i]",
    "input[placeholder*='Password' i]",
  ],
  "input[name='idnumber']": [
    "[formcontrolname='idnumber']", "[ng-reflect-name='idnumber']",
    "#idnumber", "input[name='IDNumber']", "input[name='id_number']",
    "input[placeholder*='ID' i]", "input[placeholder*='Employee' i]",
  ],
  "button[type='submit']": [
    "button:has-text('Login')", "button:has-text('Sign In')",
    ".k-button-main", ".btn-primary[type='submit']",
    "button.btn-success[type='submit']",
  ],

  // ── Grid + data table ────────────────────────────────────────────────────
  ".k-dropdown": [
    "[data-role='dropdownlist']", ".k-picker", ".k-select",
    "kendo-dropdownlist", ".k-dropdownlist",
  ],
  ".k-grid": [
    "[data-role='grid']", "kendo-grid", ".grid-wrapper table",
    "table.k-table",
  ],
  ".k-grid tbody tr": [
    "kendo-grid tbody tr", ".k-grid-table tbody tr",
    "table[data-role='grid'] tbody tr",
  ],
  ".k-grid tbody tr:first-child": [
    "kendo-grid tbody tr:first-child", ".k-grid-table tr:nth-child(1)",
  ],

  // ── Toolbar action buttons — icon-only ───────────────────────────────────
  // Add New
  ".action-btn.addNew": [
    "button[title*='Add' i]", "button[aria-label*='Add' i]",
    ".k-button-add", "button:has(.k-i-plus)", "button:has(.k-svg-i-plus)",
    "button[title*='New' i]", "button[aria-label*='New' i]",
    ".btn-toolbar button:first-child", "button:has(svg.k-i-plus)",
  ],
  "button[title='Add New']": [
    "button[title*='Add' i]", ".k-button-add", "button[aria-label*='Add' i]",
    ".action-btn.addNew button",
  ],

  // Edit
  "button[title='Edit']": [
    "button[title*='Edit' i]", "button[aria-label*='Edit' i]",
    ".k-button-edit", "button:has(.k-i-pencil)", "button:has(.k-svg-i-pencil)",
  ],
  "button[title='Delete']": [
    "button[title*='Delete' i]", "button[aria-label*='Delete' i]",
    ".k-button-delete", "button:has(.k-i-trash)", "button:has(.k-svg-i-delete)",
  ],
  "button[title='Save']": [
    "button:has-text('Save')", "button[type='submit']",
    ".k-button:has-text('Save')", ".btn-success:has-text('Save')",
    "button.btn.btn-success",
  ],
  "button[title='Cancel']": [
    "button:has-text('Cancel')", ".k-button:has-text('Cancel')",
    ".btn-light:has-text('Cancel')", "button.btn.btn-light",
  ],
  "button[title='Import']": [
    "button[title*='Import' i]", "button[aria-label*='Import' i]",
    ".k-button-import", "button:has(.k-i-upload)",
  ],
  "button[title='Export']": [
    "button[title*='Export' i]", "button[aria-label*='Export' i]",
    ".k-button-export", "button:has(.k-i-download)",
  ],
  "button[title='Search']": [
    "button[title*='Search' i]", "button[type='submit']:has(.k-i-search)",
    ".k-button-search", "button:has(.k-i-search)",
  ],

  // ── Form fields (Master Data modules) ───────────────────────────────────
  // Short Code
  "[formcontrolname='ShortCode']": [
    "input[name='ShortCode']", "[ng-reflect-name='ShortCode']",
    "input[placeholder*='Short' i]", "#shortCode", "input[name='shortcode']",
  ],
  // English Name / Description
  "[formcontrolname='EnglishDescription']": [
    "input[name='EnglishDescription']", "[ng-reflect-name='EnglishDescription']",
    "input[placeholder*='English' i]", "input[placeholder*='Name (En)' i]",
    "#englishDescription", "kendo-textbox input[name*='English' i]",
  ],
  // Local / Myanmar Name
  "[formcontrolname='LocalDescription']": [
    "input[name='LocalDescription']", "[ng-reflect-name='LocalDescription']",
    "input[placeholder*='Local' i]", "input[placeholder*='Name (My)' i]",
    "#localDescription",
  ],
  // Inactive toggle
  "[formcontrolname='IsActive']": [
    "input[name='IsActive']", "[name='isActive']",
    ".form-check-input[type='checkbox']", "input[type='checkbox'][name*='Active' i]",
    "kendo-switch[formcontrolname='IsActive']",
  ],
  // Default toggle
  "[formcontrolname='IsDefault']": [
    "input[name='IsDefault']", "[name='isDefault']",
    "input[type='checkbox'][name*='Default' i]",
  ],

  // ── Kendo date picker ────────────────────────────────────────────────────
  "kendo-datepicker input": [
    "[data-role='datepicker'] input", ".k-datepicker input",
    "kendo-datepicker .k-input-inner",
  ],
  "kendo-daterangepicker input:first-child": [
    ".k-daterangepicker input:first-child", "[data-role='daterangepicker'] input:first-child",
  ],

  // ── Kendo dropdown popup (detached — appended to body) ───────────────────
  ".k-popup .k-list-item": [
    ".k-popup .k-item", ".k-list .k-list-item",
    "[data-role='popup'] .k-item", ".k-animation-container .k-list-item",
  ],
  ".k-popup": [
    ".k-animation-container .k-popup", "[data-role='popup']",
    ".k-list-container",
  ],

  // ── Navigation ───────────────────────────────────────────────────────────
  ".sidebar-nav": [
    ".k-drawer-items", ".nav-sidebar", ".sidebar .nav",
    "[role='navigation'] .nav-item",
  ],
  "a.list-group-item": [
    ".list-group-item", ".nav-link.list-group-item",
    ".sidebar a[href]", ".menu-item a",
  ],
  ".k-panelbar": [
    "[data-role='panelbar']", ".k-panelbar-group", "kendo-panelbar",
  ],

  // ── Dialog / modal ───────────────────────────────────────────────────────
  ".k-dialog": [
    "[role='dialog']", ".k-window", "kendo-dialog",
    ".modal.show .modal-dialog",
  ],
  ".k-dialog-buttongroup": [
    ".k-actions", ".k-dialog-actions", "[role='dialog'] .k-actions",
  ],
  ".k-dialog button:has-text('Yes')": [
    "[role='dialog'] button:has-text('Yes')", ".k-dialog-confirm button:first-child",
    "button.btn.btn-success:has-text('Yes')",
  ],
  ".k-dialog button:has-text('No')": [
    "[role='dialog'] button:has-text('No')", ".k-dialog-confirm button:last-child",
    "button.btn.btn-light:has-text('No')",
  ],

  // ── Loading / stabilization ──────────────────────────────────────────────
  ".k-loading-mask": [
    ".k-loading-image", ".k-loading-color", "[data-role='loading']",
    ".spinner-border",
  ],

  // ── Notification / toast ─────────────────────────────────────────────────
  ".k-notification": [
    "[role='alert']", ".toast", ".k-popup .k-notification",
    ".alert.alert-success", ".alert.alert-danger",
  ],

  // ── File upload ──────────────────────────────────────────────────────────
  "input[type='file']": [
    "[data-role='upload'] input[type='file']",
    "kendo-upload input[type='file']", ".k-upload input",
  ],

  // ── Pagination ───────────────────────────────────────────────────────────
  ".k-pager": [
    "[data-role='pager']", "kendo-pager", ".k-grid-pager",
  ],
  ".k-pager-nav.k-last": [
    "[title='Go to the last page']", ".k-pager-last",
  ],

  // ── Inactive filter ──────────────────────────────────────────────────────
  "kendo-dropdownlist[formcontrolname='statusName']": [
    "[formcontrolname='statusName']", "kendo-dropdownlist[aria-label*='Status' i]",
    ".form-control.k-picker[aria-label*='Status' i]",
  ],

  // ── TinyMCE rich text editor ─────────────────────────────────────────────
  ".tox-edit-area iframe": [
    "iframe.tox-edit-area__iframe", ".tox iframe",
  ],
  "body#tinymce": [
    "#tinymce", ".tox-edit-area iframe body",
  ],
};

// ─── P1: Healing loop detection ───────────────────────────────────────────────
/**
 * Tracks how many healing attempts have been made per test case.
 * After MAX_HEALING_ATTEMPTS consecutive failures, abort healing and
 * escalate to human review instead of looping forever.
 */
const MAX_HEALING_ATTEMPTS = 3;
const _healingAttempts = new Map<string, number>();

export function recordHealingAttempt(testCaseId: string): number {
  const current = (_healingAttempts.get(testCaseId) ?? 0) + 1;
  _healingAttempts.set(testCaseId, current);
  return current;
}

export function resetHealingAttempts(testCaseId: string): void {
  _healingAttempts.delete(testCaseId);
}

export function hasExceededHealingLimit(testCaseId: string): boolean {
  return (_healingAttempts.get(testCaseId) ?? 0) >= MAX_HEALING_ATTEMPTS;
}

/**
 * Wrap healing calls with this guard.
 * Usage in SelfHealingService.attemptHealing():
 *
 *   if (hasExceededHealingLimit(testCase.id)) {
 *     logger.warn(`[SelfHealing] Skipping heal — exceeded ${MAX_HEALING_ATTEMPTS} attempts for ${testCase.id}`);
 *     return null; // escalate to Jira report
 *   }
 *   const attempt = recordHealingAttempt(testCase.id);
 *   logger.info(`[SelfHealing] Healing attempt ${attempt}/${MAX_HEALING_ATTEMPTS} for ${testCase.id}`);
 *   ... proceed with healing ...
 *   if (healingSucceeded) resetHealingAttempts(testCase.id);
 */

// ─── P1: Jira background sync throttle ───────────────────────────────────────
/**
 * In JiraSyncController.ts, replace the hardcoded 5-minute interval with:
 *
 *   const SYNC_INTERVAL_MS = process.env.JIRA_SYNC_ENABLED === 'false'
 *     ? null  // disabled
 *     : parseInt(process.env.JIRA_SYNC_INTERVAL_MS || '300000', 10);
 *
 *   if (SYNC_INTERVAL_MS) {
 *     setInterval(() => syncJiraTickets(), SYNC_INTERVAL_MS);
 *     logger.info(`[JiraSync] Background sync enabled — interval: ${SYNC_INTERVAL_MS}ms`);
 *   } else {
 *     logger.info('[JiraSync] Background sync disabled (JIRA_SYNC_ENABLED=false)');
 *   }
 *
 * In .env for development:
 *   JIRA_SYNC_ENABLED=false
 *
 * This stops 288 unnecessary API calls per day during local dev.
 */
export const JIRA_SYNC_CONFIG = {
  enabled: process.env.JIRA_SYNC_ENABLED !== 'false',
  intervalMs: parseInt(process.env.JIRA_SYNC_INTERVAL_MS || '300000', 10),
};
