
/**
 * backend/src/services/types.ts
 *
 * Single source of truth for backend-specific shared types.
 * Used by TestSessionService, JiraService, and Orchestrators.
 */

export interface LinkedTicket {
  key: string;
  type: 'bug' | 'dev' | 'story' | 'unknown';
  summary?: string;
}

export type JiraTicketStatus =
  | 'To Do' | 'Open' | 'Backlog'
  | 'In Testing' | 'Testing' | 'QA' | 'In Progress'
  | 'Done' | 'Bug Done' | 'Closed' | 'Resolved';

export type JiraTicketType = 'Bug' | 'Story' | 'Task' | 'Epic' | 'Sub-task';

export interface JiraTicket {
  id: string;
  key: string;
  type: JiraTicketType;
  status: JiraTicketStatus;
  summary: string;
  description: string;
  module: string;
  priority: 'High' | 'Medium' | 'Low' | 'Critical';
  linkedTickets: LinkedTicket[];
  iterationCount: number;
  gbTicket?: any; // For GB context resolution
}

export interface TestStep {
  id: string;
  action: string;
  element?: string;
  value?: string;
  selector?: string;
  assertType?: string;
  assertValue?: string;
  waitMs?: number;
  stepNumber?: number;
  expectedResult?: string;
  status?: string;
  errorMessage?: string;
}

export interface TestCase {
  id: string;
  caseId?: string; // Some legacy code uses caseId
  name: string;
  title?: string; // Some legacy code uses title
  scenarioId?: string;
  steps: TestStep[];
  status: string;
  approved: boolean;
  priority?: string;
  expectedOutcome?: string;
}

export interface TestResult {
  testCaseId: string;
  testCaseTitle: string;
  /** Frontend compatibility alias — same as testCaseId, populated by orchestrator */
  caseId?: string;
  /** Frontend compatibility alias — same as testCaseTitle, populated by orchestrator */
  caseName?: string;
  status: string;
  duration: number;
  errorMessage?: string;
  steps: any[];
  environment: string;
  executedAt: string;
  ticketId: string;
  isExecutionFault?: boolean;
  screenshotPaths?: string[];
  videoPath?: string;
  aiInsight?: any;
  uiStack?: 'Kendo UI' | 'PrimeNG' | 'Mixed' | 'Standard';
}

export interface ExecutionSummary {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  passRate: number;
  duration?: number;
  faults?: number;
}
