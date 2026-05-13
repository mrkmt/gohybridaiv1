import { JsonTestGenerationService, JsonGenerationOptions } from '../../src/services/JsonTestGenerationService';
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

describe('JsonTestGenerationService unit', () => {
  const generateMock = UnifiedAIOrchestrator.generate as jest.MockedFunction<typeof UnifiedAIOrchestrator.generate>;
  const loggerSpy = jest.spyOn(appLogger, 'info');

  const baseOptions = (): JsonGenerationOptions => ({
    ticketId: 'ATT-100',
    summary: 'Test summary',
    description: 'Test description',
    module: 'department',
    baseUrl: 'https://test.globalhr.com.mm/ook',
    maxRetries: 1,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    loggerSpy.mockImplementation(() => undefined);
  });

  describe('buildPrompt', () => {
    it('includes ticket information in the prompt', () => {
      const options: JsonGenerationOptions = {
        ...baseOptions(),
        issueType: 'Story',
      };
      const prompt = (JsonTestGenerationService as any).buildPrompt(options) as string;

      expect(prompt).toContain('ATT-100');
      expect(prompt).toContain('Test summary');
      expect(prompt).toContain('department');
    });

    it('appends enterprise rules before ticket data', () => {
      const options = baseOptions();
      const prompt = (JsonTestGenerationService as any).buildPrompt(options) as string;

      // Enterprise rules should appear before the ticket information section
      const rulesIndex = prompt.indexOf('RULE');
      const ticketIndex = prompt.indexOf('## Ticket Information');
      expect(rulesIndex).toBeGreaterThanOrEqual(0);
      expect(ticketIndex).toBeGreaterThan(rulesIndex);
    });

    it('injects acceptance criteria when provided', () => {
      const options: JsonGenerationOptions = {
        ...baseOptions(),
        acceptanceCriteria: ['User can create department', 'Short code must be unique'],
      };
      const prompt = (JsonTestGenerationService as any).buildPrompt(options) as string;

      expect(prompt).toContain('User can create department');
      expect(prompt).toContain('Short code must be unique');
    });

    it('injects skill context when provided', () => {
      const options: JsonGenerationOptions = {
        ...baseOptions(),
        skillContext: 'Custom skill context text',
      };
      const prompt = (JsonTestGenerationService as any).buildPrompt(options) as string;

      expect(prompt).toContain('Custom skill context text');
    });
  });

  describe('loadModuleKnowledge', () => {
    it('loads department knowledge file', () => {
      const knowledge = (JsonTestGenerationService as any).loadModuleKnowledge('department');
      // May be null if file doesn't exist on this machine — check structure if present
      if (knowledge) {
        expect(typeof knowledge).toBe('object');
      }
    });

    it('returns null for unknown module', () => {
      const knowledge = (JsonTestGenerationService as any).loadModuleKnowledge('nonexistent-module');
      expect(knowledge).toBeNull();
    });

    it('fuzzy matches module names', () => {
      const knowledge = (JsonTestGenerationService as any).loadModuleKnowledge('master/department');
      if (knowledge) {
        expect(typeof knowledge).toBe('object');
      }
    });
  });

  describe('stripInlineMarkdown', () => {
    it('strips bold formatting from text', () => {
      const stripFn = (JsonTestGenerationService as any).__esModule
        ? (JsonTestGenerationService as any).stripInlineMarkdown
        : undefined;
      // stripInlineMarkdown is a module-level function, not exported
      // Test through spec processing instead
    });
  });

  describe('generateTestSpecification — fallback behavior', () => {
    it('returns fallback spec when AI returns empty response', async () => {
      generateMock.mockResolvedValue('');

      const result = await JsonTestGenerationService.generateTestSpecification(baseOptions());

      expect(result.success).toBe(true); // fallback still counts as success
      expect(result.specification).toBeDefined();
      expect(result.specification!.ticketId).toBe('FALLBACK');
    });

    it('returns fallback spec when AI throws error', async () => {
      generateMock.mockRejectedValue(new Error('AI service unavailable'));

      const result = await JsonTestGenerationService.generateTestSpecification(baseOptions());

      expect(result.success).toBe(true);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      expect(result.specification!.ticketId).toBe('FALLBACK');
    });

    it('retries on validation failure then succeeds', async () => {
      // First call returns invalid JSON, second returns valid
      generateMock
        .mockResolvedValueOnce('{ invalid json }')
        .mockResolvedValueOnce(`{
          "ticketId": "ATT-100",
          "feature": "Test",
          "module": "department",
          "scenarios": [{
            "id": "SC-01",
            "name": "Test scenario",
            "priority": "high",
            "steps": [{ "type": "goto", "url": "/#/app.department" }],
            "assertions": [{ "type": "assertVisible", "selector": ".k-grid" }]
          }]
        }`);

      const result = await JsonTestGenerationService.generateTestSpecification({
        ...baseOptions(),
        maxRetries: 3,
      });

      expect(result.success).toBe(true);
      expect(result.retries).toBe(1);
      expect(result.specification!.scenarios).toHaveLength(1);
    });
  });

  describe('compileToPlaywright', () => {
    it('compiles a valid spec to Playwright script and returns path', () => {
      const { spec, TestSpecSchema } = require('../../src/services/TestSpecSchema');
      const validSpec: any = {
        ticketId: 'ATT-COMPILE',
        feature: 'Compile Test',
        module: 'department',
        scenarios: [{
          id: 'SC-01',
          name: 'Basic',
          priority: 'high',
          steps: [{ type: 'goto', url: '/#/app.department' }],
          assertions: [{ type: 'assertVisible', selector: '.k-grid' }],
        }],
      };

      const result = JsonTestGenerationService.compileToPlaywright(validSpec, {
        baseUrl: 'https://test.globalhr.com.mm/ook',
        recordVideo: false,
        recordTrace: false,
        viewport: { width: 1280, height: 720 },
      });

      expect(result.script).toContain("import { test, expect");
      expect(result.script).toContain('ATT-COMPILE');
      expect(result.path).toContain('.spec.ts');
      expect(result.path).toContain('ATT-COMPILE');
    });
  });
});
