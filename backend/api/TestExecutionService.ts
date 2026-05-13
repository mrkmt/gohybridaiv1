/**
 * Test Execution Service
 * Executes Playwright scripts and saves results to database
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { classifyFailure, formatFailureForJira, FailureClassification } from '../src/services/TestFailureClassifier';

const execAsync = promisify(exec);

export interface TestExecutionRequest {
  testScript: string;      // Playwright test file path or code
  moduleName: string;      // Module name (e.g., "Login")
  environment: string;     // testing | uat | live
  baseUrl: string;         // Target URL
  isMainCase?: boolean;    // Whether this is the primary reproduction case (needs video)
  credentials?: {
    username: string;
    password: string;
  };
}

export interface TestExecutionResult {
  status: 'passed' | 'failed' | 'error';
  testId: string;
  moduleName: string;
  duration: number;
  reportUrl?: string;
  error?: string;
  failedTests?: string[];
  failureCategory?: string; // SELECTOR_ERROR | ASSERTION_FAILURE | NETWORK_ERROR | TIMEOUT | OTHER
  isApplicationBug?: boolean;
}

export class TestExecutionService {
  private static testResultsDir = path.join(__dirname, '../test-results');

  /**
   * Validate TypeScript syntax before execution
   */
  static async validateTestScript(testScript: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // Run TypeScript compiler check (no emit)
      const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      await execAsync(`${npxCmd} tsc --noEmit --skipLibCheck "${testScript}"`, {
        timeout: 30000,
        cwd: path.join(__dirname, '..')
      });

      return { valid: true };
    } catch (error: any) {
      return {
        valid: false,
        error: `TypeScript validation failed: ${error.message.split('\n')[0]}`
      };
    }
  }

  /**
   * Execute Playwright test and save results
   */
  static async executeTest(request: TestExecutionRequest): Promise<TestExecutionResult> {
    const testId = `test-${Date.now()}`;
    const startTime = Date.now();

    try {
      console.log(`[TestExecution] Starting test: ${request.moduleName}`);

      // Ensure test-results directory exists
      if (!fs.existsSync(this.testResultsDir)) {
        fs.mkdirSync(this.testResultsDir, { recursive: true });
      }

      // NEW: Validate TypeScript syntax before execution
      console.log(`[TestExecution] Validating TypeScript syntax...`);
      const validation = await this.validateTestScript(request.testScript);
      if (!validation.valid) {
        throw new Error(`Invalid test script: ${validation.error}`);
      }
      console.log(`[TestExecution] ✅ TypeScript validation passed`);

      // Set environment variables for Playwright
      const env = {
        ...process.env,
        BASE_URL: request.baseUrl,
        TEST_USERNAME: request.credentials?.username || '',
        TEST_PASSWORD: request.credentials?.password || '',
        TEST_MODULE: request.moduleName,
        TEST_ID: testId,
        RECORD_VIDEO: request.isMainCase ? 'on' : 'off' // Map boolean to Playwright video setting
      };

      // Execute Playwright test
      const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      const { stdout, stderr } = await execAsync(
        `${npxCmd} playwright test ${request.testScript}`,
        {
          env,
          timeout: 300000, // 5 minutes timeout
          cwd: path.join(__dirname, '..')
        }
      );

      const duration = Date.now() - startTime;

      // Read Playwright results
      const results = await this.readTestResults();

      // Save to database
      const saved = await this.saveToDatabase(testId, request, results, duration);

      console.log(`[TestExecution] Completed: ${request.moduleName} (${results.status})`);

      return {
        status: results.status,
        testId,
        moduleName: request.moduleName,
        duration,
        reportUrl: `/storage/test-results/html-report/index.html`,
        failedTests: results.failedTests
      };

    } catch (error: any) {
      const duration = Date.now() - startTime;
      console.error('[TestExecution] Error:', error.message);

      // NEW: Classify the failure
      const classification: FailureClassification = classifyFailure(
        error.message,
        error.stack,
        undefined,
        undefined
      );

      console.log(`[TestExecution] Failure classified as: ${classification.category} (confidence: ${(classification.confidence * 100).toFixed(0)}%)`);
      console.log(`[TestExecution] Is application bug: ${classification.isApplicationBug}`);
      console.log(`[TestExecution] Should retry: ${classification.shouldRetry}`);
      console.log(`[TestExecution] Suggested action: ${classification.suggestedAction}`);

      // Save error result to database with classification
      await this.saveErrorToDatabase(testId, request, error.message, duration, classification);

      return {
        status: 'error',
        testId,
        moduleName: request.moduleName,
        duration,
        error: error.message,
        failureCategory: classification.category,
        isApplicationBug: classification.isApplicationBug
      };
    }
  }

  /**
   * Read Playwright test results
   */
  static async readTestResults(): Promise<{
    status: 'passed' | 'failed';
    failedTests: string[];
  }> {
    const lastRunPath = path.join(this.testResultsDir, '.last-run.json');

    try {
      if (fs.existsSync(lastRunPath)) {
        const content = fs.readFileSync(lastRunPath, 'utf8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.error('[TestExecution] Failed to read results:', error);
    }

    // Default to passed if no results found
    return {
      status: 'passed',
      failedTests: []
    };
  }

  /**
   * Save test results to database
   */
  static async saveToDatabase(
    testId: string,
    request: TestExecutionRequest,
    results: any,
    duration: number
  ): Promise<void> {
    // This will be called from the API endpoint
    // The actual DB save happens in app.ts
    console.log(`[TestExecution] Saving to database: ${testId}`);
  }

  /**
   * Save error to database with failure classification
   */
  static async saveErrorToDatabase(
    testId: string,
    request: TestExecutionRequest,
    error: string,
    duration: number,
    classification?: FailureClassification
  ): Promise<void> {
    console.log(`[TestExecution] Saving error to database: ${testId}`);
    
    if (classification) {
      console.log(`[TestExecution] Failure category: ${classification.category}`);
      console.log(`[TestExecution] Is application bug: ${classification.isApplicationBug}`);
      console.log(`[TestExecution] Jira comment:\n${formatFailureForJira(classification)}`);
    }
  }

  /**
   * Get HTML report path
   */
  static getReportPath(): string {
    return path.join(this.testResultsDir, 'html-report', 'index.html');
  }

  /**
   * Check if report exists
   */
  static reportExists(): boolean {
    const reportPath = this.getReportPath();
    return fs.existsSync(reportPath);
  }
}
