// Mock data for the GoHybrid prototype

const SAMPLE_TICKETS = {
  'ATT-22': {
    id: 'ATT-22', key: 'ATT-22', type: 'Bug',
    status: 'In Testing',
    summary: 'Leave application fails when end date equals start date',
    description: 'Users submitting a leave request for a single day see a 500 error. The validation incorrectly rejects equal dates as invalid range. Impacts ~12% of single-day leave submissions across HR module.',
    module: 'HR / Leave Management',
    priority: 'High',
    linkedTickets: [
      { key: 'ATT-19', type: 'dev', summary: 'Fix boundary validation in LeaveValidator' },
      { key: 'ATT-14', type: 'story', summary: 'Leave application MVP' },
    ],
    iterationCount: 2,
  },
  'ATT-15': {
    id: 'ATT-15', key: 'ATT-15', type: 'Story',
    status: 'To Do',
    summary: 'Add export to CSV for timesheet reports',
    description: 'Managers should be able to export filtered timesheet views to CSV. Include all visible columns, respect active filters, UTF-8 with BOM for Excel compatibility.',
    module: 'Timesheet',
    priority: 'Medium',
    linkedTickets: [{ key: 'ATT-11', type: 'story', summary: 'Timesheet reporting baseline' }],
    iterationCount: 0,
  },
  'ATT-08': {
    id: 'ATT-08', key: 'ATT-08', type: 'Task',
    status: 'Done',
    summary: 'Migrate notification service to new queue',
    description: 'Switch notifications from in-process worker to dedicated RabbitMQ consumer. Ensure idempotency and dead-letter routing.',
    module: 'Platform',
    priority: 'Low',
    linkedTickets: [],
    iterationCount: 1,
    lastTested: { date: '2026-04-18', pass: 6, fail: 0, duration: '9.2s', by: 'GoHybrid auto-run' },
  },
  'ATT-04': {
    id: 'ATT-04', key: 'ATT-04', type: 'Bug',
    status: 'Bug Done',
    summary: 'Refactor login SSO fallback for Azure tenants',
    description: 'When Azure SSO returns a stale token, the fallback to form login loops. Fixed by clearing the MSAL cache on 401 from /me.',
    module: 'Auth',
    priority: 'High',
    linkedTickets: [{ key: 'ATT-02', type: 'bug', summary: 'Original MSAL cache bug' }],
    iterationCount: 3,
    lastTested: { date: '2026-04-15', pass: 4, fail: 0, duration: '11.4s', by: 'Linh Nguyen' },
  },
  'ATT-31': {
    id: 'ATT-31', key: 'ATT-31', type: 'Story',
    status: 'Done',
    summary: 'Attendance heatmap on team dashboard',
    description: 'Add a 30-day attendance heatmap on the team dashboard, grouped by department with drill-down to individual days.',
    module: 'Reports',
    priority: 'Medium',
    linkedTickets: [],
    iterationCount: 0,
    lastTested: null,
  },
};

const MOCK_SCENARIOS = [
  { id: 'sc-1', label: 'Submit leave where start date equals end date (same-day leave)', tag: 'Happy', selected: true, source: 'ai' },
  { id: 'sc-2', label: 'Reject submission when end date is before start date', tag: 'Negative', selected: true, source: 'ai' },
  { id: 'sc-3', label: 'Accept single-day leave that spans a weekend boundary', tag: 'Edge', selected: true, source: 'ai' },
  { id: 'sc-4', label: 'Verify leave balance decrements by exactly 1 day', tag: 'Regression', selected: true, source: 'ai' },
  { id: 'sc-5', label: 'Show validation error when reason field is empty', tag: 'Negative', selected: false, source: 'ai' },
  { id: 'sc-6', label: 'Approve workflow notifies manager via email', tag: 'Regression', selected: false, source: 'ai' },
];

const MOCK_SELECTORS = [
  { name: 'Leave form', selector: 'form[data-testid="leave-form"]', type: 'form' },
  { name: 'Start date', selector: 'input[name="startDate"]', type: 'input' },
  { name: 'End date', selector: 'input[name="endDate"]', type: 'input' },
  { name: 'Submit button', selector: 'button[data-action="submit-leave"]', type: 'button' },
];

const MOCK_TEST_CASES = [
  { id: 'TC-001', name: 'Same-day leave submits successfully with matching dates', scenarioId: 'sc-1', approved: false,
    steps: [
      { action: 'Navigate to /leave/new', expected: 'Leave request form renders with empty fields', data: '' },
      { action: 'Fill startDate and endDate with the same date', expected: 'Both inputs accept the value', data: 'startDate=2026-04-25, endDate=2026-04-25' },
      { action: 'Fill reason field', expected: 'Textarea holds the value', data: 'reason=Personal' },
      { action: 'Click "Submit"', expected: 'Toast shows "Leave submitted" and balance decrements by 1', data: '' },
    ] },
  { id: 'TC-002', name: 'Reject form when end date precedes start date with inline error', scenarioId: 'sc-2', approved: false,
    steps: [
      { action: 'Navigate to /leave/new', expected: 'Form renders', data: '' },
      { action: 'Set end date earlier than start date', expected: 'Inline validation error appears', data: 'startDate=2026-04-25, endDate=2026-04-24' },
      { action: 'Attempt to submit', expected: 'Submit button disabled; form is not posted', data: '' },
    ] },
  { id: 'TC-003', name: 'Single-day leave on Saturday decrements balance by 1 day', scenarioId: 'sc-3', approved: false,
    steps: [
      { action: 'Navigate to /leave/new', expected: 'Form renders with current balance = 24', data: '' },
      { action: 'Select Saturday for startDate and endDate', expected: 'Weekend warning shows but submission allowed', data: 'date=2026-04-25 (Sat)' },
      { action: 'Submit', expected: 'Balance shows 23 after refresh', data: '' },
    ] },
  { id: 'TC-004', name: 'Leave balance shows updated remaining days after approval', scenarioId: 'sc-4', approved: false,
    steps: [
      { action: 'Manager approves a pending leave', expected: 'Approval toast shown', data: 'leaveId=L-1042' },
      { action: 'Employee refreshes /leave', expected: 'Balance widget shows decremented value', data: '' },
    ] },
];

const MOCK_LOG_LINES = [
  { t: '12:04:21.103', c: 'muted', l: 'Playwright 1.42.0 · chromium · 1 worker' },
  { t: '12:04:21.441', c: 'muted', l: '⏵ TC-001 Same-day leave submits successfully with matching dates' },
  { t: '12:04:22.012', c: 'muted', l: '  ↳ goto https://staging.gohybrid.vn/leave/new' },
  { t: '12:04:22.889', c: 'muted', l: '  ↳ fill input[name="startDate"] = "2026-04-22"' },
  { t: '12:04:23.102', c: 'muted', l: '  ↳ fill input[name="endDate"] = "2026-04-22"' },
  { t: '12:04:23.411', c: 'muted', l: '  ↳ fill textarea[name="reason"] = "Personal"' },
  { t: '12:04:23.780', c: 'muted', l: '  ↳ click button[data-action="submit-leave"]' },
  { t: '12:04:24.991', c: 'pass',  l: '  ✓ expect(toast).toContainText("Leave submitted")  1211ms' },
  { t: '12:04:25.002', c: 'pass',  l: '✓ TC-001 passed (4.9s)' },
  { t: '12:04:25.203', c: 'muted', l: '⏵ TC-002 Reject form when end date precedes start date' },
  { t: '12:04:26.112', c: 'warn',  l: '  ⚠ selector "button.submit" stale — self-healed → button[data-action="submit-leave"]' },
  { t: '12:04:27.499', c: 'pass',  l: '  ✓ validation error visible  812ms' },
  { t: '12:04:27.510', c: 'pass',  l: '✓ TC-002 passed (2.3s, 1 healed)' },
  { t: '12:04:27.822', c: 'muted', l: '⏵ TC-003 Single-day leave on Saturday' },
  { t: '12:04:30.102', c: 'fail',  l: '  ✗ expect(balance).toBe(23) received 24  1944ms' },
  { t: '12:04:30.118', c: 'fail',  l: '✗ TC-003 failed (2.3s) — weekend boundary off-by-one' },
  { t: '12:04:30.400', c: 'muted', l: '⏵ TC-004 Leave balance updates after approval' },
  { t: '12:04:33.900', c: 'pass',  l: '✓ TC-004 passed (3.5s)' },
  { t: '12:04:34.002', c: 'muted', l: '— run complete · 3 passed · 1 failed · 13.1s' },
];

const MOCK_RESULTS = [
  { id: 'TC-001', name: 'Same-day leave submits successfully with matching dates', status: 'pass', duration: '4.9s' },
  { id: 'TC-002', name: 'Reject form when end date precedes start date with inline error', status: 'pass', duration: '2.3s', note: '1 selector healed automatically' },
  { id: 'TC-003', name: 'Single-day leave on Saturday decrements balance by 1 day', status: 'fail', duration: '2.3s', note: 'Expected balance 23, received 24 — off-by-one on weekend boundary' },
  { id: 'TC-004', name: 'Leave balance shows updated remaining days after approval', status: 'pass', duration: '3.5s' },
];

const SIDEBAR_SESSIONS = [
  { id: 'ATT-22', summary: 'Leave application fails when end date equals start date', status: 'In Testing', iter: 2 },
  { id: 'ATT-15', summary: 'Add export to CSV for timesheet reports', status: 'To Do', iter: 0 },
  { id: 'ATT-08', summary: 'Migrate notification service to new queue', status: 'Done', iter: 1 },
  { id: 'ATT-04', summary: 'Refactor login SSO fallback for Azure tenants', status: 'Done', iter: 3 },
];

const STATUS_DOT_COLOR = {
  'To Do': '#9FB0C9', 'In Testing': '#F5A524', 'Done': '#8ab84a', 'Bug Done': '#8ab84a', 'In Progress': '#F5A524'
};

const EXPLORER_TESTS = {
  playwright: [
    { id: 'pw-1', name: 'Leave · same-day submission', status: 'pass', time: '4.9s', tag: 'ATT-22' },
    { id: 'pw-2', name: 'Leave · end before start rejected', status: 'pass', time: '2.3s', tag: 'ATT-22' },
    { id: 'pw-3', name: 'Leave · weekend boundary balance', status: 'fail', time: '2.3s', tag: 'ATT-22' },
    { id: 'pw-4', name: 'Leave · balance after approval', status: 'pass', time: '3.5s', tag: 'ATT-22' },
    { id: 'pw-5', name: 'Timesheet · filter + CSV export', status: 'idle', time: '—', tag: 'ATT-15' },
    { id: 'pw-6', name: 'Timesheet · UTF-8 BOM for Excel', status: 'idle', time: '—', tag: 'ATT-15' },
  ],
  api: [
    { id: 'api-1', name: 'GET /api/leave/balance', status: 'pass', time: '210ms', tag: 'ATT-22' },
    { id: 'api-2', name: 'POST /api/leave/request', status: 'fail', time: '612ms', tag: 'ATT-22' },
    { id: 'api-3', name: 'GET /api/timesheet/export', status: 'idle', time: '—', tag: 'ATT-15' },
  ],
  regression: [
    { id: 'rg-1', name: 'Auth · SSO Azure tenant', status: 'pass', time: '1.8s', tag: 'ATT-04' },
    { id: 'rg-2', name: 'Notifications · queue ack', status: 'pass', time: '920ms', tag: 'ATT-08' },
  ],
};

Object.assign(window, {
  SAMPLE_TICKETS, MOCK_SCENARIOS, MOCK_SELECTORS, MOCK_TEST_CASES,
  MOCK_LOG_LINES, MOCK_RESULTS, SIDEBAR_SESSIONS, STATUS_DOT_COLOR, EXPLORER_TESTS,
});
