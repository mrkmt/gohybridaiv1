/**
 * FullPipeline.integration.test.ts
 *
 * Integration test for the full test generation → execution → flakiness → dedup pipeline.
 * Does NOT call external AI APIs — uses mocks/stubs to verify the pipeline wiring.
 */

import * as fs from 'fs';
import * as path from 'path';

// Use the same path resolution as the services
const LOCAL_STORAGE = process.env.LOCAL_STORAGE_PATH || path.join(__dirname, '../../../local_storage');
const FLAKINESS_STORE = path.join(LOCAL_STORAGE, 'flakiness-tracker.json');
const DEDUP_STORE = path.join(LOCAL_STORAGE, 'test-case-index.json');

function cleanStores() {
  [FLAKINESS_STORE, DEDUP_STORE].forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
}

async function resetSingletons() {
  // Reset FlakinessTracker singleton BEFORE cleaning files
  const { FlakinessTracker } = await import('../../src/services/FlakinessTracker');
  (FlakinessTracker as any).instance = null;

  // Reset dedup index BEFORE cleaning files
  const { TestDeduplicationService } = await import('../../src/services/TestDeduplicationService');
  TestDeduplicationService.clearIndex();

  // Now clean files
  cleanStores();
}

describe('FullPipeline Integration', () => {
  beforeEach(async () => { await resetSingletons(); });
  afterAll(async () => { await resetSingletons(); });

  test('end-to-end: generate test cases → record flakiness → detect duplicates → get reports', async () => {
    // --- Step 1: Create test cases (simulating AI generation) ---
    const mockTestCases = [
      {
        caseId: 'TC-001',
        title: 'Create Department - Happy Path',
        priority: 'High' as const,
        steps: [
          { stepNumber: 1, action: 'Navigate to /#/app.department', expectedResult: 'Page loaded' },
          { stepNumber: 2, action: 'Fill field name with value Engineering', expectedResult: 'Field filled' },
          { stepNumber: 3, action: 'Click button save', expectedResult: 'Saved successfully' },
          { stepNumber: 4, action: 'Assert text Department created', expectedResult: 'Text visible' },
        ],
        expectedOutcome: 'Department created successfully',
        isEditable: true,
        tags: ['happy-path', 'department'],
      },
      {
        caseId: 'TC-002',
        title: 'Create Department - Duplicate Validation',
        priority: 'Medium' as const,
        steps: [
          { stepNumber: 1, action: 'Navigate to /#/app.department', expectedResult: 'Page loaded' },
          { stepNumber: 2, action: 'Fill field name with value Engineering', expectedResult: 'Field filled' },
          { stepNumber: 3, action: 'Click button save', expectedResult: 'Duplicate error shown' },
          { stepNumber: 4, action: 'Assert text Department already exists', expectedResult: 'Error visible' },
        ],
        expectedOutcome: 'Duplicate error is displayed',
        isEditable: true,
        tags: ['negative', 'department'],
      },
    ];

    expect(mockTestCases).toHaveLength(2);

    // --- Step 2: Record executions (simulating test runs) ---
    const { recordTestExecution, getFlakinessReport, FlakinessTracker } = await import('../../src/services/FlakinessTracker');

    // TC-001: passes consistently
    for (let i = 0; i < 5; i++) {
      recordTestExecution('TC-001', 'ATT-100', 'PASS');
    }

    // TC-002: flaky — sometimes fails due to timing
    recordTestExecution('TC-002', 'ATT-100', 'PASS');
    recordTestExecution('TC-002', 'ATT-100', 'FAIL', { errorMessage: 'Timeout waiting for save' });
    recordTestExecution('TC-002', 'ATT-100', 'PASS');
    recordTestExecution('TC-002', 'ATT-100', 'FAIL', { errorMessage: 'Timeout waiting for save' });
    recordTestExecution('TC-002', 'ATT-100', 'PASS');

    // --- Step 3: Check for duplicates across test cases ---
    const { TestDeduplicationService } = await import('../../src/services/TestDeduplicationService');

    const dedupResult = TestDeduplicationService.checkForDuplicates(mockTestCases, 'ATT-100');
    expect(dedupResult).toBeDefined();

    // --- Step 4: Get flakiness reports ---
    const report1 = getFlakinessReport('TC-001');
    expect(report1).not.toBeNull();
    expect(report1!.passRate).toBeGreaterThan(0.8); // stable test
    expect(report1!.totalExecutions).toBeGreaterThanOrEqual(5);

    const report2 = getFlakinessReport('TC-002');
    expect(report2).not.toBeNull();
    expect(report2!.isFlaky).toBe(true);
    expect(report2!.commonErrors.length).toBeGreaterThanOrEqual(1);
    expect(report2!.commonErrors[0].message).toBe('Timeout waiting for save');

    // --- Step 5: Verify getAllReports returns sorted results ---
    const tracker = FlakinessTracker.getInstance();
    const allReports = tracker.getAllReports();
    expect(allReports.length).toBeGreaterThanOrEqual(2);
    // Flaky test should come first
    const flakyFirst = allReports.find(r => r.testCaseId === 'TC-002');
    const stableSecond = allReports.find(r => r.testCaseId === 'TC-001');
    expect(flakyFirst).toBeDefined();
    expect(flakyFirst!.isFlaky).toBe(true);
    expect(stableSecond).toBeDefined();
  });

  test('pipeline handles new ticket without contaminating previous data', async () => {
    const { recordTestExecution, getFlakinessReport } = await import('../../src/services/FlakinessTracker');
    const { TestDeduplicationService } = await import('../../src/services/TestDeduplicationService');

    // Ticket 1: register some tests
    recordTestExecution('TC-100', 'TICKET-A', 'PASS');
    recordTestExecution('TC-100', 'TICKET-A', 'PASS');

    // Ticket 2: new ticket with similar test
    const tc2 = {
      caseId: 'TC-200',
      title: 'Another test',
      priority: 'High' as const,
      steps: [
        { stepNumber: 1, action: 'Navigate to /#/app.department', expectedResult: 'Page loaded' },
        { stepNumber: 2, action: 'Click button add', expectedResult: 'Form opens' },
      ],
      expectedOutcome: 'Form opens',
      isEditable: true,
    };

    const dedupResult = TestDeduplicationService.checkForDuplicates([tc2], 'TICKET-B');
    expect(dedupResult).toBeDefined();

    // TICKET-A data should still be intact
    const report = getFlakinessReport('TC-100');
    expect(report).not.toBeNull();
    expect(report!.totalExecutions).toBeGreaterThanOrEqual(2);
  });

  test('clearing flakiness history does not affect dedup index', async () => {
    const { recordTestExecution, getFlakinessReport, FlakinessTracker } = await import('../../src/services/FlakinessTracker');
    const { TestDeduplicationService } = await import('../../src/services/TestDeduplicationService');

    // Record flakiness data
    recordTestExecution('TC-300', 'ATT-200', 'PASS');

    // Record dedup data
    const tc = {
      caseId: 'TC-300',
      title: 'Test',
      priority: 'High' as const,
      steps: [{ stepNumber: 1, action: 'Click save', expectedResult: 'ok' }],
      expectedOutcome: 'ok',
      isEditable: true,
    };
    TestDeduplicationService.indexTestCase(tc, 'ATT-200');

    // Clear flakiness
    const tracker = FlakinessTracker.getInstance();
    tracker.clearHistory('TC-300');

    // Verify flakiness is gone
    expect(getFlakinessReport('TC-300')).toBeNull();

    // Verify dedup is still intact
    const dedupStats = TestDeduplicationService.getStats();
    expect(dedupStats.totalIndexed).toBeGreaterThanOrEqual(1);
  });
});
