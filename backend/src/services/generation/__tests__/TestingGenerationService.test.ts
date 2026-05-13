/**
 * TestingGenerationService.test.ts
 *
 * Tests for mapSpecToTestCases() — fixed to return { id, name } instead of
 * { caseId, title } so the frontend TestCasesCard renders non-blank rows.
 *
 * Also tests the scenario parsing + heuristic fallback.
 *
 * All external dependencies (AI, DiscoveryCache, JsonTestGenerationService) are mocked.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../JsonTestGenerationService', () => ({
  JsonTestGenerationService: {
    generateAndCompile: jest.fn(),
  },
}));

jest.mock('../../discovery/DiscoveryCacheService', () => ({
  DiscoveryCacheService: {
    get: jest.fn(() => null),
  },
}));

jest.mock('../../shared/AiControllerService', () => ({
  AiControllerService: {
    generate: jest.fn(),
  },
}));

jest.mock('../../../utils/logger', () => ({
  appLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { TestingGenerationService } from '../TestingGenerationService';
import { JsonTestGenerationService } from '../JsonTestGenerationService';
import { AiControllerService } from '../../shared/AiControllerService';
import type { TestSession } from '../../session/TestSessionService';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<TestSession> = {}): TestSession {
  return {
    ticketId: 'ATT-33',
    userId: 'user-1',
    phase: 'discovery',
    scenarios: [],
    testCases: [],
    results: [],
    compiledScripts: {},
    approvedTestCases: false,
    iterationCount: 0,
    ticket: {
      id: 'ATT-33',
      summary: 'Leave Policy not found error',
      module: 'Leave Policy',
      type: 'Bug',
      description: 'Selecting Leave Policy shows "Leave Policy not found." error.',
      status: 'In Testing',
      priority: 'Medium',
    } as any,
    ...overrides,
  } as TestSession;
}

function makeSpec(scenarioOverrides: any[] = []) {
  return {
    ticketId: 'ATT-33',
    feature: 'Leave Policy',
    module: 'Leave Policy',
    scenarios: scenarioOverrides.length > 0 ? scenarioOverrides : [
      {
        id: 'SC-001',
        name: 'Reproduce Leave Policy not found error',
        priority: 'high',
        preconditions: ['User is logged in'],
        steps: [
          { type: 'goto', url: '#/app.leavepolicy' },
          { type: 'click', element: 'Add New' },
        ],
        assertions: [
          { type: 'assertText', selector: '.error-message', expected: 'Leave Policy not found.' },
        ],
      },
      {
        id: 'SC-002',
        name: 'Successfully select an existing Leave Policy',
        priority: 'medium',
        preconditions: [],
        steps: [
          { type: 'click', element: 'Test_KMT policy' },
        ],
        assertions: [],
      },
    ],
  };
}

// ── Tests: mapSpecToTestCases field names ─────────────────────────────────────

describe('TestingGenerationService — mapSpecToTestCases field names', () => {
  let service: TestingGenerationService;

  beforeEach(() => {
    service = new TestingGenerationService();
    (JsonTestGenerationService.generateAndCompile as jest.Mock).mockResolvedValue({
      success: true,
      specification: makeSpec(),
      compiledScripts: {},
      errors: [],
    });
  });

  it('returns id field (not undefined) — fixes blank test case card', async () => {
    const result = await service.generateTestCases(makeSession());

    expect(result.testCases.length).toBeGreaterThan(0);
    result.testCases.forEach(tc => {
      expect((tc as any).id).toBeDefined();
      expect(typeof (tc as any).id).toBe('string');
      expect((tc as any).id).not.toBe('');
    });
  });

  it('returns name field (not undefined) — fixes blank test case name in UI', async () => {
    const result = await service.generateTestCases(makeSession());

    result.testCases.forEach(tc => {
      expect((tc as any).name).toBeDefined();
      expect(typeof (tc as any).name).toBe('string');
      expect((tc as any).name).not.toBe('');
    });
  });

  it('id format is ticketId-scenarioId', async () => {
    const result = await service.generateTestCases(makeSession());

    expect((result.testCases[0] as any).id).toBe('ATT-33-SC-001');
    expect((result.testCases[1] as any).id).toBe('ATT-33-SC-002');
  });

  it('name matches scenario.name from spec', async () => {
    const result = await service.generateTestCases(makeSession());

    expect((result.testCases[0] as any).name).toBe('Reproduce Leave Policy not found error');
    expect((result.testCases[1] as any).name).toBe('Successfully select an existing Leave Policy');
  });

  it('also keeps caseId for backward compatibility with legacy services', async () => {
    const result = await service.generateTestCases(makeSession());

    result.testCases.forEach(tc => {
      expect((tc as any).caseId).toBeDefined();
      expect((tc as any).caseId).toBe((tc as any).id);
    });
  });

  it('also keeps title for backward compatibility with legacy services', async () => {
    const result = await service.generateTestCases(makeSession());

    result.testCases.forEach(tc => {
      expect((tc as any).title).toBeDefined();
      expect((tc as any).title).toBe((tc as any).name);
    });
  });

  it('includes status: PENDING on each test case', async () => {
    const result = await service.generateTestCases(makeSession());

    result.testCases.forEach(tc => {
      expect((tc as any).status).toBe('PENDING');
    });
  });

  it('includes approved: false on each test case', async () => {
    const result = await service.generateTestCases(makeSession());

    result.testCases.forEach(tc => {
      expect((tc as any).approved).toBe(false);
    });
  });

  it('maps steps correctly from spec', async () => {
    const result = await service.generateTestCases(makeSession());

    const firstCase = result.testCases[0] as any;
    expect(Array.isArray(firstCase.steps)).toBe(true);
    expect(firstCase.steps.length).toBeGreaterThan(0);
    // First step is a goto — describeStep maps it to "Navigate to ..."
    expect(firstCase.steps[0].action).toMatch(/Navigate to/i);
  });

  it('appends assertion steps after action steps', async () => {
    const result = await service.generateTestCases(makeSession());

    const firstCase = result.testCases[0] as any;
    const lastStep = firstCase.steps[firstCase.steps.length - 1];
    // SC-001 has 1 assertion (assertText) → becomes an Assert step
    expect(lastStep.action).toMatch(/Assert/i);
  });
});

// ── Tests: priority mapping ───────────────────────────────────────────────────

describe('TestingGenerationService — priority mapping', () => {
  let service: TestingGenerationService;

  beforeEach(() => {
    service = new TestingGenerationService();
  });

  const cases = [
    ['high', 'High'],
    ['low', 'Low'],
    ['medium', 'Medium'],
    ['unknown', 'Medium'],
    [undefined, 'Medium'],
  ] as const;

  test.each(cases)('scenario priority "%s" → test case priority "%s"', async (input, expected) => {
    const spec = makeSpec([{
      id: 'SC-001', name: 'Test', priority: input,
      preconditions: [], steps: [], assertions: [],
    }]);
    (JsonTestGenerationService.generateAndCompile as jest.Mock).mockResolvedValueOnce({
      success: true, specification: spec, compiledScripts: {}, errors: [],
    });

    const result = await service.generateTestCases(makeSession());

    expect((result.testCases[0] as any).priority).toBe(expected);
  });
});

// ── Tests: generateScenarios ──────────────────────────────────────────────────

describe('TestingGenerationService — generateScenarios', () => {
  let service: TestingGenerationService;

  beforeEach(() => {
    service = new TestingGenerationService();
    (AiControllerService.generate as jest.Mock).mockClear();
  });

  it('parses valid AI JSON and returns scenarios', async () => {
    const aiResponse = JSON.stringify([
      { id: 'SC-001', title: 'Happy path', tag: 'Happy Path' },
      { id: 'SC-002', title: 'Validation errors', tag: 'Validation' },
    ]);
    (AiControllerService.generate as jest.Mock).mockResolvedValueOnce(aiResponse);

    const result = await service.generateScenarios(makeSession());

    expect(result.scenarios).toHaveLength(2);
    expect(result.scenarios[0].id).toBe('SC-001');
    expect(result.scenarios[0].title).toBe('Happy path');
    expect(result.scenarios[0].selected).toBe(true);
  });

  it('strips markdown code fences from AI response', async () => {
    const aiResponse = '```json\n[{"id":"SC-001","title":"Test","tag":"Negative"}]\n```';
    (AiControllerService.generate as jest.Mock).mockResolvedValueOnce(aiResponse);

    const result = await service.generateScenarios(makeSession());

    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0].title).toBe('Test');
  });

  it('falls back to heuristic scenarios when AI fails', async () => {
    (AiControllerService.generate as jest.Mock).mockRejectedValueOnce(new Error('AI timeout'));

    const result = await service.generateScenarios(makeSession());

    expect(result.scenarios.length).toBeGreaterThan(0);
    // Heuristic bug scenarios
    expect(result.scenarios[0].source).toBe('fallback');
  });

  it('falls back when AI returns invalid JSON', async () => {
    (AiControllerService.generate as jest.Mock).mockResolvedValueOnce('not json at all');

    const result = await service.generateScenarios(makeSession());

    expect(result.scenarios.length).toBeGreaterThan(0);
    expect(result.scenarios[0].source).toBe('fallback');
  });

  it('caps scenarios at 5 items', async () => {
    const sixScenarios = Array.from({ length: 6 }, (_, i) => ({
      id: `SC-00${i + 1}`, title: `Scenario ${i + 1}`, tag: 'Happy Path',
    }));
    (AiControllerService.generate as jest.Mock).mockResolvedValueOnce(JSON.stringify(sixScenarios));

    const result = await service.generateScenarios(makeSession());

    expect(result.scenarios.length).toBeLessThanOrEqual(5);
  });

  it('throws when session has no ticket', async () => {
    const noTicketSession = makeSession({ ticket: null } as any);

    await expect(service.generateScenarios(noTicketSession)).rejects.toThrow('No ticket loaded');
  });
});

// ── Tests: generateTestCases error handling ───────────────────────────────────

describe('TestingGenerationService — generateTestCases error handling', () => {
  let service: TestingGenerationService;

  beforeEach(() => {
    service = new TestingGenerationService();
  });

  it('throws when session has no ticket', async () => {
    const noTicketSession = makeSession({ ticket: null } as any);

    await expect(service.generateTestCases(noTicketSession)).rejects.toThrow('No ticket loaded');
  });

  it('throws when generateAndCompile returns success: false', async () => {
    (JsonTestGenerationService.generateAndCompile as jest.Mock).mockResolvedValueOnce({
      success: false, errors: ['Schema violation: missing steps'], specification: null,
    });

    await expect(service.generateTestCases(makeSession())).rejects.toThrow('Schema violation');
  });

  it('filters test cases to selected scenario IDs when scenarioIds provided', async () => {
    const session = makeSession({
      scenarios: [
        { id: 'SC-001', title: 'S1', label: 'S1', tag: 'Happy Path', selected: true, source: 'ai' },
        { id: 'SC-002', title: 'S2', label: 'S2', tag: 'Validation', selected: false, source: 'ai' },
      ],
    });
    (JsonTestGenerationService.generateAndCompile as jest.Mock).mockResolvedValueOnce({
      success: true,
      specification: makeSpec(),
      compiledScripts: {},
      errors: [],
    });

    // Only SC-001 selected
    await service.generateTestCases(session, ['SC-001']);

    const callArgs = (JsonTestGenerationService.generateAndCompile as jest.Mock).mock.calls[0][0];
    // acceptanceCriteria should only contain SC-001's title
    expect(callArgs.acceptanceCriteria).toHaveLength(1);
    expect(callArgs.acceptanceCriteria[0]).toContain('S1');
  });
});
