/**
 * FlakinessTracker.test.ts
 */

import { FlakinessTracker, recordTestExecution, getFlakinessReport } from '../../src/services/FlakinessTracker';
import * as fs from 'fs';
import * as path from 'path';

const STORE_PATH = path.join(process.env.LOCAL_STORAGE_PATH || './local_storage', 'flakiness-tracker.json');

describe('FlakinessTracker', () => {
  beforeEach(() => {
    // Reset singleton and clear store
    (FlakinessTracker as any).instance = null;
    if (fs.existsSync(STORE_PATH)) fs.unlinkSync(STORE_PATH);
  });

  test('records a single execution and saves to store', () => {
    recordTestExecution('TC-001', 'TICKET-1', 'PASS');
    const store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
    expect(store['TC-001']).toHaveLength(1);
    expect(store['TC-001'][0].status).toBe('PASS');
    expect(store['TC-001'][0].ticketId).toBe('TICKET-1');
  });

  test('tracks multiple executions and calculates flakiness', () => {
    for (let i = 0; i < 6; i++) {
      recordTestExecution('TC-002', 'TICKET-1', i % 2 === 0 ? 'PASS' : 'FAIL');
    }
    const report = getFlakinessReport('TC-002');
    expect(report).not.toBeNull();
    expect(report!.totalExecutions).toBe(6);
    expect(report!.isFlaky).toBe(true);
    expect(report!.flakyReason).toContain('failure rate');
  });

  test('returns null for unknown test case', () => {
    const report = getFlakinessReport('NONEXISTENT');
    expect(report).toBeNull();
  });

  test('returns insufficient data for few executions', () => {
    recordTestExecution('TC-003', 'TICKET-1', 'PASS');
    recordTestExecution('TC-003', 'TICKET-1', 'PASS');
    const report = getFlakinessReport('TC-003');
    expect(report).not.toBeNull();
    expect(report!.isFlaky).toBe(false);
    expect(report!.flakyReason).toContain('Insufficient data');
  });

  test('detects high failure rate as flaky', () => {
    // 7 passes, 3 failures in 10 executions
    for (let i = 0; i < 7; i++) recordTestExecution('TC-004', 'TICKET-1', 'PASS');
    for (let i = 0; i < 3; i++) recordTestExecution('TC-004', 'TICKET-1', 'FAIL', { errorMessage: 'Timeout' });
    const report = getFlakinessReport('TC-004');
    expect(report).not.toBeNull();
    expect(report!.failCount).toBe(3);
    expect(report!.passCount).toBe(7);
    expect(report!.commonErrors).toHaveLength(1);
    expect(report!.commonErrors![0].message).toBe('Timeout');
  });

  test('getAllReports returns sorted flaky tests first', () => {
    recordTestExecution('TC-005', 'TICKET-1', 'PASS');
    for (let i = 0; i < 5; i++) {
      recordTestExecution('TC-006', 'TICKET-2', i % 2 === 0 ? 'PASS' : 'FAIL');
    }
    const tracker = FlakinessTracker.getInstance();
    const reports = tracker.getAllReports();
    const flakyFirst = reports.find((r: any) => r.testCaseId === 'TC-006');
    expect(flakyFirst).toBeDefined();
    expect(flakyFirst!.isFlaky).toBe(true);
  });

  test('clearHistory removes records for a test case', () => {
    recordTestExecution('TC-007', 'TICKET-1', 'PASS');
    const tracker = FlakinessTracker.getInstance();
    tracker.clearHistory('TC-007');
    expect(getFlakinessReport('TC-007')).toBeNull();
  });

  test('tracks healing success rate for flakiness detection', () => {
    // Mix of healing attempts that sometimes succeed
    recordTestExecution('TC-008', 'TICKET-1', 'FAIL', { healingAttempted: true, healingSucceeded: false, errorMessage: 'E1' });
    recordTestExecution('TC-008', 'TICKET-1', 'PASS', { healingAttempted: true, healingSucceeded: true });
    recordTestExecution('TC-008', 'TICKET-1', 'FAIL', { healingAttempted: true, healingSucceeded: false, errorMessage: 'E1' });
    recordTestExecution('TC-008', 'TICKET-1', 'PASS', { healingAttempted: true, healingSucceeded: true });
    recordTestExecution('TC-008', 'TICKET-1', 'FAIL', { healingAttempted: true, healingSucceeded: false, errorMessage: 'E2' });
    const report = getFlakinessReport('TC-008');
    expect(report).not.toBeNull();
    expect(report!.isFlaky).toBe(true);
    expect(report!.flakyReason).toContain('failure rate');
  });
});
