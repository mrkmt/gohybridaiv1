/**
 * TestDeduplicationService.ts
 *
 * Detects overlapping test cases across tickets and suggests consolidation.
 * Compares steps, selectors, and assertion patterns to identify redundancy.
 */

import * as fs from 'fs';
import * as path from 'path';
import { TestCase, TestStep } from './generation/TestCaseGeneratorService';

export interface OverlapReport {
  testCaseId: string;
  ticketId: string;
  overlappingWith: {
    testCaseId: string;
    ticketId: string;
    overlapScore: number; // 0-1
    sharedSteps: string[];
    sharedSelectors: string[];
    recommendation: 'merge' | 'keep-both' | 'review';
  }[];
}

export interface DeduplicationResult {
  duplicates: OverlapReport[];
  uniqueCount: number;
  duplicateCount: number;
  recommendations: string[];
}

const DEDUP_STORE_PATH = path.join(
  process.env.LOCAL_STORAGE_PATH || './local_storage',
  'test-case-index.json'
);

interface TestCaseIndex {
  [testCaseId: string]: {
    ticketId: string;
    title: string;
    steps: string[]; // normalized step signatures
    selectors: string[]; // extracted selectors
    assertionPatterns: string[]; // extracted assertion patterns
    createdAt: string;
  };
}

function loadIndex(): TestCaseIndex {
  try {
    if (fs.existsSync(DEDUP_STORE_PATH)) {
      return JSON.parse(fs.readFileSync(DEDUP_STORE_PATH, 'utf-8'));
    }
  } catch (err: any) {
    console.warn(`[TestDedup] Failed to load index: ${err.message}`);
  }
  return {};
}

function saveIndex(index: TestCaseIndex): void {
  try {
    const dir = path.dirname(DEDUP_STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DEDUP_STORE_PATH, JSON.stringify(index, null, 2));
  } catch (err: any) {
    console.warn(`[TestDedup] Failed to save index: ${err.message}`);
  }
}

export class TestDeduplicationService {
  /**
   * Create a normalized signature for a test step.
   */
  private static stepSignature(step: TestStep): string {
    // Extract the core action, ignoring test-data specifics
    const action = (step.action || '').toLowerCase()
      .replace(/[a-f0-9]{8,}/g, '<ID>') // Replace UUIDs/hashes
      .replace(/\d+/g, '<N>') // Replace numbers
      .replace(/\s+/g, ' ')
      .trim();
    return action;
  }

  /**
   * Extract selectors from a test step.
   */
  private static extractSelectors(step: TestStep): string[] {
    const selectors: string[] = [];
    const action = step.action || '';

    // Extract CSS-like selectors
    const cssMatches = action.match(/\[?[a-zA-Z][\w-]*(?:\[[^\]]+\])?(?:\.[\w-]+)*(?::[a-z-]+(?:\([^\)]*\))?)?/g) || [];
    selectors.push(...cssMatches);

    // Extract quoted strings that look selectors
    const quotedMatches = action.match(/['"][^'"]*['"]/g) || [];
    for (const match of quotedMatches) {
      const clean = match.replace(/['"]/g, '');
      if (clean.includes('=') || clean.includes('.') || clean.includes('#') || clean.includes('[')) {
        selectors.push(clean);
      }
    }

    return [...new Set(selectors)]; // Deduplicate
  }

  /**
   * Extract assertion patterns from test steps.
   */
  private static extractAssertionPatterns(step: TestStep): string[] {
    const assertions: string[] = [];
    const action = (step.action || '').toLowerCase();

    if (action.includes('assert') || action.includes('expect') || action.includes('verify')) {
      assertions.push(action.substring(0, 80));
    }

    return assertions;
  }

  /**
   * Calculate Jaccard similarity between two sets.
   */
  private static jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
    if (setA.size === 0 && setB.size === 0) return 0;

    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);

    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  /**
   * Index a test case for deduplication comparison.
   */
  static indexTestCase(testCase: TestCase, ticketId: string): void {
    const index = loadIndex();

    index[testCase.caseId] = {
      ticketId,
      title: testCase.title,
      steps: testCase.steps.map(s => this.stepSignature(s)),
      selectors: testCase.steps.flatMap(s => this.extractSelectors(s)),
      assertionPatterns: testCase.steps.flatMap(s => this.extractAssertionPatterns(s)),
      createdAt: new Date().toISOString(),
    };

    saveIndex(index);
  }

  /**
   * Check new test cases against the index for duplicates.
   */
  static checkForDuplicates(
    testCases: TestCase[],
    ticketId: string,
    threshold: number = 0.7
  ): DeduplicationResult {
    const index = loadIndex();
    const duplicates: OverlapReport[] = [];
    const recommendations: string[] = [];

    for (const tc of testCases) {
      const report: OverlapReport = {
        testCaseId: tc.caseId,
        ticketId,
        overlappingWith: [],
      };

      const tcSteps = new Set(tc.steps.map(s => this.stepSignature(s)));
      const tcSelectors = new Set(tc.steps.flatMap(s => this.extractSelectors(s)));
      const tcAssertions = new Set(tc.steps.flatMap(s => this.extractAssertionPatterns(s)));

      for (const [existingId, existing] of Object.entries(index)) {
        const existingSteps = new Set(existing.steps);
        const existingSelectors = new Set(existing.selectors);
        const existingAssertions = new Set(existing.assertionPatterns);

        // Calculate combined similarity (steps + selectors + assertions)
        const stepSim = this.jaccardSimilarity(tcSteps, existingSteps);
        const selectorSim = this.jaccardSimilarity(tcSelectors, existingSelectors);
        const assertionSim = this.jaccardSimilarity(tcAssertions, existingAssertions);

        const combinedScore = (stepSim * 0.5) + (selectorSim * 0.3) + (assertionSim * 0.2);

        if (combinedScore >= threshold) {
          const sharedSteps = [...tcSteps].filter(s => existingSteps.has(s)).slice(0, 5);
          const sharedSelectors = [...tcSelectors].filter(s => existingSelectors.has(s)).slice(0, 5);

          let recommendation: 'merge' | 'keep-both' | 'review' = 'review';
          if (combinedScore >= 0.85) {
            recommendation = 'merge';
            recommendations.push(
              `Test ${tc.caseId} (${ticketId}) is ${Math.round(combinedScore * 100)}% similar to ${existingId} (${existing.ticketId}). Consider merging or using a shared test spec.`
            );
          } else if (combinedScore >= 0.7) {
            recommendation = 'keep-both';
            recommendations.push(
              `Test ${tc.caseId} (${ticketId}) shares some overlap with ${existingId} (${existing.ticketId}) but tests different aspects.`
            );
          }

          report.overlappingWith.push({
            testCaseId: existingId,
            ticketId: existing.ticketId,
            overlapScore: combinedScore,
            sharedSteps,
            sharedSelectors,
            recommendation,
          });
        }
      }

      if (report.overlappingWith.length > 0) {
        duplicates.push(report);
      }

      // Index this test case for future comparisons
      this.indexTestCase(tc, ticketId);
    }

    return {
      duplicates,
      uniqueCount: testCases.length - duplicates.length,
      duplicateCount: duplicates.length,
      recommendations,
    };
  }

  /**
   * Clear the deduplication index (for testing or reset).
   */
  static clearIndex(): void {
    saveIndex({});
  }

  /**
   * Get statistics about the indexed test cases.
   */
  static getStats(): { totalIndexed: number; ticketsCovered: number } {
    const index = loadIndex();
    const tickets = new Set(Object.values(index).map(e => e.ticketId));
    return {
      totalIndexed: Object.keys(index).length,
      ticketsCovered: tickets.size,
    };
  }
}
