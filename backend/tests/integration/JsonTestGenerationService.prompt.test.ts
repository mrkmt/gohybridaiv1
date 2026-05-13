import { JsonGenerationOptions, JsonTestGenerationService } from '../../src/services/JsonTestGenerationService';
import { UnifiedAIOrchestrator } from '../../api/UnifiedAIOrchestrator';
import { appLogger } from '../../src/utils/logger';

jest.mock('../../api/UnifiedAIOrchestrator', () => ({
  TaskType: {
    TEST_GENERATION: 'TEST_GENERATION',
  },
  UnifiedAIOrchestrator: {
    generate: jest.fn(),
  },
}));

describe('JsonTestGenerationService prompt integration', () => {
  const generateMock = UnifiedAIOrchestrator.generate as jest.MockedFunction<typeof UnifiedAIOrchestrator.generate>;
  const loggerSpy = jest.spyOn(appLogger, 'info');

  const baseOptions = (): JsonGenerationOptions => ({
    ticketId: 'ATT-100',
    summary: 'Department setup validation',
    description: 'Validate department flows',
    module: 'master-department',
    baseUrl: 'https://test.globalhr.com.mm/ook',
    issueType: 'Story',
    maxRetries: 1,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    loggerSpy.mockImplementation(() => undefined);
    generateMock.mockResolvedValue(`{
      "ticketId": "ATT-100",
      "feature": "Department setup validation",
      "module": "master-department",
      "scenarios": [
        {
          "id": "SC-001",
          "name": "Basic flow",
          "priority": "high",
          "steps": [
            { "type": "goto", "url": "/#/app.department" },
            { "type": "waitForSelector", "selector": ".k-grid", "state": "visible" }
          ],
          "assertions": [
            { "type": "assertVisible", "selector": ".k-grid", "visible": true }
          ]
        }
      ]
    }`);
  });

  it('adapts the prompt for Bug tickets', () => {
    const options: JsonGenerationOptions = {
      ...baseOptions(),
      issueType: 'Bug',
    };

    const prompt = (JsonTestGenerationService as any).buildPrompt(options) as string;

    expect(prompt).toContain('**Ticket Type:** Bug');
    expect(prompt).toContain('Reproduce the reported failure first');
    expect(prompt).toContain('no visible error state and visible success state');
    expect(prompt).not.toContain('Cover the acceptance criteria with an end-to-end happy path');
  });

  it('adapts the prompt for Story tickets', () => {
    const options: JsonGenerationOptions = {
      ...baseOptions(),
      issueType: 'Story',
      acceptanceCriteria: ['User can create a department'],
    };

    const prompt = (JsonTestGenerationService as any).buildPrompt(options) as string;

    expect(prompt).toContain('**Ticket Type:** Story');
    expect(prompt).toContain('Cover the acceptance criteria with an end-to-end happy path');
    expect(prompt).not.toContain('Reproduce the reported failure first');
  });

  it('injects anti-flakiness guidance when average success rate is below threshold', () => {
    const options: JsonGenerationOptions = {
      ...baseOptions(),
      learnedPatterns: [
        {
          id: 'pattern-1',
          module: 'master-department',
          issueType: 'story',
          successRate: 0.62,
          selectors: ['.k-grid', '#ShortCode'],
          workflow: [{ type: 'click', element: 'Add' }],
        },
      ],
      flakinessData: {
        module: 'master-department',
        issueType: 'Story',
        sampleCount: 3,
        averageSuccessRate: 0.62,
        belowThreshold: true,
        threshold: 0.8,
        recommendedWaitTimeoutMs: 20000,
      },
    };

    const prompt = (JsonTestGenerationService as any).buildPrompt(options) as string;

    expect(prompt).toContain('## Learned Patterns (SmartSkillManager historical workflows)');
    expect(prompt).toContain('## Flakiness Data');
    expect(prompt).toContain('### Anti-Flakiness Protocol');
    expect(prompt).toContain('below the 80% success threshold');
    expect(prompt).toContain('waitForSelector step with a 20000ms timeout');
  });

  it('logs telemetry with attached context flags and compiled prompt', async () => {
    const options: JsonGenerationOptions = {
      ...baseOptions(),
      issueType: 'Bug',
      learnedPatterns: [
        {
          id: 'pattern-1',
          module: 'master-department',
          issueType: 'bug',
          successRate: 0.71,
        },
      ],
      flakinessData: {
        module: 'master-department',
        issueType: 'Bug',
        sampleCount: 2,
        averageSuccessRate: 0.71,
        belowThreshold: true,
        threshold: 0.8,
        recommendedWaitTimeoutMs: 20000,
      },
    };

    const result = await JsonTestGenerationService.generateTestSpecification(options);

    expect(result.success).toBe(true);
    expect(loggerSpy).toHaveBeenCalledWith(
      '[JsonTestGeneration] Prompt telemetry',
      expect.objectContaining({
        ticketId: 'ATT-100',
        module: 'master-department',
        issueType: 'Bug',
        learnedPatternsAttached: true,
        learnedPatternCount: 1,
        flakinessDataAttached: true,
        flakinessBelowThreshold: true,
        flakinessSampleCount: 2,
        averageSuccessRate: 0.71,
        compiledPrompt: expect.any(String),
      })
    );

    const telemetryCall = loggerSpy.mock.calls.find(([message]) => message === '[JsonTestGeneration] Prompt telemetry');
    expect(telemetryCall).toBeDefined();
    expect(telemetryCall?.[1]).toEqual(
      expect.objectContaining({
        compiledPrompt: expect.stringContaining('Reproduce the reported failure first'),
      })
    );
  });
});
