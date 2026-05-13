/**
 * FlakinessTracker.ts
 *
 * Tracks test execution history over time to detect flaky tests —
 * tests that intermittently pass and fail without code changes.
 *
 * A test is marked as flaky when it exhibits N failures mixed with M passes
 * within a configurable window of executions.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface TestExecutionRecord {
  testCaseId: string;
  ticketId: string;
  status: 'PASS' | 'FAIL';
  errorMessage?: string;
  timestamp: string;
  healingAttempted: boolean;
  healingSucceeded: boolean;
}

export interface FlakinessReport {
  testCaseId: string;
  totalExecutions: number;
  passCount: number;
  failCount: number;
  passRate: number; // 0-1
  isFlaky: boolean;
  flakyReason: string;
  recentFailures: TestExecutionRecord[];
  commonErrors: { message: string; count: number }[];
  recommendation: string;
}

export interface FlakinessConfig {
  /** Minimum number of executions before flakiness detection kicks in */
  minExecutions: number;
  /** Maximum failure rate for a test to be considered stable */
  maxFailureRate: number;
  /** Number of recent executions to analyze for flakiness */
  recentWindow: number;
  /** Alternating pass-fail-pass pattern threshold */
  alternationThreshold: number;
}

const DEFAULT_CONFIG: FlakinessConfig = {
  minExecutions: 5,
  maxFailureRate: 0.3, // 30% failure rate = flaky
  recentWindow: 10,
  alternationThreshold: 3, // 3+ alternations = flaky
};

const FLAKINESS_STORE_PATH = path.join(
  process.env.LOCAL_STORAGE_PATH || './local_storage',
  'flakiness-tracker.json'
);

/**
 * In-memory flakiness store (persisted to disk)
 */
interface FlakinessStore {
  [testCaseId: string]: TestExecutionRecord[];
}

function loadStore(): FlakinessStore {
  try {
    if (fs.existsSync(FLAKINESS_STORE_PATH)) {
      return JSON.parse(fs.readFileSync(FLAKINESS_STORE_PATH, 'utf-8'));
    }
  } catch (err: any) {
    console.warn(`[FlakinessTracker] Failed to load store: ${err.message}`);
  }
  return {};
}

function saveStore(store: FlakinessStore): void {
  try {
    const dir = path.dirname(FLAKINESS_STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FLAKINESS_STORE_PATH, JSON.stringify(store, null, 2));
  } catch (err: any) {
    console.warn(`[FlakinessTracker] Failed to save store: ${err.message}`);
  }
}

export class FlakinessTracker {
  private static instance: FlakinessTracker | null = null;
  private store: FlakinessStore;
  private config: FlakinessConfig;

  private constructor(config: FlakinessConfig = DEFAULT_CONFIG) {
    this.store = loadStore();
    this.config = config;
  }

  static getInstance(config?: FlakinessConfig): FlakinessTracker {
    if (!this.instance) {
      this.instance = new FlakinessTracker(config);
    }
    return this.instance;
  }

  /**
   * Record a test execution result for flakiness tracking.
   */
  recordExecution(record: TestExecutionRecord): void {
    const { testCaseId } = record;

    if (!this.store[testCaseId]) {
      this.store[testCaseId] = [];
    }

    // Keep only recent records to avoid unbounded growth
    const records = this.store[testCaseId];
    records.push(record);

    // Trim to last N executions (config window + buffer)
    const maxRecords = this.config.recentWindow * 3;
    if (records.length > maxRecords) {
      this.store[testCaseId] = records.slice(-maxRecords);
    }

    saveStore(this.store);
  }

  /**
   * Analyze a test case for flakiness based on execution history.
   */
  analyzeFlakiness(testCaseId: string): FlakinessReport | null {
    const records = this.store[testCaseId];
    if (!records || records.length === 0) return null;

    const recentRecords = records.slice(-this.config.recentWindow);
    const totalExecutions = records.length;

    // Don't analyze if not enough data
    if (totalExecutions < this.config.minExecutions) {
      return {
        testCaseId,
        totalExecutions,
        passCount: records.filter(r => r.status === 'PASS').length,
        failCount: records.filter(r => r.status === 'FAIL').length,
        passRate: 0,
        isFlaky: false,
        flakyReason: `Insufficient data (${totalExecutions}/${this.config.minExecutions} executions)`,
        recentFailures: [],
        commonErrors: [],
        recommendation: `Need ${this.config.minExecutions - totalExecutions} more executions to analyze`,
      };
    }

    const passCount = recentRecords.filter(r => r.status === 'PASS').length;
    const failCount = recentRecords.filter(r => r.status === 'FAIL').length;
    const passRate = recentRecords.length > 0 ? passCount / recentRecords.length : 0;
    const failureRate = 1 - passRate;

    const recentFailures = recentRecords.filter(r => r.status === 'FAIL');

    // Extract common error messages
    const errorCounts = new Map<string, number>();
    for (const failure of recentFailures) {
      if (failure.errorMessage) {
        // Normalize error messages for grouping
        const normalized = failure.errorMessage.substring(0, 100);
        errorCounts.set(normalized, (errorCounts.get(normalized) || 0) + 1);
      }
    }
    const commonErrors = Array.from(errorCounts.entries())
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    // Detect flakiness patterns
    const isFlaky = this.detectFlakyPattern(recentRecords, failureRate);

    let flakyReason = '';
    let recommendation = '';

    if (isFlaky) {
      if (failureRate > this.config.maxFailureRate) {
        flakyReason = `High failure rate: ${(failureRate * 100).toFixed(1)}% (${failCount}/${recentRecords.length})`;
        recommendation = 'Review test for timing issues, race conditions, or unstable selectors';
      } else if (this.detectAlternatingPattern(recentRecords)) {
        flakyReason = 'Alternating pass/fail pattern detected';
        recommendation = 'Check for race conditions, async timing, or environment-dependent behavior';
      } else {
        flakyReason = 'Inconsistent execution results';
        recommendation = 'Investigate environmental factors or test data dependencies';
      }
    } else {
      if (failureRate < 0.05) {
        flakyReason = 'Stable test';
        recommendation = 'No action needed';
      } else {
        flakyReason = `Elevated failure rate: ${(failureRate * 100).toFixed(1)}%`;
        recommendation = 'Monitor — consider reviewing if failure rate increases';
      }
    }

    return {
      testCaseId,
      totalExecutions,
      passCount,
      failCount,
      passRate,
      isFlaky,
      flakyReason,
      recentFailures,
      commonErrors,
      recommendation,
    };
  }

  /**
   * Get flakiness reports for all tracked tests.
   */
  getAllReports(): FlakinessReport[] {
    const reports: FlakinessReport[] = [];
    for (const testCaseId of Object.keys(this.store)) {
      const report = this.analyzeFlakiness(testCaseId);
      if (report) reports.push(report);
    }
    return reports.sort((a, b) => {
      // Flaky tests first, then by failure rate
      if (a.isFlaky !== b.isFlaky) return a.isFlaky ? -1 : 1;
      return b.failCount - a.failCount;
    });
  }

  /**
   * Clear history for a specific test case.
   */
  clearHistory(testCaseId: string): void {
    delete this.store[testCaseId];
    saveStore(this.store);
  }

  /**
   * Clear all history (useful for cleanup or reset).
   */
  clearAllHistory(): void {
    this.store = {};
    saveStore(this.store);
  }

  /**
   * Detect if a test is flaky based on execution patterns.
   */
  private detectFlakyPattern(records: TestExecutionRecord[], failureRate: number): boolean {
    if (records.length < this.config.minExecutions) return false;

    // Pattern 1: High failure rate (intermittent failures)
    if (failureRate > this.config.maxFailureRate && failureRate < 0.95) {
      return true; // Not 100% broken, but failing often = flaky
    }

    // Pattern 2: Alternating pass/fail pattern
    if (this.detectAlternatingPattern(records)) return true;

    // Pattern 3: Healing succeeds inconsistently
    const healingAttempts = records.filter(r => r.healingAttempted);
    if (healingAttempts.length >= 3) {
      const healingSuccessRate = healingAttempts.filter(r => r.healingSucceeded).length / healingAttempts.length;
      if (healingSuccessRate > 0.2 && healingSuccessRate < 0.8) {
        return true; // Healing is unreliable = flaky test
      }
    }

    return false;
  }

  /**
   * Detect alternating pass/fail pattern (e.g., PASS, FAIL, PASS, FAIL).
   */
  private detectAlternatingPattern(records: TestExecutionRecord[]): boolean {
    if (records.length < 4) return false;

    let alternations = 0;
    for (let i = 1; i < records.length; i++) {
      if (records[i].status !== records[i - 1].status) {
        alternations++;
      }
    }

    return alternations >= this.config.alternationThreshold;
  }
}

/**
 * Convenience function to record a test execution.
 */
export function recordTestExecution(
  testCaseId: string,
  ticketId: string,
  status: 'PASS' | 'FAIL',
  options?: {
    errorMessage?: string;
    healingAttempted?: boolean;
    healingSucceeded?: boolean;
  }
): void {
  const tracker = FlakinessTracker.getInstance();
  tracker.recordExecution({
    testCaseId,
    ticketId,
    status,
    errorMessage: options?.errorMessage,
    timestamp: new Date().toISOString(),
    healingAttempted: options?.healingAttempted || false,
    healingSucceeded: options?.healingSucceeded || false,
  });
}

/**
 * Convenience function to get a flakiness report.
 */
export function getFlakinessReport(testCaseId: string): FlakinessReport | null {
  const tracker = FlakinessTracker.getInstance();
  return tracker.analyzeFlakiness(testCaseId);
}
