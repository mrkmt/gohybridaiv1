/**
 * frontend/kb-ui/src/types/index.ts
 *
 * Single source of truth for all frontend TypeScript types.
 * Mirrors backend/src/types/ — keep in sync when backend types change.
 * Components import from here, never define inline interfaces.
 */

// ─── Jira ─────────────────────────────────────────────────────────────────────
export type JiraTicketStatus =
  | 'To Do' | 'Open' | 'Backlog'
  | 'In Testing' | 'Testing' | 'QA' | 'In Progress'
  | 'Done' | 'Bug Done' | 'Closed' | 'Resolved';

export type JiraTicketType = 'Bug' | 'Story' | 'Task' | 'Epic' | 'Sub-task';

export interface LinkedTicket {
  key: string;
  type: 'bug' | 'dev' | 'story' | 'tested' | 'unknown';
  summary?: string;
}

/** GB (backlog/requirements) ticket linked via "tests for" relationship */
export interface GBTicketContext {
  key: string;
  summary: string;
  description: string;
  issueType: string;
  /** PO-written comments that typically contain acceptance criteria */
  comments: string[];
}

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
  /** Populated by backend after startSession() enriches the ticket with the linked GB ticket */
  gbContext?: GBTicketContext | null;
}

export interface TicketActions {
  canStart: boolean;
  canRetest: boolean;
  canAddScenarios: boolean;
  isReadOnly: boolean;
}

// ─── Pipeline phases ──────────────────────────────────────────────────────────
export type PipelinePhase =
  | 'idle' | 'ticket' | 'discovery' | 'scenarios'
  | 'testcases' | 'execution' | 'results';

// ─── Discovery ────────────────────────────────────────────────────────────────
export type DiscoveryStatus = 'cache_hit' | 'cache_miss' | 'crawling' | 'complete' | 'failed';

export interface DiscoveryInfo {
  status: DiscoveryStatus;
  cacheAge?: string;
  elementCount?: number;
  // `type` is optional and purely for UI hinting (button/input/dropdown).
  sampleSelectors?: Array<{ name: string; selector: string; type?: string }>;
  progress?: number;
  progressMessage?: string;
}

// ─── Scenarios ────────────────────────────────────────────────────────────────
export type ScenarioTag = 'Happy' | 'Negative' | 'Edge' | 'Regression' | 'Custom';
export type ScenarioSource = 'ai' | 'custom' | 'retest';

export interface TestScenario {
  id: string;
  label: string;
  tag: ScenarioTag;
  selected: boolean;
  source: ScenarioSource;
  fromFailedCase?: string;
}

// ─── Test cases ───────────────────────────────────────────────────────────────
export interface TestStep {
  id: string;
  action: string;
  element?: string;
  value?: string;
  selector?: string;
  assertType?: string;
  assertValue?: string;
  waitMs?: number;
}

export interface TestCase {
  id: string;
  name: string;
  scenarioId?: string;
  steps: TestStep[];
  status: TestResultStatus;
  approved: boolean;
}

// ─── Execution ────────────────────────────────────────────────────────────────
export type TestResultStatus = 'PASS' | 'FAIL' | 'CODE_FAULT' | 'RUNNING' | 'PENDING'
  | 'pass' | 'fail' | 'code_fault' | 'running' | 'pending';  // both cases supported

export interface TestStepResult {
  stepNumber: number;
  action: string;
  expectedResult: string;
  actualResult?: string;
  status: TestResultStatus;
  errorMessage?: string;
  duration: string;
}

export interface TestResult {
  caseId: string;
  caseName: string;
  status: TestResultStatus;
  duration: string;
  errorMessage?: string;
  forensicNote?: string;
  selectorHealed?: boolean;
  screenshotPath?: string;
  videoPath?: string;
  steps?: TestStepResult[];
}

export interface ExecutionSummary {
  passed: number;
  failed: number;
  codeFaults: number;
  total: number;
  iteration: number;
  duration: string;
}

// ─── Session ──────────────────────────────────────────────────────────────────
export type SessionPhase =
  | 'created' | 'discovery' | 'scenarios' | 'generation'
  | 'approved' | 'executing' | 'completed' | 'failed';

export interface TestSession {
  id: string;
  ticketId: string;
  userId: string;
  phase: SessionPhase;
  ticket: JiraTicket | null;
  scenarios: TestScenario[];
  testCases: TestCase[];
  approvedTestCases: boolean;
  results: TestResult[];
  summary: ExecutionSummary | null;
  iterationCount: number;
  confidenceAssessment: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

// ─── UI state (frontend-only, not persisted) ──────────────────────────────────
export interface SidebarSession {
  ticketId: string;
  ticketSummary: string;
  status: JiraTicketStatus;
  type: JiraTicketType;
  iterationCount: number;
  lastActive: Date;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export type MessagePayloadType =
  | 'ticket_card' | 'discovery_card' | 'scenarios_card'
  | 'testcases_card' | 'execution_card' | 'results_card' | 'status_transition';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  payload?: {
    type: MessagePayloadType;
    sessionId?: string;
  };
}

// ─── Confidence ───────────────────────────────────────────────────────────────
export interface ConfidenceAssessment {
  overall: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  requiresManualReview: boolean;
  breakdown: {
    moduleDetection: number;
    uiElements: { count: number; source: string; validated: boolean };
    businessRule: { source: string; gaps: string[] };
    skillPatterns: { count: number; quality: string };
    codeValidation: { compiles: boolean; selectorsValid: boolean };
  };
  recommendations: string[];
  assessedAt: string;
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
export interface WsExecutionLog {
  type: 'execution:log';
  payload: { ticketId: string; log: string };
  timestamp: string;
}

export interface WsExecutionProgress {
  type: 'execution:progress';
  payload: {
    ticketId: string;
    overallProgress: number;
    currentTestCase: string;
    completedCount: number;
    totalCount: number;
  };
  timestamp: string;
}

export interface WsExecutionComplete {
  type: 'execution:complete';
  payload: { ticketId: string; results: TestResult[]; summary: ExecutionSummary };
  timestamp: string;
}

export interface WsPipelineProgress {
  type: 'pipeline:progress';
  payload: { ticketId: string; phase: string; status: string; progress: number };
  timestamp: string;
}

export type WsMessage =
  | WsExecutionLog | WsExecutionProgress | WsExecutionComplete | WsPipelineProgress;
