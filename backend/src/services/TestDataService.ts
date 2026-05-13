/**
 * TestDataService
 *
 * Generates unique test data per run and cleans up created records after tests.
 * Solves the #1 cause of test failures: duplicate records from previous runs.
 *
 * Usage in generated tests:
 *   const testData = new TestDataService(page);
 *   const name = testData.uniqueName('Department');
 *   const code = testData.uniqueShortCode('DEP', 5);
 *   // After creating record via UI:
 *   await testData.registerDepartment(name, code);
 *   // At end of test (auto-registered in test teardown):
 *   await testData.cleanup();
 */

import { appLogger } from '../utils/logger';

type Page = any;

export interface CreatedRecord {
  module: string;
  name: string;
  code?: string;
  id?: string | number;
  deleted: boolean;
}

export interface CleanupResult {
  cleaned: number;
  failed: number;
  errors: string[];
}

/**
 * API-based deletion for GlobalHR modules.
 * Each module has its own delete endpoint pattern.
 */
const MODULE_DELETE_API: Record<string, (name: string, code?: string) => { url: string; method: string; body?: object }> = {
  department: (name, code) => ({
    url: '/api/department',
    method: 'DELETE',
    body: { name, shortCode: code },
  }),
  designation: (name) => ({
    url: '/api/designation',
    method: 'DELETE',
    body: { title: name },
  }),
  grade: (name) => ({
    url: '/api/grade',
    method: 'DELETE',
    body: { name },
  }),
  'team setup': (name) => ({
    url: '/api/team',
    method: 'DELETE',
    body: { name },
  }),
  'label setup': (name) => ({
    url: '/api/label',
    method: 'DELETE',
    body: { labelName: name },
  }),
};

export class TestDataService {
  private createdRecords: CreatedRecord[] = [];
  private page: Page;
  private cleanupDone = false;

  constructor(page: Page) {
    this.page = page;
  }

  // =========================================================================
  // Unique Data Generation
  // =========================================================================

  /**
   * Generate a unique name with a short timestamp suffix.
   * Example: 'Department' → 'Department_lx4k9z'
   */
  uniqueName(base: string): string {
    const suffix = this.timestampSuffix(6);
    return `${base}_${suffix}`;
  }

  /**
   * Generate a unique short code within a max length.
   * Example: uniqueShortCode('DEP', 5) → 'DEP7k'
   */
  uniqueShortCode(base: string, maxLength: number = 5): string {
    const ts = this.timestampSuffix(4);
    const available = Math.max(1, maxLength - ts.length);
    return `${base.slice(0, available)}${ts}`.slice(0, maxLength);
  }

  /**
   * Generate a unique number suffix for sequential fields.
   * Example: uniqueNumber(1000) → 1037
   */
  uniqueNumber(base: number = 1000): number {
    const offset = Math.floor(Date.now() / 1000) % 10000;
    return base + offset;
  }

  // =========================================================================
  // Record Registration
  // =========================================================================

  /**
   * Register a created department for cleanup.
   */
  async registerDepartment(name: string, code?: string): Promise<void> {
    this.createdRecords.push({ module: 'department', name, code, deleted: false });
  }

  /**
   * Register a created designation for cleanup.
   */
  async registerDesignation(name: string): Promise<void> {
    this.createdRecords.push({ module: 'designation', name, deleted: false });
  }

  /**
   * Register a created grade for cleanup.
   */
  async registerGrade(name: string): Promise<void> {
    this.createdRecords.push({ module: 'grade', name, deleted: false });
  }

  /**
   * Register a generic record for cleanup.
   */
  register(module: string, name: string, code?: string): void {
    this.createdRecords.push({ module: module.toLowerCase(), name, code, deleted: false });
  }

  // =========================================================================
  // Cleanup
  // =========================================================================

  /**
   * Clean up all created records in reverse order (children before parents).
   * Uses API deletion when available, falls back to UI-based deletion.
   */
  async cleanup(): Promise<CleanupResult> {
    if (this.cleanupDone) {
      return { cleaned: 0, failed: 0, errors: [] };
    }
    this.cleanupDone = true;

    let cleaned = 0;
    let failed = 0;
    const errors: string[] = [];

    // Reverse order: delete children before parents
    for (const record of [...this.createdRecords].reverse()) {
      if (record.deleted) continue;

      try {
        const deleted = await this.deleteRecord(record);
        if (deleted) {
          record.deleted = true;
          cleaned++;
          appLogger.info(`[TestDataService] Cleaned up ${record.module}: ${record.name}`);
        } else {
          failed++;
          errors.push(`Delete returned false for ${record.module}: ${record.name}`);
        }
      } catch (err: any) {
        failed++;
        errors.push(`Failed to cleanup ${record.module}/${record.name}: ${err.message}`);
      }
    }

    if (cleaned > 0 || failed > 0) {
      appLogger.info(`[TestDataService] Cleanup complete: ${cleaned} cleaned, ${failed} failed`);
    }

    return { cleaned, failed, errors };
  }

  /**
   * Get list of records that were not cleaned up (for debugging).
   */
  getRemainingRecords(): CreatedRecord[] {
    return this.createdRecords.filter(r => !r.deleted);
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private timestampSuffix(length: number = 6): string {
    return Date.now().toString(36).slice(-length);
  }

  private async deleteRecord(record: CreatedRecord): Promise<boolean> {
    const moduleKey = record.module.toLowerCase();
    const apiConfigFn = MODULE_DELETE_API[moduleKey];

    // Strategy 1: API deletion
    if (apiConfigFn) {
      try {
        const apiConfig = apiConfigFn(record.name, record.code);
        const apiResult = await this.deleteViaApi(apiConfig);
        if (apiResult) return true;
      } catch {
        // API failed — fall through to UI deletion
      }
    }

    // Strategy 2: UI-based deletion (navigate to module, find record, delete)
    return this.deleteViaUI(record);
  }

  private async deleteViaApi(
    apiConfig: { url: string; method: string; body?: object },
  ): Promise<boolean> {
    const response = await this.page.evaluate(
      ({ url, method, body }: { url: any; method: any; body: any }) => {
        return fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        }).then(r => r.ok);
      },
      { url: apiConfig.url, method: apiConfig.method, body: apiConfig.body },
    );
    return response;
  }

  private async deleteViaUI(record: CreatedRecord): Promise<boolean> {
    try {
      // Navigate to the module page
      const moduleRoutes: Record<string, string> = {
        department: '#/app.department',
        designation: '#/app.designation',
        grade: '#/app.grade',
        'team setup': '#/app.team',
        'label setup': '#/app.label',
      };

      const route = moduleRoutes[record.module];
      if (!route) return false;

      const baseUrl = this.page.url().replace(/\/#\/.+$/, '').replace(/\/#$/, '');
      await this.page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await this.page.waitForTimeout(3000);

      // Search for the record in the grid
      const row = this.page.locator('.k-grid-content tbody tr').filter({ hasText: record.name }).first();
      if (!await row.isVisible({ timeout: 5000 })) return false;

      // Click delete/action button on the row
      const deleteBtn = row.locator('.k-grid-delete, button:has-text("Delete"), .action-btn.delete').first();
      if (await deleteBtn.isVisible({ timeout: 3000 })) {
        await deleteBtn.click({ timeout: 5000 });

        // Confirm deletion if dialog appears
        const confirmBtn = this.page.locator('button:has-text("Ok"), button:has-text("Yes"), button:has-text("Confirm")').first();
        if (await confirmBtn.isVisible({ timeout: 3000 })) {
          await confirmBtn.click({ timeout: 5000 });
        }

        await this.page.waitForTimeout(1000);
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }
}

/**
 * Generate unique test data for use in tests that don't need full TestDataService.
 * Static helpers for quick unique values.
 */
export const TestDataHelpers = {
  uniqueName: (base: string): string => {
    const suffix = Date.now().toString(36).slice(-6);
    return `${base}_${suffix}`;
  },

  uniqueShortCode: (base: string, maxLength: number = 5): string => {
    const ts = Date.now().toString(36).slice(-4);
    const available = Math.max(1, maxLength - ts.length);
    return `${base.slice(0, available)}${ts}`.slice(0, maxLength);
  },

  uniqueNumber: (base: number = 1000): number => {
    const offset = Math.floor(Date.now() / 1000) % 10000;
    return base + offset;
  },
};
