import { JSONToPlaywrightCompiler, CompilerOptions } from '../../src/services/JSONToPlaywrightCompiler';
import { TestSpecification } from '../../src/services/TestSpecSchema';

describe('JSONToPlaywrightCompiler', () => {
  const defaultOptions: CompilerOptions = {
    baseUrl: 'https://test.globalhr.com.mm/ook',
    ticketId: 'ATT-TEST',
    recordVideo: false,
    recordTrace: false,
    viewport: { width: 1280, height: 720 },
  };

  const compile = (spec: TestSpecification, options?: Partial<CompilerOptions>) => {
    const compiler = new JSONToPlaywrightCompiler({ ...defaultOptions, ...options });
    return compiler.compile(spec);
  };

  describe('compile — file structure', () => {
    it('generates a valid Playwright test file with imports', () => {
      const spec: TestSpecification = {
        ticketId: 'ATT-01',
        feature: 'Test Feature',
        module: 'test',
        scenarios: [],
      };
      const output = compile(spec);

      expect(output).toContain("import { test, expect, Page } from '@playwright/test'");
      expect(output).toContain('import { performLogin }');
      expect(output).toContain('import { healedClick, waitForAngular, universalFill');
      expect(output).toContain('test.use({');
    });

    it('includes auto-login block when credentials provided', () => {
      const spec: TestSpecification = {
        ticketId: 'ATT-01',
        feature: 'Test',
        module: 'test',
        scenarios: [],
      };
      const output = compile(spec, {
        credentials: { username: 'user', password: 'pass', idNumber: '123' },
      });

      expect(output).toContain('const autoLogin = async');
      expect(output).toContain('await performLogin(page, credentials');
    });

    it('omits auto-login block when isLoginTest is true', () => {
      const spec: TestSpecification = {
        ticketId: 'ATT-01',
        feature: 'Login',
        module: 'login',
        scenarios: [],
      };
      const output = compile(spec, {
        credentials: { username: 'user', password: 'pass' },
        isLoginTest: true,
      });

      expect(output).not.toContain('const autoLogin = async');
    });
  });

  describe('compile — goto steps', () => {
    it('compiles a basic goto step with hash route normalization', () => {
      const spec: TestSpecification = {
        ticketId: 'ATT-01',
        feature: 'Test',
        module: 'test',
        scenarios: [{
          id: 'SC-01',
          name: 'Navigate',
          priority: 'high',
          steps: [{ type: 'goto', url: '/#/app.department' }],
          assertions: [],
        }],
      };
      const output = compile(spec);

      expect(output).toContain("Navigating to:");
      expect(output).toContain("page.goto(");
      expect(output).toContain("domcontentloaded");
      expect(output).toContain("waitForAngular(page)");
    });

    it('strips absolute URLs and keeps only path+hash', () => {
      const spec: TestSpecification = {
        ticketId: 'ATT-01',
        feature: 'Test',
        module: 'test',
        scenarios: [{
          id: 'SC-01',
          name: 'Navigate',
          priority: 'high',
          steps: [{ type: 'goto', url: 'https://test.globalhr.com.mm/ook#/app.department' }],
          assertions: [],
        }],
      };
      const output = compile(spec);

      // Should strip the origin and use relative path
      expect(output).toContain('#/app.department');
      expect(output).not.toContain('https://test.globalhr.com.mm/ook#/app.department');
    });

    it('normalizes hash-only URLs to include baseUrl', () => {
      const spec: TestSpecification = {
        ticketId: 'ATT-01',
        feature: 'Test',
        module: 'test',
        scenarios: [{
          id: 'SC-01',
          name: 'Navigate',
          priority: 'high',
          steps: [{ type: 'goto', url: '#/app.department' }],
          assertions: [],
        }],
      };
      const output = compile(spec);

      expect(output).toContain('/ook#/app.department');
    });
  });

  describe('compile — fill steps', () => {
    it('compiles a generic fill step with universalFill', () => {
      const spec: TestSpecification = {
        ticketId: 'ATT-01',
        feature: 'Test',
        module: 'test',
        scenarios: [{
          id: 'SC-01',
          name: 'Fill Form',
          priority: 'high',
          steps: [{
            type: 'fill',
            field: 'ShortCode',
            value: 'HR01',
            selectorHint: 'input[name="ShortCode"]',
          }],
          assertions: [],
        }],
      };
      const output = compile(spec);

      expect(output).toContain('universalFill(');
      // Value is now unique: testData.uniqueShortCode('HR', 5)
      expect(output).toContain('testData.uniqueShortCode');
    });

    it('compiles Kendo-aware fill step with isKendo flag', () => {
      const spec: TestSpecification = {
        ticketId: 'ATT-01',
        feature: 'Test',
        module: 'test',
        scenarios: [{
          id: 'SC-01',
          name: 'Fill Kendo Form',
          priority: 'high',
          steps: [{
            type: 'fill',
            field: 'Name',
            value: 'Test Dept',
            selectorHint: 'kendo-textbox',
            isKendo: true,
          }],
          assertions: [],
        }],
      };
      const output = compile(spec);

      expect(output).toContain('[Kendo]');
      expect(output).toContain('isKendo: true');
      expect(output).toContain('kendoStabilizationDelay');
    });
  });

  describe('compile — click steps', () => {
    it('compiles click step with selectorHint using healedClick', () => {
      const spec: TestSpecification = {
        ticketId: 'ATT-01',
        feature: 'Test',
        module: 'test',
        scenarios: [{
          id: 'SC-01',
          name: 'Click Button',
          priority: 'high',
          steps: [{
            type: 'click',
            element: 'Save',
            selectorHint: 'button.btn.btn-success',
          }],
          assertions: [],
        }],
      };
      const output = compile(spec);

      expect(output).toContain('healedClick(');
      expect(output).toContain('button.btn.btn-success');
    });

    it('generates multi-strategy selector chain for icon-only buttons without selectorHint', () => {
      const spec: TestSpecification = {
        ticketId: 'ATT-01',
        feature: 'Test',
        module: 'test',
        scenarios: [{
          id: 'SC-01',
          name: 'Click Icon Button',
          priority: 'high',
          steps: [{
            type: 'click',
            element: 'Add',
          }],
          assertions: [],
        }],
      };
      const output = compile(spec);

      expect(output).toContain('icon-aware multi-strategy selector');
      expect(output).toContain('healedClick(');
    });
  });

  describe('compile — waitForResponse steps', () => {
    it('compiles simple urlPattern with includes()', () => {
      const spec: TestSpecification = {
        ticketId: 'ATT-01',
        feature: 'Test',
        module: 'test',
        scenarios: [{
          id: 'SC-01',
          name: 'Wait for API',
          priority: 'high',
          steps: [{
            type: 'waitForResponse',
            urlPattern: '/api/department/save',
            status: 200,
          }],
          assertions: [],
        }],
      };
      const output = compile(spec);

      expect(output).toContain('.includes(');
      expect(output).toContain('/api/department/save');
    });

    it('compiles regex pattern for pipe-separated urlPatterns', () => {
      const spec: TestSpecification = {
        ticketId: 'ATT-01',
        feature: 'Test',
        module: 'test',
        scenarios: [{
          id: 'SC-01',
          name: 'Wait for API',
          priority: 'high',
          steps: [{
            type: 'waitForResponse',
            urlPattern: '/api/department/save|/api/department/create',
            status: 200,
          }],
          assertions: [],
        }],
      };
      const output = compile(spec);

      expect(output).toContain('new RegExp(');
    });
  });

  describe('compile — assertions', () => {
    it('compiles assertVisible with expect(locator).toBeVisible()', () => {
      const spec: TestSpecification = {
        ticketId: 'ATT-01',
        feature: 'Test',
        module: 'test',
        scenarios: [{
          id: 'SC-01',
          name: 'Verify',
          priority: 'high',
          steps: [],
          assertions: [{
            type: 'assertVisible',
            selector: '.k-grid',
            visible: true,
          }],
        }],
      };
      const output = compile(spec);

      expect(output).toContain('toBeVisible');
      expect(output).toContain('.k-grid');
    });

    it('compiles assertText with expect(locator).toContainText()', () => {
      const spec: TestSpecification = {
        ticketId: 'ATT-01',
        feature: 'Test',
        module: 'test',
        scenarios: [{
          id: 'SC-01',
          name: 'Verify Text',
          priority: 'high',
          steps: [],
          assertions: [{
            type: 'assertText',
            selector: '.k-grid',
            expected: 'Test Department',
            contains: true,
          }],
        }],
      };
      const output = compile(spec);

      expect(output).toContain('toContainText');
      expect(output).toContain('Test Department');
    });

    it('compiles assertCount with expect(locator).toHaveCount()', () => {
      const spec: TestSpecification = {
        ticketId: 'ATT-01',
        feature: 'Test',
        module: 'test',
        scenarios: [{
          id: 'SC-01',
          name: 'Verify Count',
          priority: 'high',
          steps: [],
          assertions: [{
            type: 'assertCount',
            selector: '.k-grid tbody tr',
            expected: 5,
          }],
        }],
      };
      const output = compile(spec);

      expect(output).toContain('toHaveCount');
    });
  });

  describe('compile — selectOption steps', () => {
    it('compiles Kendo dropdown strategy when framework is kendo-ui', () => {
      const spec: TestSpecification = {
        ticketId: 'ATT-01',
        feature: 'Test',
        module: 'test',
        scenarios: [{
          id: 'SC-01',
          name: 'Select Option',
          priority: 'high',
          steps: [{
            type: 'selectOption',
            field: 'Status',
            value: 'Active',
            selectorHint: '.k-dropdown',
            framework: 'kendo-ui',
          }],
          assertions: [],
        }],
      };
      const output = compile(spec);

      expect(output).toContain('[Kendo dropdown strategy]');
      expect(output).toContain('.k-popup .k-list-item');
    });
  });

  describe('compile — special characters escaping', () => {
    it('handles single quotes in unique value generation', () => {
      const spec: TestSpecification = {
        ticketId: 'ATT-01',
        feature: 'Test',
        module: 'test',
        scenarios: [{
          id: 'SC-01',
          name: 'Fill',
          priority: 'high',
          steps: [{
            type: 'fill',
            field: 'Name',
            value: "O'Connor Dept",
            selectorHint: 'input[name="Name"]',
          }],
          assertions: [],
        }],
      };
      const output = compile(spec);

      // Value is converted to testData.uniqueName() call — no escaping issues
      expect(output).toContain('testData.uniqueName');
      expect(output).not.toContain("O'Connor Dept'");
    });

    it('handles newlines in unique value generation', () => {
      const spec: TestSpecification = {
        ticketId: 'ATT-01',
        feature: 'Test',
        module: 'test',
        scenarios: [{
          id: 'SC-01',
          name: 'Fill',
          priority: 'high',
          steps: [{
            type: 'fill',
            field: 'Description',
            value: 'Line 1\nLine 2',
            selectorHint: 'textarea[name="Description"]',
          }],
          assertions: [],
        }],
      };
      const output = compile(spec);

      // Value is converted to testData.uniqueName() call — no raw newline in output
      expect(output).toContain('testData.uniqueName');
      expect(output).toContain('Description');
    });
  });

  describe('compile — scenario structure', () => {
    it('generates test.describe wrapper with scenario ID and name', () => {
      const spec: TestSpecification = {
        ticketId: 'ATT-01',
        feature: 'Test',
        module: 'test',
        scenarios: [{
          id: 'SC-001',
          name: 'Create Department',
          priority: 'high',
          steps: [],
          assertions: [],
          preconditions: ['User is logged in'],
          tags: ['smoke', 'department'],
        }],
      };
      const output = compile(spec);

      expect(output).toContain("test.describe('SC-001: Create Department'");
      expect(output).toContain("// Pre-conditions:");
      expect(output).toContain("//   - User is logged in");
      expect(output).toContain("// Tags: smoke, department");
    });

    it('compiles multiple scenarios into separate test.describe blocks', () => {
      const spec: TestSpecification = {
        ticketId: 'ATT-01',
        feature: 'Test',
        module: 'test',
        scenarios: [
          {
            id: 'SC-001',
            name: 'First',
            priority: 'high',
            steps: [{ type: 'goto', url: '/#/app.test' }],
            assertions: [],
          },
          {
            id: 'SC-002',
            name: 'Second',
            priority: 'medium',
            steps: [{ type: 'goto', url: '/#/app.test2' }],
            assertions: [],
          },
        ],
      };
      const output = compile(spec);

      expect(output).toContain("test.describe('SC-001: First'");
      expect(output).toContain("test.describe('SC-002: Second'");
      // Should have 2 test( calls
      const testCalls = output.match(/test\('/g);
      expect(testCalls).toHaveLength(2);
    });
  });
});
