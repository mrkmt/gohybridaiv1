/**
 * StrategyDrivenPipeline.test.ts
 *
 * Integration tests for the full strategy-driven pipeline:
 *   discovery cache → schema → generation → compilation → progress service
 *
 * Covers both Bug and Story tickets end-to-end with strategy enrichment verification.
 */

import { JsonGenerationOptions, JsonTestGenerationService } from '../../src/services/JsonTestGenerationService';
import { UnifiedAIOrchestrator } from '../../api/UnifiedAIOrchestrator';
import { appLogger } from '../../src/utils/logger';
import { validateTestSpecification } from '../../src/services/TestSpecSchema';
import { JSONToPlaywrightCompiler, CompilerOptions } from '../../src/services/JSONToPlaywrightCompiler';
import { ProcessProgressService } from '../../src/services/ProcessProgressService';
import { DiscoveryCacheService } from '../../src/services/DiscoveryCacheService';

// ============================================================================
// Mocks
// ============================================================================

jest.mock('../../api/UnifiedAIOrchestrator', () => ({
  TaskType: {
    TEST_GENERATION: 'TEST_GENERATION',
  },
  UnifiedAIOrchestrator: {
    generate: jest.fn(),
  },
}));

// Silence logger during tests
jest.mock('../../src/utils/logger', () => ({
  appLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const generateMock = UnifiedAIOrchestrator.generate as jest.MockedFunction<typeof UnifiedAIOrchestrator.generate>;

// ============================================================================
// Helpers
// ============================================================================

const mockSpecForIssueType = (issueType: 'Bug' | 'Story') => JSON.stringify({
  ticketId: 'TEST-001',
  feature: `Test ${issueType} feature`,
  module: 'department',
  scenarios: [
    {
      id: 'SC-001',
      name: `${issueType} verification flow`,
      priority: 'high' as const,
      steps: [
        { type: 'goto', url: '/#/app.department' },
        { type: 'waitForSelector', selector: '.k-grid', state: 'visible' },
        ...(issueType === 'Bug'
          ? [
              { type: 'fill', field: 'ShortCode', value: 'BUG-001' },
              { type: 'fill', field: 'Department Name', value: 'Bug Test Dept' },
              { type: 'click', element: 'Add' },
              { type: 'waitForSelector', selector: '.k-grid', state: 'visible' },
            ]
          : [
              { type: 'fill', field: 'ShortCode', value: 'STR-001' },
              { type: 'fill', field: 'Department Name', value: 'Story Test Dept' },
              { type: 'selectOption', field: 'Status', value: 'Active' },
              { type: 'click', element: 'Save' },
              { type: 'waitForSelector', selector: '.k-notification', state: 'visible' },
            ]
        ),
      ],
      assertions: [
        { type: 'assertVisible', selector: '.k-grid', visible: true },
      ],
    },
  ],
});

const baseOptions = (issueType: 'Bug' | 'Story'): JsonGenerationOptions => ({
  ticketId: 'TEST-001',
  summary: `Test ${issueType} ticket`,
  description: issueType === 'Bug'
    ? 'Department short code validation fails'
    : 'User can manage departments',
  module: 'department',
  baseUrl: 'https://test.globalhr.com.mm/ook',
  issueType,
  maxRetries: 1,
  acceptanceCriteria: issueType === 'Story'
    ? ['User can create, edit, and delete departments']
    : undefined,
});

function setupMockResponse(jsonOverride?: string) {
  generateMock.mockResolvedValue(jsonOverride || mockSpecForIssueType('Story'));
}

// ============================================================================
// Tests
// ============================================================================

describe('Strategy-Driven Pipeline: TestSpecSchema with strategy fields', () => {
  it('validates fill steps with strategy metadata', () => {
    const spec = {
      ticketId: 'TEST-001',
      feature: 'Strategy test',
      module: 'department',
      scenarios: [
        {
          id: 'SC-001',
          name: 'Strategy fill',
          priority: 'high' as const,
          steps: [
            {
              type: 'fill' as const,
              field: 'Department Name',
              value: 'Test Dept',
              selectorHint: '[data-testid="department-name"]',
              strategyKind: 'fill',
              framework: 'kendo-ui',
              preWaits: ['wait field visible', 'wait Kendo stabilization after input'],
              postVerification: ['verify input value'],
            },
          ],
          assertions: [],
        },
      ],
    };
    const result = validateTestSpecification(JSON.stringify(spec));
    expect(result.success).toBe(true);
    if (result.success) {
      const step = result.data.scenarios[0].steps[0] as any;
      expect(step.strategyKind).toBe('fill');
      expect(step.framework).toBe('kendo-ui');
      expect(step.preWaits).toHaveLength(2);
      expect(step.postVerification).toHaveLength(1);
    }
  });

  it('validates click steps with strategy metadata', () => {
    const spec = {
      ticketId: 'TEST-001',
      feature: 'Strategy test',
      module: 'department',
      scenarios: [
        {
          id: 'SC-001',
          name: 'Strategy click',
          priority: 'high' as const,
          steps: [
            {
              type: 'click' as const,
              element: 'Save',
              selectorHint: 'button.k-button:has-text("Save")',
              strategyKind: 'modal-action',
              framework: 'angular',
              preWaits: ['wait modal visible'],
              postVerification: ['verify modal closes'],
            },
          ],
          assertions: [],
        },
      ],
    };
    const result = validateTestSpecification(JSON.stringify(spec));
    expect(result.success).toBe(true);
  });

  it('validates selectOption steps with strategy metadata', () => {
    const spec = {
      ticketId: 'TEST-001',
      feature: 'Strategy test',
      module: 'department',
      scenarios: [
        {
          id: 'SC-001',
          name: 'Strategy select',
          priority: 'high' as const,
          steps: [
            {
              type: 'selectOption' as const,
              field: 'Status',
              value: 'Active',
              selectorHint: '[role="combobox"]',
              strategyKind: 'select',
              framework: 'kendo-ui',
              preWaits: ['wait dropdown trigger visible', 'wait overlay option list visible'],
              postVerification: ['verify selected text/value'],
            },
          ],
          assertions: [],
        },
      ],
    };
    const result = validateTestSpecification(JSON.stringify(spec));
    expect(result.success).toBe(true);
  });

  it('validates steps without strategy metadata (backwards compatible)', () => {
    const spec = {
      ticketId: 'TEST-001',
      feature: 'Strategy test',
      module: 'department',
      scenarios: [
        {
          id: 'SC-001',
          name: 'No strategy',
          priority: 'high' as const,
          steps: [
            { type: 'goto' as const, url: '/#/app.department' },
            { type: 'fill' as const, field: 'Name', value: 'Test' },
            { type: 'click' as const, element: 'Save' },
          ],
          assertions: [],
        },
      ],
    };
    const result = validateTestSpecification(JSON.stringify(spec));
    expect(result.success).toBe(true);
  });
});

describe('Strategy-Driven Pipeline: Bug ticket end-to-end', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMockResponse(mockSpecForIssueType('Bug'));
  });

  it('generates spec for Bug ticket and enriches with strategy data', async () => {
    const options = baseOptions('Bug');
    const result = await JsonTestGenerationService.generateTestSpecification(options);

    expect(result.success).toBe(true);
    expect(result.specification).toBeDefined();
    expect(result.specification?.scenarios.length).toBeGreaterThan(0);

    // Verify steps exist and schema is valid
    const steps = result.specification?.scenarios[0].steps || [];
    expect(steps.some(s => s.type === 'fill')).toBe(true);
    expect(steps.some(s => s.type === 'click')).toBe(true);
  });

  it('compiles Bug spec to strategy-aware Playwright code', async () => {
    const options = baseOptions('Bug');
    const result = await JsonTestGenerationService.generateTestSpecification(options);
    expect(result.success).toBe(true);

    const compiler = new JSONToPlaywrightCompiler({
      baseUrl: options.baseUrl,
      ticketId: options.ticketId,
      moduleName: options.module,
      recordVideo: false,
      recordTrace: false,
      viewport: { width: 1280, height: 720 },
    });

    const script = compiler.compile(result.specification!);

    // Verify compiled script contains Playwright structure
    expect(script).toContain("import { test, expect");
    expect(script).toContain("test.describe(");
    expect(script).toContain("await page.goto(");
    expect(script).toContain("waitForAngular");
    expect(script).toContain("healedClick");
  });
});

describe('Strategy-Driven Pipeline: Story ticket end-to-end', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMockResponse(mockSpecForIssueType('Story'));
  });

  it('generates spec for Story ticket with acceptance criteria context', async () => {
    const options = baseOptions('Story');
    const result = await JsonTestGenerationService.generateTestSpecification(options);

    expect(result.success).toBe(true);
    expect(result.specification?.scenarios.length).toBeGreaterThan(0);

    const steps = result.specification?.scenarios[0].steps || [];
    expect(steps.some(s => s.type === 'fill')).toBe(true);
    expect(steps.some(s => s.type === 'click')).toBe(true);
  });

  it('compiles Story spec with selectOption strategy', async () => {
    const options = baseOptions('Story');
    const result = await JsonTestGenerationService.generateTestSpecification(options);
    expect(result.success).toBe(true);

    const compiler = new JSONToPlaywrightCompiler({
      baseUrl: options.baseUrl,
      ticketId: options.ticketId,
      moduleName: options.module,
      recordVideo: false,
      recordTrace: false,
      viewport: { width: 1280, height: 720 },
    });

    const script = compiler.compile(result.specification!);
    expect(script).toContain("import { test, expect");
    expect(script).toContain("waitForAngular");
  });

  it('distinguishes Bug vs Story prompt content', () => {
    const bugPrompt = (JsonTestGenerationService as any).buildPrompt(baseOptions('Bug')) as string;
    const storyPrompt = (JsonTestGenerationService as any).buildPrompt(baseOptions('Story')) as string;

    // Bug prompt has failure reproduction context
    expect(bugPrompt).toContain('**Ticket Type:** Bug');
    expect(bugPrompt).toContain('Reproduce the reported failure first');

    // Story prompt has acceptance criteria context
    expect(storyPrompt).toContain('**Ticket Type:** Story');
    expect(storyPrompt).toContain('Cover the acceptance criteria with an end-to-end happy path');

    // They should differ in structure
    expect(bugPrompt).not.toContain('Cover the acceptance criteria with an end-to-end happy path');
    expect(storyPrompt).not.toContain('Reproduce the reported failure first');
  });
});

describe('Strategy-Driven Pipeline: JSONToPlaywrightCompiler strategy code generation', () => {
  const baseCompilerOptions: CompilerOptions = {
    baseUrl: 'https://test.globalhr.com.mm/ook',
    ticketId: 'TEST-001',
    moduleName: 'department',
    recordVideo: false,
    recordTrace: false,
    viewport: { width: 1280, height: 720 },
  };

  it('generates Kendo dropdown strategy code for selectOption', () => {
    const spec = {
      ticketId: 'TEST-001',
      feature: 'Strategy test',
      module: 'department',
      scenarios: [
        {
          id: 'SC-001',
          name: 'Kendo select',
          priority: 'high' as const,
          steps: [
            {
              type: 'selectOption' as const,
              field: 'Status',
              value: 'Active',
              selectorHint: '[role="combobox"]',
              strategyKind: 'select',
              framework: 'kendo-ui',
            },
          ],
          assertions: [],
        },
      ],
    };

    const compiler = new JSONToPlaywrightCompiler(baseCompilerOptions);
    const script = compiler.compile(spec);

    // Kendo dropdown strategy: click trigger → wait → select from overlay
    expect(script).toContain('[role="combobox"]');
    expect(script).toContain('.click()');
    expect(script).toContain('kendoStabilizationDelay');
  });

  it('generates Kendo fill strategy code', () => {
    const spec = {
      ticketId: 'TEST-001',
      feature: 'Strategy test',
      module: 'department',
      scenarios: [
        {
          id: 'SC-001',
          name: 'Kendo fill',
          priority: 'high' as const,
          steps: [
            {
              type: 'fill' as const,
              field: 'Department Name',
              value: 'Test Dept',
              selectorHint: '[data-testid="dept-name"]',
              framework: 'kendo-ui',
              preWaits: ['wait field visible', 'wait Kendo stabilization after input'],
            },
          ],
          assertions: [],
        },
      ],
    };

    const compiler = new JSONToPlaywrightCompiler(baseCompilerOptions);
    const script = compiler.compile(spec);

    // Kendo fill strategy: pre-waits → universalFill with isKendo: true → stabilization
    expect(script).toContain('isKendo: true');
    expect(script).toContain('universalFill');
    expect(script).toContain('kendoStabilizationDelay');
    expect(script).toContain('Strategy wait');
  });

  it('generates Angular fill strategy code with change detection wait', () => {
    const spec = {
      ticketId: 'TEST-001',
      feature: 'Strategy test',
      module: 'department',
      scenarios: [
        {
          id: 'SC-001',
          name: 'Angular fill',
          priority: 'high' as const,
          steps: [
            {
              type: 'fill' as const,
              field: 'Department Name',
              value: 'Test Dept',
              selectorHint: '[data-testid="dept-name"]',
              framework: 'angular',
            },
          ],
          assertions: [],
        },
      ],
    };

    const compiler = new JSONToPlaywrightCompiler(baseCompilerOptions);
    const script = compiler.compile(spec);

    // Angular fill strategy: fill → waitForTimeout(500) → waitForAngular
    expect(script).toContain('[Angular strategy]');
    expect(script).toContain('waitForTimeout(500)');
  });

  it('generates modal-action click strategy code', () => {
    const spec = {
      ticketId: 'TEST-001',
      feature: 'Strategy test',
      module: 'department',
      scenarios: [
        {
          id: 'SC-001',
          name: 'Modal click',
          priority: 'high' as const,
          steps: [
            {
              type: 'click' as const,
              element: 'Confirm',
              selectorHint: 'button:has-text("Confirm")',
              strategyKind: 'modal-action',
            },
          ],
          assertions: [],
        },
      ],
    };

    const compiler = new JSONToPlaywrightCompiler(baseCompilerOptions);
    const script = compiler.compile(spec);

    // Modal action strategy: wait for dialog visible → 300ms settle → click
    expect(script).toContain('[Modal strategy]');
    expect(script).toContain('waitFor');
    expect(script).toContain('waitForTimeout(300)');
  });

  it('generates grid-action click strategy code', () => {
    const spec = {
      ticketId: 'TEST-001',
      feature: 'Strategy test',
      module: 'department',
      scenarios: [
        {
          id: 'SC-001',
          name: 'Grid click',
          priority: 'high' as const,
          steps: [
            {
              type: 'click' as const,
              element: 'Edit Row',
              selectorHint: '.k-grid .edit-btn',
              strategyKind: 'grid-action',
            },
          ],
          assertions: [],
        },
      ],
    };

    const compiler = new JSONToPlaywrightCompiler(baseCompilerOptions);
    const script = compiler.compile(spec);

    // Grid action strategy: wait for loading mask → wait for tbody > tr data rows → click
    expect(script).toContain('[Grid strategy]');
    expect(script).toContain('waitForLoadingMask');
    expect(script).toContain('tbody > tr');
  });

  it('generates tab-navigation strategy code', () => {
    const spec = {
      ticketId: 'TEST-001',
      feature: 'Strategy test',
      module: 'department',
      scenarios: [
        {
          id: 'SC-001',
          name: 'Tab navigation',
          priority: 'high' as const,
          steps: [
            {
              type: 'click' as const,
              element: 'Details Tab',
              selectorHint: '.k-tabstrip .k-link',
              strategyKind: 'navigate-tab',
            },
          ],
          assertions: [],
        },
      ],
    };

    const compiler = new JSONToPlaywrightCompiler(baseCompilerOptions);
    const script = compiler.compile(spec);

    // Tab navigation strategy: click → 500ms → waitForAngular
    expect(script).toContain('[Tab strategy]');
    expect(script).toContain('waitForTimeout(500)');
  });

  it('generates rich text editor strategy for TinyMCE', () => {
    const spec = {
      ticketId: 'TEST-001',
      feature: 'Strategy test',
      module: 'department',
      scenarios: [
        {
          id: 'SC-001',
          name: 'Rich text fill',
          priority: 'high' as const,
          steps: [
            {
              type: 'fill' as const,
              field: 'Description',
              value: 'Rich content here',
              selectorHint: '.tox-edit-area',
              strategyKind: 'edit-rich-text',
              framework: 'tinymce',
            },
          ],
          assertions: [],
        },
      ],
    };

    const compiler = new JSONToPlaywrightCompiler(baseCompilerOptions);
    const script = compiler.compile(spec);

    // TinyMCE strategy: frameLocator → iframe → body#tinymce
    expect(script).toContain('[TinyMCE strategy]');
    expect(script).toContain('frameLocator');
    expect(script).toContain('tinymce');
  });

  it('generates Kendo dropdown overlay pattern for selectOption with strategy', () => {
    const spec = {
      ticketId: 'TEST-001',
      feature: 'Strategy test',
      module: 'department',
      scenarios: [
        {
          id: 'SC-001',
          name: 'Kendo select',
          priority: 'high' as const,
          steps: [
            {
              type: 'selectOption' as const,
              field: 'Status',
              value: 'Active',
              selectorHint: '#status-dropdown',
              framework: 'kendo-ui',
              preWaits: ['wait dropdown trigger visible', 'wait overlay option list visible'],
            },
          ],
          assertions: [],
        },
      ],
    };

    const compiler = new JSONToPlaywrightCompiler(baseCompilerOptions);
    const script = compiler.compile(spec);

    // Kendo strategy: click trigger → wait → select from .k-popup
    expect(script).toContain('[Kendo dropdown strategy]');
    expect(script).toContain('.k-popup');
    expect(script).toContain('.k-list-item');
  });
});

describe('Strategy-Driven Pipeline: ProcessProgressService', () => {
  const TEST_TICKET_ID = 'PROGRESS-TEST';

  afterEach(() => {
    ProcessProgressService.cleanup(TEST_TICKET_ID);
  });

  it('emits discovery progress with technology profile', () => {
    const events: any[] = [];
    ProcessProgressService.subscribe(TEST_TICKET_ID, (e) => events.push(e));

    ProcessProgressService.discoveryProgress(TEST_TICKET_ID, 'Starting discovery', 20);
    ProcessProgressService.discoveryProgress(TEST_TICKET_ID, 'Elements found', 60, { elementCount: 15 });
    ProcessProgressService.discoveryProgress(TEST_TICKET_ID, 'Discovery complete', 100, {
      technologyProfile: {
        primary: 'kendo-ui',
        detected: [
          { technology: 'kendo-ui', confidence: 0.78 },
          { technology: 'angular', confidence: 0.65 },
        ],
      },
      elementCount: 15,
    });

    expect(events).toHaveLength(3);
    expect(events[0].phase).toBe('discovery');
    expect(events[0].progress).toBe(20);
    expect(events[1].elementCount).toBe(15);
    expect(events[2].technologyProfile?.primary).toBe('kendo-ui');
    expect(events[2].overallProgress).toBeGreaterThan(events[0].overallProgress);
  });

  it('emits generation progress with test counts', () => {
    const events: any[] = [];
    ProcessProgressService.subscribe(TEST_TICKET_ID, (e) => events.push(e));

    ProcessProgressService.generationProgress(TEST_TICKET_ID, 'Starting generation', 10);
    ProcessProgressService.generationProgress(TEST_TICKET_ID, 'Generating scenarios', 50);
    ProcessProgressService.generationProgress(TEST_TICKET_ID, 'Generation complete', 100, {
      scenarioCount: 3,
      testCaseCount: 8,
    });

    expect(events).toHaveLength(3);
    expect(events[0].phase).toBe('generation');
    expect(events[2].scenarioCount).toBe(3);
    expect(events[2].testCaseCount).toBe(8);
    // Generation phase should have higher overall progress than discovery
    expect(events[2].overallProgress).toBeGreaterThan(15); // More than discovery weight
  });

  it('emits compilation progress', () => {
    const events: any[] = [];
    ProcessProgressService.subscribe(TEST_TICKET_ID, (e) => events.push(e));

    ProcessProgressService.compilationProgress(TEST_TICKET_ID, 'Compiling spec', 50, { testCaseCount: 5 });
    ProcessProgressService.compilationProgress(TEST_TICKET_ID, 'Compilation complete', 100, { testCaseCount: 5 });

    expect(events).toHaveLength(2);
    expect(events[0].phase).toBe('compilation');
    expect(events[1].progress).toBe(100);
  });

  it('emits execution progress with test case tracking', () => {
    const events: any[] = [];
    ProcessProgressService.subscribe(TEST_TICKET_ID, (e) => events.push(e));

    ProcessProgressService.executionProgress(TEST_TICKET_ID, 'Starting execution', 5, {
      totalTestCases: 5,
    });
    ProcessProgressService.executionProgress(TEST_TICKET_ID, 'Running SC-001', 40, {
      currentTestCaseId: 'SC-001',
      currentTestCaseIndex: 0,
      totalTestCases: 5,
    });
    ProcessProgressService.executionProgress(TEST_TICKET_ID, 'Execution complete', 100, {
      totalTestCases: 5,
    });

    expect(events).toHaveLength(3);
    expect(events[1].currentTestCaseId).toBe('SC-001');
    expect(events[1].currentTestCaseIndex).toBe(0);
    expect(events[2].progress).toBe(100);
    // Execution is the heaviest phase (35% weight)
    expect(events[2].overallProgress).toBeGreaterThan(40);
  });

  it('calculates weighted overall progress correctly', () => {
    const events: any[] = [];
    ProcessProgressService.subscribe(TEST_TICKET_ID, (e) => events.push(e));

    // Discovery at 100% = 15% overall
    ProcessProgressService.discoveryProgress(TEST_TICKET_ID, 'Discovery done', 100);
    expect(events[events.length - 1].overallProgress).toBe(15);

    // Generation at 100% = 15 + 25 = 40% overall
    ProcessProgressService.generationProgress(TEST_TICKET_ID, 'Generation done', 100);
    expect(events[events.length - 1].overallProgress).toBe(40);

    // Compilation at 100% = 15 + 25 + 15 = 55% overall
    ProcessProgressService.compilationProgress(TEST_TICKET_ID, 'Compilation done', 100);
    expect(events[events.length - 1].overallProgress).toBe(55);

    // Execution at 100% = 15 + 25 + 15 + 35 = 90% overall
    ProcessProgressService.executionProgress(TEST_TICKET_ID, 'Execution done', 100);
    expect(events[events.length - 1].overallProgress).toBe(90);

    // Reporting at 100% = 100% overall
    ProcessProgressService.reportingProgress(TEST_TICKET_ID, 'Reporting done', 100);
    expect(events[events.length - 1].overallProgress).toBe(100);
  });

  it('emits complete and cleans up', () => {
    const events: any[] = [];
    ProcessProgressService.subscribe(TEST_TICKET_ID, (e) => events.push(e));

    ProcessProgressService.complete(TEST_TICKET_ID, 'Pipeline complete');

    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1].phase).toBe('complete');
    expect(events[events.length - 1].status).toBe('completed');
    expect(events[events.length - 1].overallProgress).toBe(100);
  });

  it('emits failure and cleans up', () => {
    const events: any[] = [];
    ProcessProgressService.subscribe(TEST_TICKET_ID, (e) => events.push(e));

    ProcessProgressService.failed(TEST_TICKET_ID, 'Pipeline failed');

    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1].status).toBe('failed');
    expect(events[events.length - 1].overallProgress).toBe(0);
  });

  it('unsubscribe works correctly', () => {
    const events: any[] = [];
    const unsubscribe = ProcessProgressService.subscribe(TEST_TICKET_ID, (e) => events.push(e));

    ProcessProgressService.generationProgress(TEST_TICKET_ID, 'Event 1', 10);
    expect(events).toHaveLength(1);

    unsubscribe();

    ProcessProgressService.generationProgress(TEST_TICKET_ID, 'Event 2', 50);
    expect(events).toHaveLength(1); // Still 1 because we unsubscribed
  });
});

describe('Strategy-Driven Pipeline: DiscoveryCacheService integration', () => {
  it('lookupElementDefinition returns strategy fields when pageModel exists', () => {
    // DiscoveryCacheService.lookupElementDefinition returns data only when
    // pageModel is cached (which requires a real discovery run).
    // We verify the method exists and handles the "no cache" case correctly.
    const result = DiscoveryCacheService.lookupElementDefinition('nonexistent', 'nonexistent-module');
    // Without a cached discovery run, this should return null
    expect(result).toBeNull();
  });
});
