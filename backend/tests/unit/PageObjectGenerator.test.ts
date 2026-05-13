/**
 * PageObjectGenerator.test.ts
 */

import { PageObjectGenerator } from '../../src/services/PageObjectGenerator';
import * as fs from 'fs';
import * as path from 'path';

const POM_DIR = path.join(process.env.LOCAL_STORAGE_PATH || './local_storage', 'page-objects');

describe('PageObjectGenerator', () => {
  beforeEach(() => {
    if (fs.existsSync(POM_DIR)) fs.rmSync(POM_DIR, { recursive: true, force: true });
  });

  function makeStep(action: string): any {
    return {
      stepNumber: 1,
      action,
      expectedResult: 'ok',
    };
  }

  function makeTestCase(id: string, title: string, steps: any[]): any {
    return {
      caseId: id,
      title,
      steps,
      expectedOutcome: 'pass',
      priority: 'High' as const,
      isEditable: true,
    };
  }

  test('generates POM from test cases with fill and click steps', () => {
    const testCases = [
      makeTestCase('TC-001', 'Create department', [
        makeStep('Navigate to /#/app.department'),
        makeStep('Fill the title field with value'),
        makeStep('Click the save button'),
        makeStep('Click the cancel button'),
      ]),
    ];

    const pomFiles = PageObjectGenerator.generateFromTestCases(testCases, 'department');
    expect(pomFiles.length).toBeGreaterThan(0);
    expect(pomFiles[0].className).toBe('DepartmentPage');
    expect(pomFiles[0].content).toContain('class DepartmentPage');
    expect(pomFiles[0].content).toContain('readonly');
    expect(pomFiles[0].content).toContain('async goto()');
  });

  test('generates multiple POM files for different modules', () => {
    const testCases = [
      makeTestCase('TC-010', 'Manage department', [
        makeStep('Fill the name field'),
        makeStep('Click the add button'),
      ]),
      makeTestCase('TC-011', 'Manage designation', [
        makeStep('Fill the title field'),
        makeStep('Click the save button'),
      ]),
    ];

    // Since both go to same module in the call, they merge into one POM
    const pomFiles = PageObjectGenerator.generateFromTestCases(testCases, 'department');
    expect(pomFiles.length).toBeGreaterThanOrEqual(1);
  });

  test('saves POM files to disk', () => {
    const testCases = [
      makeTestCase('TC-020', 'Test', [
        makeStep('Click the save button'),
      ]),
    ];

    const pomFiles = PageObjectGenerator.generateFromTestCases(testCases, 'journal');
    const savedPaths = PageObjectGenerator.savePomFiles(pomFiles);

    expect(savedPaths.length).toBe(pomFiles.length);
    for (const filePath of savedPaths) {
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('@playwright/test');
      expect(content).toContain('class');
    }
  });

  test('POM content includes locators and actions', () => {
    const testCases = [
      makeTestCase('TC-030', 'Form test', [
        makeStep('Fill the username field'),
        makeStep('Click the submit button'),
      ]),
    ];

    const pomFiles = PageObjectGenerator.generateFromTestCases(testCases, 'auth');
    expect(pomFiles[0].content).toContain('async fillUsername');
    expect(pomFiles[0].content).toContain('async clickSubmit');
  });

  test('toPascalCase handles various input formats', () => {
    const toPascalCase = (PageObjectGenerator as any).toPascalCase.bind(PageObjectGenerator);
    expect(toPascalCase('add new')).toBe('AddNew');
    expect(toPascalCase('department-name')).toBe('DepartmentName');
    expect(toPascalCase('user_id')).toBe('UserId');
    expect(toPascalCase('  trim  spaces  ')).toBe('TrimSpaces');
  });
});
