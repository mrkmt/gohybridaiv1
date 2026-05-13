/**
 * PageObjectGenerator.ts
 *
 * Generates reusable Page Object Model (POM) classes alongside procedural test scripts.
 * Each POM encapsulates locators and actions for a specific module/page,
 * reducing test maintenance burden as the test suite scales.
 *
 * Generated POMs use Playwright's Locator API with auto-waiting and
 * include multi-strategy selectors from SelectorValidatorService.
 */

import * as fs from 'fs';
import * as path from 'path';
import { TestCase, TestStep } from './generation/TestCaseGeneratorService';
import { SelectorValidatorService } from './SelectorValidatorService';

export interface PageObjectFile {
  /** POM class name (e.g., "JournalEntryPage") */
  className: string;
  /** File name (e.g., "JournalEntryPage.ts") */
  fileName: string;
  /** Full TypeScript content */
  content: string;
  /** Which test cases reference this POM */
  usedBy: string[];
}

export interface PageObjectElement {
  /** Business name (e.g., "saveButton", "titleField") */
  name: string;
  /** Playwright locator expression */
  locator: string;
  /** Element type */
  type: 'button' | 'input' | 'dropdown' | 'checkbox' | 'textarea' | 'grid' | 'modal' | 'other';
  /** Human-readable description */
  description?: string;
}

export interface PageObjectAction {
  /** Action name (e.g., "fillTitle", "clickSave") */
  name: string;
  /** TypeScript method content */
  body: string;
  /** Parameters needed */
  params: string;
  /** Human-readable description */
  description?: string;
}

const POM_OUTPUT_DIR = path.join(
  process.env.LOCAL_STORAGE_PATH || './local_storage',
  'page-objects'
);

export class PageObjectGenerator {
  /**
   * Analyze test cases and generate Page Object Model classes.
   * Groups elements by module/page and generates typed TypeScript classes.
   */
  static generateFromTestCases(testCases: TestCase[], moduleName: string): PageObjectFile[] {
    const moduleKey = moduleName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    // Collect all elements referenced across test cases
    const elementMap = new Map<string, PageObjectElement[]>();
    const actionMap = new Map<string, PageObjectAction[]>();
    const usageMap = new Map<string, string[]>();

    for (const tc of testCases) {
      const elements: PageObjectElement[] = [];
      const actions: PageObjectAction[] = [];

      for (let i = 0; i < tc.steps.length; i++) {
        const step = tc.steps[i];
        const stepInfo = this.analyzeStep(step, i + 1);

        if (stepInfo.element) {
          elements.push(stepInfo.element);
        }
        if (stepInfo.action) {
          actions.push(stepInfo.action);
        }
      }

      if (elements.length > 0 || actions.length > 0) {
        // Use module-based POM name
        const pomKey = moduleKey;

        if (!elementMap.has(pomKey)) {
          elementMap.set(pomKey, []);
          actionMap.set(pomKey, []);
          usageMap.set(pomKey, []);
        }

        // Merge elements (deduplicate by name)
        const existingElements = elementMap.get(pomKey)!;
        const existingNames = new Set(existingElements.map(e => e.name));
        for (const el of elements) {
          if (!existingNames.has(el.name)) {
            existingElements.push(el);
            existingNames.add(el.name);
          }
        }

        // Merge actions
        actionMap.get(pomKey)!.push(...actions);
        usageMap.get(pomKey)!.push(tc.caseId);
      }
    }

    // Generate POM files
    const pomFiles: PageObjectFile[] = [];
    for (const [key, elements] of elementMap) {
      const actions = actionMap.get(key) || [];
      const usedBy = usageMap.get(key) || [];
      const pomFile = this.generatePomFile(key, elements, actions, usedBy);
      pomFiles.push(pomFile);
    }

    return pomFiles;
  }

  /**
   * Generate a single POM TypeScript file content.
   */
  private static generatePomFile(
    moduleKey: string,
    elements: PageObjectElement[],
    actions: PageObjectAction[],
    usedBy: string[]
  ): PageObjectFile {
    const className = this.toPascalCase(moduleKey) + 'Page';
    const fileName = `${className}.ts`;

    // Generate locator declarations
    const locators = elements.map(el => {
      const comment = el.description ? `  /** ${el.description} */\n  ` : '  ';
      return `${comment}readonly ${el.name}: Locator;`;
    }).join('\n');

    // Generate constructor
    const constructorAssignments = elements.map(el => {
      return `    this.${el.name} = page.locator('${el.locator.replace(/'/g, "\\'")}');`;
    }).join('\n');

    // Generate action methods
    const methods = actions.map(action => {
      const comment = action.description ? `
  /** ${action.description} */` : '';
      return `
${comment}
  async ${action.name}(${action.params}) {
${action.body.split('\n').map(line => '    ' + line).join('\n')}
  }`;
    }).join('\n');

    const content = `/**
 * ${className}
 *
 * Auto-generated Page Object Model for the "${moduleKey}" module.
 * Encapsulates locators and actions for reusable, maintainable tests.
 *
 * Used by: ${usedBy.join(', ')}
 */

import { Page, Locator } from '@playwright/test';

export class ${className} {
  readonly page: Page;

${locators}

  constructor(page: Page) {
    this.page = page;
${constructorAssignments}
  }

  /**
   * Navigate to the ${moduleKey} page
   */
  async goto() {
    await this.page.goto('/#/app.${moduleKey}');
    await this.page.waitForLoadState('networkidle');
  }
${methods}
}
`;

    return { className, fileName, content, usedBy };
  }

  /**
   * Analyze a single test step and extract element + action info.
   */
  private static analyzeStep(step: TestStep, stepNumber: number): {
    element?: PageObjectElement;
    action?: PageObjectAction;
  } {
    const result: { element?: PageObjectElement; action?: PageObjectAction } = {};
    const actionText = (step.action || '').toLowerCase();

    // --- Extract element from fill steps ---
    if (actionText.includes('fill') || actionText.includes('enter') || actionText.includes('input')) {
      const fieldMatch = step.action?.match(/(?:fill|enter|input)\s+(?:the\s+)?(\w+)/i);
      if (fieldMatch) {
        const fieldName = fieldMatch[1].toLowerCase();
        const selector = SelectorValidatorService.resolveFieldSelector(fieldName, 'text');
        const topSelector = selector[0];

        result.element = {
          name: `${fieldName}Field`,
          locator: topSelector.selector,
          type: 'input',
          description: `Input field for ${fieldName}`,
        };

        result.action = {
          name: `fill${this.toPascalCase(fieldName)}`,
          params: `value: string`,
          body: `await this.${fieldName}Field.fill(value);`,
          description: `Fill the ${fieldName} field with the given value`,
        };
      }
    }

    // --- Extract element from click steps ---
    if (actionText.includes('click') || actionText.includes('press') || actionText.includes('select')) {
      const buttonMatch = step.action?.match(/click\s+(?:the\s+)?(\w+\s*\w*)/i);
      if (buttonMatch) {
        const buttonName = buttonMatch[1].toLowerCase().replace(/\s+/g, ' ');
        const selector = SelectorValidatorService.resolveButtonSelector(buttonName);
        const topSelector = selector[0];

        result.element = {
          name: `${this.toPascalCase(buttonName)}Button`,
          locator: topSelector.selector,
          type: 'button',
          description: `Button: ${buttonName}`,
        };

        result.action = {
          name: `click${this.toPascalCase(buttonName)}`,
          params: `options?: { force?: boolean; timeout?: number }`,
          body: `await this.${this.toPascalCase(buttonName)}Button.click(options);`,
          description: `Click the ${buttonName} button`,
        };
      }
    }

    // --- Generic element extraction from action text ---
    if (!result.element && step.action) {
      // Try to extract a field or element reference
      const genericMatch = step.action?.match(/(?:on|to|the)\s+['"]?([a-zA-Z][a-zA-Z0-9_\s-]+)/i);
      if (genericMatch) {
        const elemName = genericMatch[1].trim().toLowerCase().replace(/\s+/g, '_');
        result.element = {
          name: `${this.toPascalCase(elemName)}Element`,
          locator: `[data-testid="${elemName}"], [name="${elemName}"], #${elemName}`,
          type: 'other',
          description: `Element: ${elemName}`,
        };
      }
    }

    return result;
  }

  /**
   * Save generated POM files to disk.
   */
  static savePomFiles(pomFiles: PageObjectFile[]): string[] {
    const savedPaths: string[] = [];

    if (!fs.existsSync(POM_OUTPUT_DIR)) {
      fs.mkdirSync(POM_OUTPUT_DIR, { recursive: true });
    }

    for (const pom of pomFiles) {
      const filePath = path.join(POM_OUTPUT_DIR, pom.fileName);
      fs.writeFileSync(filePath, pom.content, 'utf-8');
      savedPaths.push(filePath);
      console.log(`[PageObjectGenerator] Saved POM: ${filePath}`);
    }

    return savedPaths;
  }

  /**
   * Convert a string to PascalCase.
   */
  private static toPascalCase(str: string): string {
    return str
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('');
  }
}
