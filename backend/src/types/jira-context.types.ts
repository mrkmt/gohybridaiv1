/**
 * Jira Context Types — shared across JiraContextBuilder, TicketClassifier, AttachmentAnalyzer
 * and injected into AgentOrchestrator prompt via JsonGenerationOptions.ticketClassification
 */

/** Platform the ticket targets */
export type Platform = 'web' | 'mobile' | 'api' | 'mixed';

/** Readiness of linked development tickets */
export type CompletionStatus = 'complete' | 'api_pending' | 'mobile_pending' | 'partial';

/** What should be tested given the current state of development */
export type TestingScope = 'full' | 'ui_only' | 'regression_only' | 'api_only';

/**
 * Fine-grained ticket subtype — drives which AI prompt template is used.
 *
 * Story subtypes:
 *   new_feature     — entirely new menu/feature
 *   enhancement     — adding to an existing menu/feature
 *   flow_change     — changing the sequence of an existing workflow
 *
 * Bug subtypes:
 *   reproduced_bug          — bug with confirmed reproduction steps
 *   live_bug                — reported by a live customer (production)
 *   testing_discovered_bug  — found during testing session
 */
export type TicketSubtype =
    | 'new_feature'
    | 'enhancement'
    | 'flow_change'
    | 'reproduced_bug'
    | 'live_bug'
    | 'testing_discovered_bug';

/** Lightweight summary of a linked ticket for classification */
export interface LinkedTicketSummary {
    key: string;
    summary: string;
    issueType: string;
    status: string;
    platform?: Platform;
    isComplete: boolean;
}

/** Attachment metadata — aiSummary filled by AttachmentAnalyzer when successful */
export interface AttachmentSummary {
    filename: string;
    mimeType: string;
    size: number;
    url: string;
    aiSummary?: string;
}

/** Rich context object for a Jira ticket — cached for 30 min in jira_context_cache */
export interface JiraTicketContext {
    ticketId: string;
    summary: string;
    description: string;
    issueType: string;
    status: string;
    labels: string[];
    components: string[];
    linkedTickets: LinkedTicketSummary[];
    attachments: AttachmentSummary[];
    cachedAt: string;
}

/**
 * Result of TicketClassifier.classify().
 * Injected as JsonGenerationOptions.ticketClassification → AgentOrchestrator prompt.
 */
export interface TicketClassification {
    platform: Platform;
    completionStatus: CompletionStatus;
    testingScope: TestingScope;
    ticketSubtype: TicketSubtype;
    /** Human-readable list of incomplete linked items (e.g. "GB-123: API not done") */
    incompleteItems: string[];
    /** Pre-built instruction block injected verbatim into the AI prompt */
    scopeInstructions: string;
}
