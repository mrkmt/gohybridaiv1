/**
 * PageObjectGenerator
 * Generates Playwright Page Object Model files from discovered test cases.
 */

export interface PageObjectFile {
  fileName: string;
  className: string;
  content: string;
}

export class PageObjectGenerator {
  /**
   * Generate POM files from test case specifications.
   * Each module gets its own page object class with selector constants
   * and action helpers.
   */
  static generateFromTestCases(
    testCases: Array<{ module?: string; steps?: Array<{ target?: string; action?: string }> }>,
    defaultModule = 'App',
  ): PageObjectFile[] {
    const moduleMap = new Map<string, Set<string>>();

    for (const tc of testCases) {
      const mod = tc.module || defaultModule;
      if (!moduleMap.has(mod)) moduleMap.set(mod, new Set());
      const selectors = moduleMap.get(mod)!;
      for (const step of tc.steps || []) {
        if (step.target) selectors.add(step.target);
      }
    }

    const files: PageObjectFile[] = [];
    for (const [mod, selectors] of moduleMap.entries()) {
      const className = mod.replace(/\s+/g, '') + 'Page';
      const selectorProps = Array.from(selectors)
        .map(s => {
          const prop = s.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, '');
          return `  readonly ${prop} = this.page.locator(${JSON.stringify(s)});`;
        })
        .join('\n');

      files.push({
        fileName: `${className}.ts`,
        className,
        content: [
          `import { Page } from '@playwright/test';`,
          ``,
          `export class ${className} {`,
          `  constructor(private readonly page: Page) {}`,
          ``,
          selectorProps,
          ``,
          `  async navigate(baseUrl: string) {`,
          `    await this.page.goto(baseUrl);`,
          `  }`,
          `}`,
        ].join('\n'),
      });
    }

    return files;
  }
}
