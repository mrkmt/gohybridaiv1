/**
 * ModuleRouteRegistry
 *
 * Single source of truth for module name → hash route mappings.
 * Both discover-page.ts (CLI) and TestingDiscoveryService (runtime) import from here.
 * AiModuleResolverService uses getCanonicalNames() as the constraint set so AI
 * cannot hallucinate unknown modules.
 */

export type ModuleRoute = [hashRoute: string, canonicalName: string];

export const MODULE_ROUTES: ModuleRoute[] = [
  // ── HR Setup ────────────────────────────────────────────────────────────────
  ['#/app.designation',           'Designation'],
  ['#/app.department',            'Department'],
  ['#/app.grade',                 'Grade'],
  ['#/app.section',               'Section'],
  ['#/app.division',              'Division'],
  ['#/app.group',                 'Group'],
  ['#/app.costCenter',            'Cost Center'],
  ['#/app.location',              'Location'],
  ['#/app.company',               'Company Profile'],
  ['#/app.teamsetup',             'Team Setup'],
  ['#/app.labelsetup',            'Label Setup'],
  ['#/app.keywordsetup',          'Keyword'],
  ['#/app.publicHoliday',         'Public Holiday'],
  ['#/app.gpsLocation',           'GPS Location'],
  ['#/app.shift',                 'Shift'],
  ['#/app.alternativeworkday',    'Alternative Work Day'],

  // ── Employee ─────────────────────────────────────────────────────────────
  ['#/app.employee',              'Employee'],
  ['#/app.employeeDocument',      'Employee Document'],
  ['#/app.employeePolicy',        'Employee Policy'],
  ['#/app.employeeResignation',   'Employee Resignation'],
  ['#/app.employeeAS',            'Employee Additional Setup'],
  ['#/app.bankInfo',              'Bank Info'],
  ['#/app.userEmployeeAccess',    'User Employee Access'],
  ['#/app.contractemployee',      'Contract Employee'],
  ['#/app.transfer',              'Transfer'],

  // ── Leave ────────────────────────────────────────────────────────────────
  ['#/app.leaveType',             'Leave Type'],
  ['#/app.leavepolicy',           'Leave Policy'],
  ['#/app.groupPolicy',           'Group Policy'],
  ['#/app.leaveRequest',          'Leave Request'],
  ['#/app.leaveApprove',          'Leave Approve'],
  ['#/app.openingLeaveBalance',   'Opening Leave Balance'],
  ['#/app.generateLeave',         'Generate Leave'],
  ['#/app.leaveBalanceReport',    'Leave Balance Report'],

  // ── Attendance ────────────────────────────────────────────────────────────
  ['#/app.myattendance',          'Time Attendance'],
  ['#/app.attendanceRule',        'Attendance Rule'],
  ['#/app.attendanceRequest',     'Attendance Request'],
  ['#/app.attendanceApprove',     'Attendance Approve'],
  ['#/app.attendanceEditor',      'Attendance Editor'],
  ['#/app.attendanceCalculation', 'Attendance Calculate'],
  ['#/app.manualAttendance',      'Manual Attendance'],
  ['#/app.dutyRoster',            'Duty Roster'],
  ['#/app.autoShiftAssignment',   'Auto Shift Assignment'],
  ['#/app.generateAttendance',    'Generate Attendance'],
  ['#/app.otRequest',             'OT Request'],
  ['#/app.otApprove',             'OT Approve'],

  // ── Payroll ───────────────────────────────────────────────────────────────
  ['#/app.paymentTitle',          'Payment Title'],
  ['#/app.paymentdefinition',     'Payment Definition'],
  ['#/app.payrollrule',           'Payroll Rule'],
  ['#/app.salaryscale',           'Salary Scale'],
  ['#/app.salaryAdjustment',      'Salary Adjustment'],
  ['#/app.additionNdeduction',    'Addition & Deduction'],
  ['#/app.paymentcalculation',    'Payment Calculation'],
  ['#/app.paymentApprove',        'Payment Approve'],
  ['#/app.loanAdvanceSaving',     'Loan Advance Saving'],

  // ── Appraisal ─────────────────────────────────────────────────────────────
  ['#/app.appraisalcycles',       'Appraisal Cycles'],
  ['#/app.appraisaltemplate',     'Appraisal Templates'],
  ['#/app.appraisaldashboard',    'Appraisal Dashboard'],
  ['#/app.appraisalstatus',       'Appraisal Status'],
  ['#/app.kpimetric',             'KPI Metric'],
  ['#/app.kpiassignment',         'KPI Assignment'],
  ['#/app.kpireport',             'KPI Report'],

  // ── Recruitment ───────────────────────────────────────────────────────────
  ['#/app.jobpostlist',           'Job Post List'],
  ['#/app.candidateList',         'Candidate List'],

  // ── Training ──────────────────────────────────────────────────────────────
  ['#/app.coursemanagement',      'Course Management'],
  ['#/app.trainingassignments',   'Training Assignments'],

  // ── User & Access ─────────────────────────────────────────────────────────
  ['#/app.userLevelControl',      'User Level'],
  ['#/app.userLevelAssignment',   'User Level Assignment'],
  ['#/app.approverSetting',       'Approver Setting'],
  ['#/app.approverAssign',        'Approver Assign'],

  // ── Reports & Other ───────────────────────────────────────────────────────
  ['#/app.myperformancejournal',  'My Performance Journal'],
  ['#/app.announcement',          'Announcement'],
  ['#/app.customField',           'Custom Field'],
  ['#/app.applicationOption',     'Application Option'],
];

/** All canonical module names — used as constraint set for AI resolver. */
export function getCanonicalNames(): string[] {
  return MODULE_ROUTES.map(([, name]) => name);
}

/** Find route for a canonical module name (case-insensitive). */
export function findRouteByModule(moduleName: string): string | null {
  const lower = moduleName.toLowerCase().replace(/^my\s+/, '').trim();
  const match = MODULE_ROUTES.find(([, name]) => {
    const n = name.toLowerCase().replace(/^my\s+/, '').trim();
    return n === lower || name.toLowerCase() === moduleName.toLowerCase();
  });
  return match ? match[0] : null;
}

/** Derive a best-guess route for unknown modules (existing fallback pattern). */
export function deriveRoute(moduleName: string): string {
  return `#/app.${moduleName.toLowerCase().replace(/\s+/g, '')}`;
}
