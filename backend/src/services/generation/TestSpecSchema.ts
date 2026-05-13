/**
 * TestSpecSchema.ts
 * 
 * Zod schemas for validating AI-generated test specifications.
 * This ensures AI output is structured, type-safe, and compilable.
 */

import { z } from 'zod';

// ============================================================================
// Constants & Mappers for Sanitisation
// ============================================================================

export const VALID_ASSERTION_TYPES = [
  'assertText',
  'assertVisible',
  'assertUrl',
  'assertCount',
  'assertApiResponse',
] as const;

export type AssertionType = typeof VALID_ASSERTION_TYPES[number];

/**
 * Maps every known invalid type the AI produces → nearest valid type.
 */
const ASSERTION_TYPE_MAP: Record<string, AssertionType> = {
  // ── Text assertions ──────────────────────────────────────────────────────────
  assertequals: 'assertText', assertequal: 'assertText',
  assertstrictequal: 'assertText', assertvalue: 'assertText',
  asserttext: 'assertText', checktext: 'assertText', verifytext: 'assertText',
  tohavetext: 'assertText', tocontaintext: 'assertText',
  assertcontains: 'assertText', assertinclude: 'assertText',
  assertincludes: 'assertText', contains: 'assertText',
  // ── Visibility assertions ────────────────────────────────────────────────────
  assertvisible: 'assertVisible', assertexists: 'assertVisible',
  assertpresent: 'assertVisible', assertelement: 'assertVisible',
  checkvisible: 'assertVisible', tobevisible: 'assertVisible',
  // Negative visibility — map to assertVisible with visible:false (handled by sanitiseSpec)
  assertnotvisible: 'assertVisible', asserthidden: 'assertVisible',
  assertnotpresent: 'assertVisible', assertnotexists: 'assertVisible',
  assertdisabled: 'assertVisible', assertnotdisplayed: 'assertVisible',
  // ── Count assertions ─────────────────────────────────────────────────────────
  tohavecount: 'assertCount', assertcount: 'assertCount',
  assertlength: 'assertCount', assertrows: 'assertCount', assertitems: 'assertCount',
  // ── URL assertions ───────────────────────────────────────────────────────────
  asserturl: 'assertUrl', assertlocation: 'assertUrl',
  assertnavigation: 'assertUrl', assertredirect: 'assertUrl', checkurl: 'assertUrl',
  // ── API assertions ───────────────────────────────────────────────────────────
  assertapiresponse: 'assertApiResponse', assertresponse: 'assertApiResponse',
  assertapi: 'assertApiResponse', assertstatus: 'assertApiResponse',
  asserthttp: 'assertApiResponse',
};

export const VALID_STEP_TYPES = [
  'goto', 'fill', 'click', 'waitForSelector', 'waitForResponse',
  'selectOption', 'check', 'uploadFile', 'hover', 'execute',
] as const;

export type StepType = typeof VALID_STEP_TYPES[number];

const STEP_TYPE_MAP: Record<string, StepType> = {
  // ── Navigation ─────────────────────────────────────────────────────────────
  navigate: 'goto', navigation: 'goto', go: 'goto', open: 'goto', visit: 'goto',
  // ── Fill / input ───────────────────────────────────────────────────────────
  input: 'fill', type: 'fill', enter: 'fill', fillfield: 'fill',
  typetext: 'fill', entertext: 'fill', setvalue: 'fill', setfield: 'fill',
  // ── Click ──────────────────────────────────────────────────────────────────
  tap: 'click', press: 'click', clickelement: 'click', clickbutton: 'click',
  clickrowaction: 'click', clickaction: 'click', clickitem: 'click',
  clickmenu: 'click', clicklink: 'click', clicktab: 'click',
  // ── Wait ───────────────────────────────────────────────────────────────────
  // NOTE: normaliseStepType lowercases + strips non-alpha, so camelCase must be added
  // explicitly (e.g. 'waitForSelector' → 'waitforselector' after normalisation).
  waitforselector: 'waitForSelector',   // ← AI generates 'waitForSelector' literally
  wait: 'waitForSelector', waitfor: 'waitForSelector',
  waitforsaveenabled: 'waitForSelector', waittimeout: 'waitForSelector',
  waittillvisible: 'waitForSelector',
  waitforangular: 'waitForSelector', waitforloadingmask: 'waitForSelector',
  waitforspinner: 'waitForSelector', waitfornetworkidle: 'waitForSelector',
  waitforloadingtofinish: 'waitForSelector',
  kendostabilizationdelay: 'waitForSelector',
  waitfortimeout: 'waitForSelector',
  // ── Response / API ─────────────────────────────────────────────────────────
  waitforresponse: 'waitForResponse',   // ← AI generates 'waitForResponse' literally
  waitresponse: 'waitForResponse', waitapi: 'waitForResponse',
  captureapiresponse: 'waitForResponse',
  awaitapiresponse: 'waitForResponse',
  awaitresponse: 'waitForResponse',
  interceptrequest: 'waitForResponse', waitforapi: 'waitForResponse',
  // ── Select / dropdown ──────────────────────────────────────────────────────
  selectoption: 'selectOption',         // ← AI generates 'selectOption' literally
  select: 'selectOption', dropdown: 'selectOption', chooseoption: 'selectOption',
  selectdropdown: 'selectOption', pickoption: 'selectOption',
  // ── Checkbox ───────────────────────────────────────────────────────────────
  checkbox: 'check', toggle: 'check',
  // ── Upload ─────────────────────────────────────────────────────────────────
  uploadfile: 'uploadFile',             // ← AI generates 'uploadFile' literally
  upload: 'uploadFile', attachfile: 'uploadFile',
  // ── Hover ──────────────────────────────────────────────────────────────────
  mouseover: 'hover', mousehover: 'hover',
  // ── Execute ────────────────────────────────────────────────────────────────
  run: 'execute', action: 'execute',
  // ── AI fill aliases ────────────────────────────────────────────────────────
  universalfill: 'fill', smartfill: 'fill', clearandfill: 'fill',
};

export function normaliseAssertionType(raw: string): AssertionType | null {
  if (!raw) return null;
  const clean = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (VALID_ASSERTION_TYPES.includes(clean as AssertionType)) {
    return clean as AssertionType;
  }
  return ASSERTION_TYPE_MAP[clean] ?? null;
}

export function normaliseStepType(raw: string): StepType | null {
  if (!raw) return null;
  const clean = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (VALID_STEP_TYPES.includes(clean as StepType)) {
    return clean as StepType;
  }
  return STEP_TYPE_MAP[clean] ?? null;
}

export function sanitiseSpec(spec: any): { fixed: number; dropped: number } {
  let fixed = 0;
  let dropped = 0;

  if (!spec || !Array.isArray(spec.scenarios)) return { fixed, dropped };

  // ── Top-level required fields ──────────────────────────────────────────────
  if (!spec.ticketId) { spec.ticketId = 'UNKNOWN'; fixed++; }
  if (!spec.feature)  { spec.feature  = spec.module || 'Unknown Feature'; fixed++; }
  if (!spec.module)   { spec.module   = spec.feature || 'Unknown'; fixed++; }

  for (let i = 0; i < spec.scenarios.length; i++) {
    const scenario = spec.scenarios[i];

    // ── Scenario required fields ─────────────────────────────────────────────

    // Auto-generate missing id
    if (!scenario.id || typeof scenario.id !== 'string') {
      scenario.id = `SC-${String(i + 1).padStart(3, '0')}`;
      fixed++;
    }

    // Ensure name exists
    if (!scenario.name || typeof scenario.name !== 'string') {
      scenario.name = scenario.title || scenario.description || `Scenario ${i + 1}`;
      fixed++;
    }

    // Default assertions to empty array when missing
    if (!Array.isArray(scenario.assertions)) {
      scenario.assertions = [];
      fixed++;
    }

    // Default steps to empty array when missing
    if (!Array.isArray(scenario.steps)) {
      scenario.steps = [];
      fixed++;
    }

    // ── Step-level fixes ─────────────────────────────────────────────────────

    /**
     * Step types the AI uses as ACTION steps but are really assertions.
     * We promote these into scenario.assertions rather than dropping them.
     */
    const ASSERT_PSEUDO_TYPES = new Set([
      'assert', 'verify', 'check',
      'assertvisible', 'assertexists', 'assertpresent',
      'assertnotvisible', 'asserthidden', 'assertnotpresent', 'assertdisabled',
      'asserttext', 'assertequals', 'assertvalue', 'assertcontains',
      'assertgridrowtext', 'assertgridrownotpresent',
      'assertnotification', 'asserttoast',
      'asserturl', 'assertlocation',
      'assertcount', 'assertlength',
      'assertapiresponse', 'assertresponse', 'assertstatus',
      'assertenabled', 'assertselected', 'assertchecked',
    ]);

    /**
     * Step types the AI generates but that have no Playwright equivalent.
     * We silently drop these rather than failing validation.
     */
    const DROP_TYPES = new Set([
      'generatedata', 'generateuniquedata', 'createdatatestdata',
      'log', 'console', 'consolelog',
      'comment', 'note', 'info', 'debug',
      'screenshot', 'takescreenshot',  // handled separately in McpTestExecutor
      'softassert',  // not a real action
    ]);

    // Separate AI "assert" pseudo-steps from real action steps and promote them
    const assertSteps: any[] = [];
    const actionSteps: any[] = [];
    for (const step of scenario.steps) {
      // AI uses both "type" and "action" field names — check both
      const rawType = String(step.type || step.action || '').toLowerCase().replace(/[^a-z]/g, '');
      // Normalise so type and action agree
      if (!step.type && step.action) { step.type = step.action; }

      if (ASSERT_PSEUDO_TYPES.has(rawType)) {
        // Promote to assertion
        const selector = step.selector || step.target || step.element || step.field || 'body';
        const expected = step.expected || step.value || step.text || step.message || '';
        if (expected) {
          assertSteps.push({ type: 'assertText', selector, expected, contains: true });
        } else {
          assertSteps.push({ type: 'assertVisible', selector });
        }
        fixed++;
      } else if (DROP_TYPES.has(rawType)) {
        // Drop silently — no Playwright equivalent
        dropped++;
      } else {
        actionSteps.push(step);
      }
    }
    // Merge promoted assertions at the end of existing assertions
    if (assertSteps.length > 0) {
      scenario.assertions = [...scenario.assertions, ...assertSteps];
    }

    // Now sanitise action steps
    const cleanedSteps: any[] = [];
    for (const step of actionSteps) {
      // Support both "type" and "action" field names
      const rawType = String(step.type || step.action || '');
      const mapped = normaliseStepType(rawType);
      if (mapped) {
        const fixedStep = { ...step, type: mapped };

        // ── goto ──────────────────────────────────────────────────────────────
        if (mapped === 'goto' && !fixedStep.url) {
          fixedStep.url = fixedStep.target || fixedStep.path || '/#/app';
          fixed++;
        }

        // ── click — element is required ───────────────────────────────────────
        if (mapped === 'click' && !fixedStep.element) {
          fixedStep.element =
            fixedStep.target   || fixedStep.selector  || fixedStep.name   ||
            fixedStep.button   || fixedStep.label      || fixedStep.text   ||
            fixedStep.locator  || fixedStep.buttonText || 'button';
          fixed++;
        }
        // click also has options.timeout
        if (mapped === 'click' && fixedStep.options?.timeout !== undefined && typeof fixedStep.options.timeout !== 'number') {
          fixedStep.options.timeout = Number(fixedStep.options.timeout);
          if (isNaN(fixedStep.options.timeout)) delete fixedStep.options.timeout;
          fixed++;
        }

        // ── fill — field is required ──────────────────────────────────────────
        if (mapped === 'fill' && !fixedStep.field) {
          fixedStep.field =
            fixedStep.target      || fixedStep.selector   || fixedStep.name      ||
            fixedStep.input       || fixedStep.label       || fixedStep.fieldName ||
            fixedStep.placeholder || fixedStep.fieldLabel  || 'input';
          fixed++;
        }
        // fill also requires value
        if (mapped === 'fill' && fixedStep.value === undefined) {
          fixedStep.value = '';
          fixed++;
        }

        // ── selectOption — field is required ──────────────────────────────────
        if (mapped === 'selectOption' && !fixedStep.field) {
          fixedStep.field =
            fixedStep.target   || fixedStep.selector  || fixedStep.name   ||
            fixedStep.dropdown || fixedStep.label      || 'select';
          fixed++;
        }
        if (mapped === 'selectOption' && !fixedStep.value) {
          fixedStep.value = fixedStep.option || fixedStep.text || '';
          fixed++;
        }

        // ── check — field is required ─────────────────────────────────────────
        if (mapped === 'check' && !fixedStep.field) {
          fixedStep.field =
            fixedStep.target || fixedStep.selector || fixedStep.name || 'checkbox';
          fixed++;
        }

        // ── waitForSelector — selector is required ────────────────────────────
        if (mapped === 'waitForSelector' && !fixedStep.selector) {
          fixedStep.selector =
            fixedStep.target || fixedStep.element || fixedStep.locator || 'body';
          fixed++;
        }
        if (mapped === 'waitForSelector' && fixedStep.timeout !== undefined && typeof fixedStep.timeout !== 'number') {
          fixedStep.timeout = Number(fixedStep.timeout);
          if (isNaN(fixedStep.timeout)) delete fixedStep.timeout;
          fixed++;
        }

        // ── waitForResponse — urlPattern is required ──────────────────────────
        if (mapped === 'waitForResponse' && !fixedStep.urlPattern) {
          fixedStep.urlPattern =
            fixedStep.url || fixedStep.pattern || fixedStep.target || '/api/';
          fixed++;
        }
        if (mapped === 'waitForResponse' && fixedStep.timeout !== undefined && typeof fixedStep.timeout !== 'number') {
          fixedStep.timeout = Number(fixedStep.timeout);
          if (isNaN(fixedStep.timeout)) delete fixedStep.timeout;
          fixed++;
        }

        // ── hover — selector is required ──────────────────────────────────────
        if (mapped === 'hover' && !fixedStep.selector) {
          fixedStep.selector =
            fixedStep.target || fixedStep.element || fixedStep.locator || 'body';
          fixed++;
        }

        // ── uploadFile — field + filePath required ────────────────────────────
        if (mapped === 'uploadFile') {
          if (!fixedStep.field)    { fixedStep.field    = fixedStep.target || fixedStep.selector || 'file-input'; fixed++; }
          if (!fixedStep.filePath) { fixedStep.filePath = fixedStep.file || fixedStep.path || './test-file.txt'; fixed++; }
        }

        // ── execute — helper is required ──────────────────────────────────────
        if (mapped === 'execute' && !fixedStep.helper) {
          fixedStep.helper = fixedStep.function || fixedStep.fn || 'noop';
          fixed++;
        }

        if (mapped !== rawType) fixed++;
        cleanedSteps.push(fixedStep);
      } else {
        // Drop truly unknown step types
        console.warn(`[TestSpec] Unknown step type "${rawType}" — dropped`);
        dropped++;
      }
    }
    scenario.steps = cleanedSteps;

    // ── Assertion sanitisation ────────────────────────────────────────────────
    const cleanedAssertions: any[] = [];
    for (const assertion of scenario.assertions) {
      const rawType = String(assertion.type || '');
      const mapped = normaliseAssertionType(rawType);
      if (mapped) {
        const fixedAssertion = { ...assertion, type: mapped };

        // assertText needs selector + expected (string)
        if (mapped === 'assertText') {
          if (!fixedAssertion.selector)
            fixedAssertion.selector = fixedAssertion.target || fixedAssertion.element || 'body';
          if (!fixedAssertion.expected)
            fixedAssertion.expected = fixedAssertion.value || fixedAssertion.text || '';
          // AI sometimes emits expected: true/false — coerce to string so Zod passes
          if (typeof fixedAssertion.expected !== 'string')
            fixedAssertion.expected = String(fixedAssertion.expected ?? '');

          // coerce contains to boolean
          if (fixedAssertion.contains !== undefined && typeof fixedAssertion.contains !== 'boolean') {
            fixedAssertion.contains = String(fixedAssertion.contains).toLowerCase() === 'true';
            fixed++;
          }
        }

        // assertVisible: AI sometimes adds expected: true/false — convert to `visible` boolean
        if (mapped === 'assertVisible' && 'expected' in fixedAssertion) {
          if (fixedAssertion.visible === undefined)
            fixedAssertion.visible = fixedAssertion.expected !== false && fixedAssertion.expected !== 'false';
          delete fixedAssertion.expected;
        }

        // assertVisible needs selector
        if (mapped === 'assertVisible' && !fixedAssertion.selector) {
          fixedAssertion.selector = fixedAssertion.target || fixedAssertion.element || 'body';
        }

        // assertCount needs selector + expected (number)
        if (mapped === 'assertCount') {
          if (!fixedAssertion.selector)
            fixedAssertion.selector = fixedAssertion.target || fixedAssertion.element || 'body';
          if (typeof fixedAssertion.expected !== 'number')
            fixedAssertion.expected = Number(fixedAssertion.expected ?? fixedAssertion.count ?? 1) || 1;
        }

        // assertUrl needs expected
        if (mapped === 'assertUrl' && !fixedAssertion.expected)
          fixedAssertion.expected = fixedAssertion.url || fixedAssertion.value || '';

        // coerce contains to boolean
        if (mapped === 'assertUrl' && fixedAssertion.contains !== undefined && typeof fixedAssertion.contains !== 'boolean') {
          fixedAssertion.contains = String(fixedAssertion.contains).toLowerCase() === 'true';
          fixed++;
        }

        // assertApiResponse needs urlPattern
        if (mapped === 'assertApiResponse' && !fixedAssertion.urlPattern)
          fixedAssertion.urlPattern = fixedAssertion.url || fixedAssertion.target || '/api/';

        if (mapped !== rawType) fixed++;
        cleanedAssertions.push(fixedAssertion);
      } else {
        console.warn(`[TestSpec] Unknown assertion type "${rawType}" — dropped`);
        dropped++;
      }
    }
    scenario.assertions = cleanedAssertions;
  }

  return { fixed, dropped };
}

// ============================================================================
// Step Schemas
// ============================================================================

/** Navigation step - go to a URL */
const GotoStepSchema = z.object({
  type: z.literal('goto'),
  url: z.string().min(1).describe('RELATIVE URL ONLY (e.g., /#/app.designation)'),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle', 'commit']).optional()
    .describe('When to consider navigation succeeded'),
  /** Business-readable description of navigation */
  description: z.string().optional().describe('Business description (e.g., "Navigate to Designation module")'),
});

/** Fill/input step - enter text into a field */
const FillStepSchema = z.object({
  type: z.literal('fill'),
  /** Business field name (e.g., "username", "category") - will be enriched with selector */
  field: z.string().describe('Business field name'),
  /** The value to enter - can be string, number, or reference to test data */
  value: z.union([z.string(), z.number(), z.boolean()]).describe('The value to enter'),
  /** Optional selector hint if business field is not in repository */
  selectorHint: z.string().default('').describe('Selector hint for the field'),
  /** For Kendo UI dropdowns */
  isKendo: z.boolean().optional(),
  /** Business-readable description */
  description: z.string().optional().describe('Business description (e.g., "Enter designation name")'),
  /** Interaction strategy kind — auto-populated from pageModel when available */
  strategyKind: z.string().optional().describe('Interaction kind from pageModel (e.g., fill, select, edit-rich-text)'),
  /** Framework detected for this element — auto-populated from pageModel */
  framework: z.string().optional().describe('Framework for this element (e.g., kendo-ui, angular, tinymce)'),
  /** Pre-action waits recommended by the interaction strategy */
  preWaits: z.array(z.string()).optional().describe('Wait steps to run before this action'),
  /** Post-action verification from the interaction strategy */
  postVerification: z.array(z.string()).optional().describe('Verification steps to run after this action'),
  /** Confidence score for the selector (0.0 - 1.0) */
  confidence: z.number().optional().describe('Confidence score for the selector'),
  /** Alternative selectors to use if the primary one fails */
  selectorAlternatives: z.array(z.string()).optional().describe('Alternative selectors for self-healing'),
});

/** Click step - click a button or element */
const ClickStepSchema = z.object({
  type: z.literal('click'),
  /** Business element name (e.g., "Save", "Add New") */
  element: z.string().describe('Business element name'),
  /** Optional selector hint */
  selectorHint: z.string().optional(),
  /** Click options */
  options: z.object({
    force: z.boolean().optional(),
    timeout: z.number().optional(),
  }).optional(),
  /** Business-readable description */
  description: z.string().optional().describe('Business description (e.g., "Click Add button")'),
  /** Interaction strategy kind — auto-populated from pageModel when available */
  strategyKind: z.string().optional().describe('Interaction kind from pageModel'),
  /** Framework detected for this element */
  framework: z.string().optional().describe('Framework for this element'),
  /** Pre-action waits recommended by the interaction strategy */
  preWaits: z.array(z.string()).optional().describe('Wait steps to run before this action'),
  /** Post-action verification from the interaction strategy */
  postVerification: z.array(z.string()).optional().describe('Verification steps to run after this action'),
  /** Confidence score for the selector (0.0 - 1.0) */
  confidence: z.number().optional().describe('Confidence score for the selector'),
  /** Alternative selectors to use if the primary one fails */
  selectorAlternatives: z.array(z.string()).optional().describe('Alternative selectors for self-healing'),
});

/** Wait for selector step */
const WaitForSelectorStepSchema = z.object({
  type: z.literal('waitForSelector'),
  selector: z.string().describe('CSS selector to wait for'),
  state: z.enum(['visible', 'hidden', 'attached', 'detached']).optional()
    .describe('The expected state of the element'),
  timeout: z.number().optional(),
  /** Business-readable description */
  description: z.string().optional().describe('Business description (e.g., "Wait for form to load")'),
});

/** Wait for response step */
const WaitForResponseStepSchema = z.object({
  type: z.literal('waitForResponse'),
  urlPattern: z.string().min(1).describe('URL pattern to match — NEVER empty string'),
  status: z.number().optional().describe('Expected HTTP status'),
  timeout: z.number().optional(),
  /** Business-readable description */
  description: z.string().optional().describe('Business description (e.g., "Wait for save API")'),
});

/** Select from dropdown step */
const SelectOptionStepSchema = z.object({
  type: z.literal('selectOption'),
  field: z.string().describe('Business field name'),
  value: z.string().describe('Option value to select'),
  selectorHint: z.string().optional(),
  /** Business-readable description */
  description: z.string().optional().describe('Business description (e.g., "Select department from dropdown")'),
  /** Interaction strategy kind — auto-populated from pageModel */
  strategyKind: z.string().optional().describe('Interaction kind from pageModel'),
  /** Framework detected for this element */
  framework: z.string().optional().describe('Framework for this element'),
  /** Pre-action waits recommended by the interaction strategy */
  preWaits: z.array(z.string()).optional().describe('Wait steps to run before this action'),
  /** Post-action verification from the interaction strategy */
  postVerification: z.array(z.string()).optional().describe('Verification steps to run after this action'),
  /** Confidence score for the selector (0.0 - 1.0) */
  confidence: z.number().optional().describe('Confidence score for the selector'),
  /** Alternative selectors to use if the primary one fails */
  selectorAlternatives: z.array(z.string()).optional().describe('Alternative selectors for self-healing'),
});

/** Check checkbox step */
const CheckStepSchema = z.object({
  type: z.literal('check'),
  field: z.string().describe('Business field name'),
  selectorHint: z.string().optional(),
  /** Business-readable description */
  description: z.string().optional().describe('Business description'),
});

/** Upload file step */
const UploadFileStepSchema = z.object({
  type: z.literal('uploadFile'),
  field: z.string().describe('Business field name for file input'),
  filePath: z.string().describe('Path to file to upload'),
  selectorHint: z.string().optional(),
  /** Business-readable description */
  description: z.string().optional().describe('Business description'),
});

/** Hover step */
const HoverStepSchema = z.object({
  type: z.literal('hover'),
  selector: z.string(),
  /** Business-readable description */
  description: z.string().optional().describe('Business description'),
});

/** Execute custom code step (use sparingly) */
const ExecuteStepSchema = z.object({
  type: z.literal('execute'),
  /** Reference to a predefined helper function */
  helper: z.string().describe('Name of predefined helper function'),
  /** Arguments to pass to the helper */
  args: z.record(z.string(), z.any()).optional(),
  /** Business-readable description */
  description: z.string().optional().describe('Business description'),
});

// ============================================================================
// Assertion Types
// ============================================================================

/** Assert text content */
const AssertTextSchema = z.object({
  type: z.literal('assertText'),
  selector: z.string().describe('CSS selector'),
  expected: z.string().describe('Expected text content'),
  contains: z.boolean().optional().describe('If true, check if text contains expected'),
});

/** Assert element visibility */
const AssertVisibleSchema = z.object({
  type: z.literal('assertVisible'),
  selector: z.string().describe('CSS selector'),
  visible: z.boolean().default(true),
});

/** Assert URL */
const AssertUrlSchema = z.object({
  type: z.literal('assertUrl'),
  expected: z.string().describe('Expected URL pattern (regex string)'),
  contains: z.boolean().optional(),
});

/** Assert element count */
const AssertCountSchema = z.object({
  type: z.literal('assertCount'),
  selector: z.string().describe('CSS selector'),
  expected: z.number().describe('Expected element count'),
});

/** Assert API response */
const AssertApiResponseSchema = z.object({
  type: z.literal('assertApiResponse'),
  urlPattern: z.string().describe('URL pattern to match'),
  status: z.number().optional(),
  bodyContains: z.string().optional(),
});

// ============================================================================
// Combined Step Schema (actions + assertions)
// ============================================================================

const ActionStepSchema = z.discriminatedUnion('type', [
  GotoStepSchema,
  FillStepSchema,
  ClickStepSchema,
  WaitForSelectorStepSchema,
  WaitForResponseStepSchema,
  SelectOptionStepSchema,
  CheckStepSchema,
  UploadFileStepSchema,
  HoverStepSchema,
  ExecuteStepSchema,
]);

const AssertionStepSchema = z.discriminatedUnion('type', [
  AssertTextSchema,
  AssertVisibleSchema,
  AssertUrlSchema,
  AssertCountSchema,
  AssertApiResponseSchema,
]);

const AnyStepSchema = z.union([ActionStepSchema, AssertionStepSchema]);

// ============================================================================
// Scenario & Test Case Schemas
// ============================================================================

/** A single test scenario with steps and assertions */
const TestScenarioSchema = z.object({
  /** Unique scenario identifier */
  id: z.string().describe('Unique scenario identifier (e.g., SC-001)'),
  /** Human-readable scenario name */
  name: z.string().describe('Human-readable scenario name'),
  /** Priority: high, medium, low */
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
  /** Action steps to execute */
  steps: z.array(AnyStepSchema).describe('Steps to execute (actions and assertions)'),
  /** Assertions to verify */
  assertions: z.array(AssertionStepSchema).describe('Legacy assertions array (now merged into steps)'),
  /** Pre-conditions that must be true before this scenario */

  preconditions: z.array(z.string()).optional(),
  /** Tags for categorization */
  tags: z.array(z.string()).optional(),
  /** Whether the test scenario is known to be flaky */
  isFlaky: z.boolean().optional().describe('Whether the test scenario is known to be flaky'),
});

/** Complete test specification for a ticket */
const TestSpecificationSchema = z.object({
  /** Jira ticket ID */
  ticketId: z.string().describe('Jira ticket ID'),
  /** Feature/module name */
  feature: z.string().describe('Feature or module name'),
  /** Module for skill lookup */
  module: z.string().describe('Module name for skill/knowledge lookup'),
  /** Generated test scenarios */
  scenarios: z.array(TestScenarioSchema).describe('Generated test scenarios'),
  /** Environment configuration overrides */
  environment: z.object({
    baseUrl: z.string().optional(),
    stage: z.enum(['testing', 'uat', 'live']).optional(),
  }).optional(),
  /** Metadata about generation */
  metadata: z.object({
    generatedAt: z.string().optional(),
    aiModel: z.string().optional(),
    version: z.string().optional(),
  }).optional(),
});

// ============================================================================
// Export Types
// ============================================================================

export type GotoStep = z.infer<typeof GotoStepSchema>;
export type FillStep = z.infer<typeof FillStepSchema>;
export type ClickStep = z.infer<typeof ClickStepSchema>;
export type WaitForSelectorStep = z.infer<typeof WaitForSelectorStepSchema>;
export type WaitForResponseStep = z.infer<typeof WaitForResponseStepSchema>;
export type SelectOptionStep = z.infer<typeof SelectOptionStepSchema>;
export type CheckStep = z.infer<typeof CheckStepSchema>;
export type UploadFileStep = z.infer<typeof UploadFileStepSchema>;
export type HoverStep = z.infer<typeof HoverStepSchema>;
export type ExecuteStep = z.infer<typeof ExecuteStepSchema>;

export type AssertText = z.infer<typeof AssertTextSchema>;
export type AssertVisible = z.infer<typeof AssertVisibleSchema>;
export type AssertUrl = z.infer<typeof AssertUrlSchema>;
export type AssertCount = z.infer<typeof AssertCountSchema>;
export type AssertApiResponse = z.infer<typeof AssertApiResponseSchema>;

export type ActionStep = z.infer<typeof ActionStepSchema>;
export type AssertionStep = z.infer<typeof AssertionStepSchema>;
export type AnyStep = ActionStep | AssertionStep;

export type TestScenario = z.infer<typeof TestScenarioSchema>;
export type TestSpecification = z.infer<typeof TestSpecificationSchema>;

// ============================================================================
// Export Schemas for Validation
// ============================================================================

export const Schemas = {
  goto: GotoStepSchema,
  fill: FillStepSchema,
  click: ClickStepSchema,
  waitForSelector: WaitForSelectorStepSchema,
  waitForResponse: WaitForResponseStepSchema,
  selectOption: SelectOptionStepSchema,
  check: CheckStepSchema,
  uploadFile: UploadFileStepSchema,
  hover: HoverStepSchema,
  execute: ExecuteStepSchema,
  assertText: AssertTextSchema,
  assertVisible: AssertVisibleSchema,
  assertUrl: AssertUrlSchema,
  assertCount: AssertCountSchema,
  assertApiResponse: AssertApiResponseSchema,
  actionStep: ActionStepSchema,
  assertionStep: AssertionStepSchema,
  testScenario: TestScenarioSchema,
  testSpecification: TestSpecificationSchema,
};

// ============================================================================
// Validation Helper Functions
// ============================================================================

/**
 * Validate and parse a test specification from AI output
 * @param json Raw JSON string from AI
 * @returns Parsed TestSpecification or error details
 */
export function validateTestSpecification(json: string): 
  { success: true; data: TestSpecification } | 
  { success: false; errors: z.ZodError } {
  try {
    const parsed = JSON.parse(json);
    
    // Fix types BEFORE validation
    sanitiseSpec(parsed);

    const result = TestSpecificationSchema.parse(parsed);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, errors: error };
    }
    if (error instanceof SyntaxError) {
      // Create a fake ZodError for JSON parse errors
      const zodError = new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          message: `Invalid JSON: ${error.message}`,
          path: [],
        },
      ]);
      return { success: false, errors: zodError };
    }
    throw error;
  }
}

/**
 * Validate a single scenario
 */
export function validateScenario(json: string): 
  { success: true; data: TestScenario } | 
  { success: false; errors: z.ZodError } {
  try {
    const parsed = JSON.parse(json);
    
    // Fix types BEFORE validation
    // Create a mock spec to use sanitiseSpec
    const mockSpec = { scenarios: [parsed] };
    sanitiseSpec(mockSpec);

    const result = TestScenarioSchema.parse(mockSpec.scenarios[0]);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, errors: error };
    }
    if (error instanceof SyntaxError) {
      const zodError = new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          message: `Invalid JSON: ${error.message}`,
          path: [],
        },
      ]);
      return { success: false, errors: zodError };
    }
    throw error;
  }
}

/**
 * Get human-readable error messages from validation
 */
export function getValidationErrors(error: z.ZodError): string[] {
  return (error as any).issues.map((err: any) => {
    const path = err.path.length > 0 ? err.path.join('.') : 'root';
    return `${path}: ${err.message}`;
  });
}
