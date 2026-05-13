import { getSkillsPrompt } from '../skills/PlaywrightThinkingSkills';

/**
 * enterprise-execution-rules.ts
 *
 * Structured input context and execution rules injected into the AI prompt
 * for test generation. Enforces ticket-type awareness, tech stack compliance,
 * harvester-driven locators, and network awareness.
 *
 * This block is prepended to every JSON test generation prompt so the AI
 * operates within enterprise constraints before producing any output.
 */

/**
 * Enterprise execution rules injected into the AI prompt.
 * Uses template placeholders that are replaced at runtime by buildPrompt().
 */
export const ENTERPRISE_EXECUTION_RULES = `
=== ENTERPRISE EXECUTION RULES ===

## RULE 1: BLIND OBEDIENCE TO TECH STACK RULES
The application under test uses **Angular 19 + Kendo UI + Zone.js + Bootstrap + TinyMCE**.
You MUST apply these interaction rules exactly. Violating them causes test failures.

### Angular + Zone.js Rules
- **NEVER** use waitUntil: 'networkidle' — Angular's background polling makes it timeout
- **ALWAYS** use waitUntil: 'domcontentloaded' for page navigation
- After navigation, wait for Angular to stabilize before interacting with elements
- Form changes trigger Angular change detection — allow 300-500ms stabilization
- Do NOT interact with elements while loading masks (.k-loading-mask) are visible

### Kendo UI Rules
- Kendo dropdowns open detached popups appended to \`<body>\`, NOT next to the trigger
- To select an option: click the dropdown trigger → wait for .k-popup → click the option in the popup
- Kendo grids use .k-grid class, rows are \`tbody > tr\`, columns match header text
- Kendo dialogs (confirmations, forms) use .k-dialog, .k-window classes
- Grid toolbar buttons are typically icon-only (no text) — use [title="..."] or :has(.k-i-*) selectors
- Kendo date pickers have a calendar icon button that opens a popup calendar

### Bootstrap Rules
- Modals use .modal class with backdrop
- Buttons may use .btn, .btn-primary, .btn-secondary classes
- Form groups use .form-group with label + input pairing
- Alerts/notifications use .alert, .alert-success, .alert-danger classes

### TinyMCE (Rich Text Editor) Rules
- TinyMCE content is inside an iframe (iframe.tox-edit-area__iframe)
- To fill TinyMCE: click the iframe body → fill the content
- Do NOT try to fill the outer wrapper — fill the iframe body#tinymce element

## RULE 2: HARVESTER-DRIVEN LOCATORS ONLY (ZERO FRAGILITY)
When discovery cache or UniversalPageModel data is provided in the prompt:
- **PRIORITY 1:** Use selectors from the discovery cache / UniversalPageModel — these are verified against the live DOM
- If the UniversalPageModel element entry includes \`conf=\` or a confidence score: prefer the highest-confidence match (>= 0.80 when possible)
- If the UniversalPageModel element entry includes \`alts=\` / selector alternatives: treat them as ordered fallbacks (try in order if the first selectorHint is brittle)
- **PRIORITY 2:** Use getByRole('button', { name: '...' }) for buttons WITH visible text
- **PRIORITY 3:** Use getByLabel('...') for form inputs with associated labels
- **PRIORITY 4:** Use getByPlaceholder('...') for inputs with placeholder text
- **PRIORITY 5:** Use getByText('...', { exact: true }) for text content verification

### ICON-ONLY BUTTONS (CRITICAL)
Kendo UI toolbar buttons are often icon-only (e.g., a "+" icon for "Add New").
They have NO text content and often NO aria-label.
- NEVER use getByRole('button', { name: 'Add New' }) — will fail on icon-only buttons
- NEVER use button:has-text("Add New") — will fail on icon-only buttons
- INSTEAD use: button[title="Add New"], [title*="Add" i], or button:has(.k-i-plus)
- The discovery cache provides verified selectors for these — use them when available

### Selector Forbidden List
- NO deep CSS chains like \`div > span > kendo-button > button\`
- NO dynamic Kendo IDs like \`#k-grid-0\`, \`#k-73ac82-*\`
- NO Angular debug attributes like \`[ng-reflect-*]\`, \`[ng-version="*"]\`
- NO XPath expressions

## RULE 3: NETWORK AWARENESS
Some GlobalHR API endpoints are slow (3-10 seconds). If a user action triggers a slow API:
- Add waitForResponse with the API URL pattern BEFORE the next interaction
- Common slow APIs:
  - \`/api/label\` or \`/api/categories\` — Label/Category setup lookups
  - \`/api/employee/search\` — Employee search with large datasets
  - \`/api/report/*\` — Report generation
  - \`/api/userlevel/*\` — User Level / Menu Permission data
  - \`/api/department\`, \`/api/designation\` — Master data lists
- Default API response timeout: 30000ms (extend to 60000ms for report APIs)
- waitForResponse MUST have a non-empty urlPattern — never empty

## RULE 4: TICKET-SPECIFIC STRATEGY

### If Ticket Type is "Bug":
- Write a test that **reproduces the exact bug scenario** described in the ticket
- Use the **exact test data** mentioned in the ticket (field values, user actions)
- Include assertions that verify the bug is **DEAD** after fix:
  - Error message is hidden / not displayed
  - Success message appears with expected text
  - Record is saved correctly in the grid
  - Validation behaves as expected
- Include a **regression test** for the related workflow
- Keep scenarios focused — 1-3 test cases max (reproduction, fix verification, regression)

### If Ticket Type is "Story" / "Task":
- Cover **all Acceptance Criteria** from the ticket description
- Perform a **complete E2E happy path**: Create → Verify in grid → Edit → Verify changes
- Include **validation/negative tests** for required fields and constraints
- Include **data isolation tests** if the feature is user-specific
- Include **dynamic data tests** if the feature reads from system configuration (e.g., Label Setup)
- Typical coverage: 3-5 scenarios (happy path, validation, edge cases, data isolation)

## RULE 5: STEP DESCRIPTION REQUIREMENT
Every step in the JSON spec MUST have a business-readable description:
- GOOD: { "type": "click", "element": "Add New", "description": "Open the Create Department form" }
- BAD: { "type": "click", "element": "button.k-button" }
- The description explains WHAT the user is doing and WHY, not HOW it's done

## RULE 6: ASSERTION RULES
- Every scenario MUST have at least one assertion verifying the outcome
- Grid assertions: use assertText with the grid selector and expected cell content
- URL assertions: use assertUrl with contains: true for partial matches
- Visibility assertions: use assertVisible to confirm dialogs, messages, or elements appear
- NEVER assert on loading masks or transitional elements

## RULE 7: PLAYWRIGHT THINKING SKILLS (12 Proven Patterns)

These patterns were discovered from real test execution on GlobalHR Cloud.
Apply ALL relevant patterns when generating steps. Do NOT invent new patterns.

${getSkillsPrompt()}
`;

/**
 * Build the enterprise execution rules block with runtime context injection.
 *
 * @param options - Runtime context values
 * @returns Formatted rules block with placeholders replaced
 */
export function buildEnterpriseRulesBlock(options: {
    ticketType: string;
    module: string;
    discoveryContext?: string | null;
    slowApis?: string[];
    knownIssues?: string[];
}): string {
    let rules = ENTERPRISE_EXECUTION_RULES;

    // Inject ticket-type-specific guidance
    if (options.ticketType) {
        const typeLower = options.ticketType.toLowerCase();
        if (typeLower.includes('bug')) {
            rules = rules.replace(
                '### If Ticket Type is "Bug":',
                `### If Ticket Type is "Bug": ← THIS IS A BUG TICKET — FOCUS ON REPRODUCTION`
            );
        } else if (typeLower.includes('story') || typeLower.includes('task')) {
            rules = rules.replace(
                `### If Ticket Type is "Story" / "Task":`,
                `### If Ticket Type is "Story" / "Task": ← THIS IS A STORY/TASK TICKET — COVER ALL ACCEPTANCE CRITERIA`
            );
        }
    }

    // Inject module-specific context
    if (options.module) {
        rules += `\n\n## Current Module: ${options.module}\n`;
        rules += `All generated test steps MUST use elements and selectors relevant to this module.\n`;
        rules += `If discovery cache data is provided below, those selectors take absolute priority.\n`;
    }

    // Inject discovery context if available
    if (options.discoveryContext) {
        rules += `\n\n## Live Discovery Cache (VERIFIED SELECTORS — USE THESE)\n`;
        rules += `The following selectors were discovered from the live application. They are verified to work.\n`;
        rules += `PRIORITY: These selectors OVERRIDE any heuristic or guess. Use them exactly as shown.\n\n`;
        rules += options.discoveryContext;
        rules += `\n`;
    }

    // Inject slow API warnings
    if (options.slowApis && options.slowApis.length > 0) {
        rules += `\n\n## Known Slow APIs for This Module\n`;
        rules += `Add waitForResponse steps for these APIs after actions that trigger them:\n\n`;
        for (const api of options.slowApis) {
            rules += `- \`${api}\` — Expect 3-10s response time. Use timeout: 60000 if needed.\n`;
        }
        rules += `\n`;
    }

    // Inject known issues warnings
    if (options.knownIssues && options.knownIssues.length > 0) {
        rules += `\n\n## Known Issues to Avoid\n`;
        for (const issue of options.knownIssues) {
            rules += `- ${issue}\n`;
        }
        rules += `\n`;
    }

    return rules;
}
