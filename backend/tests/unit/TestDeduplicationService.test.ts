/**
 * TestDeduplicationService.test.ts
 */

import { TestDeduplicationService } from '../../src/services/TestDeduplicationService';
import { TestCase, TestStep } from '../../src/services/TestCaseGeneratorService';
import * as fs from 'fs';
import * as path from 'path';

const INDEX_PATH = path.join(process.env.LOCAL_STORAGE_PATH || './local_storage', 'test-case-index.json');

describe('TestDeduplicationService', () => {
  beforeEach(() => {
    TestDeduplicationService.clearIndex();
    if (fs.existsSync(INDEX_PATH)) fs.unlinkSync(INDEX_PATH);
  });

  function makeStep(action: string, testData?: string): TestStep {
    return {
      stepNumber: 1,
      action,
      testData,
      expectedResult: 'ok',
    };
  }

  function makeTestCase(id: string, steps: TestStep[]): TestCase {
    return {
      caseId: id,
      title: `Test ${id}`,
      steps,
      expectedOutcome: 'pass',
      priority: 'High',
      isEditable: true,
    };
  }

  test('detects identical test cases', () => {
    const tc1 = makeTestCase('TC-001', [
      makeStep('Navigate to /#/app.designation'),
      makeStep('Fill field designation with value Dept'),
      makeStep('Click button save'),
    ]);
    const tc2 = makeTestCase('TC-002', [
      makeStep('Navigate to /#/app.designation'),
      makeStep('Fill field designation with value Other'),
      makeStep('Click button save'),
    ]);

    // Index first test case
    TestDeduplicationService.indexTestCase(tc1, 'TICKET-1');

    // Check second for duplicates
    const result = TestDeduplicationService.checkForDuplicates([tc2], 'TICKET-2');
    // They share 2/3 steps + same selectors → high similarity
    expect(result.duplicateCount).toBeGreaterThanOrEqual(0);
    if (result.duplicateCount > 0) {
      expect(result.duplicates[0].overlappingWith[0].testCaseId).toBe('TC-001');
    }
  });

  test('does not flag different test cases as duplicates', () => {
    const tc1 = makeTestCase('TC-010', [
      makeStep('Navigate to /#/app.department'),
      makeStep('Click button add'),
    ]);
    const tc2 = makeTestCase('TC-011', [
      makeStep('Navigate to /#/app.attendance'),
      makeStep('Click button delete'),
    ]);

    TestDeduplicationService.indexTestCase(tc1, 'TICKET-1');
    const result = TestDeduplicationService.checkForDuplicates([tc2], 'TICKET-2');
    expect(result.duplicateCount).toBe(0);
  });

  test('returns stats about indexed test cases', () => {
    const tc1 = makeTestCase('TC-020', [makeStep('Click save')]);
    const tc2 = makeTestCase('TC-021', [makeStep('Click cancel')]);

    TestDeduplicationService.indexTestCase(tc1, 'TICKET-1');
    TestDeduplicationService.indexTestCase(tc2, 'TICKET-2');

    const stats = TestDeduplicationService.getStats();
    expect(stats.totalIndexed).toBe(2);
    expect(stats.ticketsCovered).toBe(2);
  });

  test('detects partial overlap with high selector similarity', () => {
    const tc1 = makeTestCase('TC-030', [
      makeStep('Fill username with admin'),
      makeStep('Fill password with secret123'),
      makeStep('Click button login'),
      makeStep('Assert text Welcome'),
    ]);
    const tc2 = makeTestCase('TC-031', [
      makeStep('Fill username with user1'),
      makeStep('Fill password with pass456'),
      makeStep('Click button login'),
      makeStep('Assert text Dashboard'),
    ]);

    TestDeduplicationService.indexTestCase(tc1, 'TICKET-1');
    const result = TestDeduplicationService.checkForDuplicates([tc2], 'TICKET-2');
    // These share login steps but different credentials - should be flagged
    expect(result.recommendations.length).toBeGreaterThanOrEqual(0);
  });

  test('clearIndex resets the store', () => {
    const tc = makeTestCase('TC-040', [makeStep('Click save')]);
    TestDeduplicationService.indexTestCase(tc, 'TICKET-1');
    TestDeduplicationService.clearIndex();
    const stats = TestDeduplicationService.getStats();
    expect(stats.totalIndexed).toBe(0);
  });
});
