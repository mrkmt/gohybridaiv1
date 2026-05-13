/**
 * Type definitions for test case generation
 */

export interface TestCase {
    caseId: string;
    title: string;
    description?: string;
    priority: 'High' | 'Medium' | 'Low';
    steps: TestStep[];
    expectedOutcome: string;
    preconditions?: string[];
    isEditable: boolean;
    isMain?: boolean;
    tags?: string[];
}

export interface TestStep {
    stepNumber: number;
    action: string;
    testData?: string;
    expectedResult: string;
    selectorHint?: string;
}

export interface TestCaseGenerationRequest {
    ticketId: string;
    summary: string;
    description?: string;
    aiModel?: string;
}

export interface TestCaseGenerationResponse {
    testCases: TestCase[];
    summary: string;
}
