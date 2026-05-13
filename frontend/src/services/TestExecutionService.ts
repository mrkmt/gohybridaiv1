/**
 * Type definitions for test execution
 */

export interface TestEnvironment {
    stage: 'testing' | 'uat' | 'live';
    baseUrl: string;
    username: string;
    password: string;
    customerId?: string;
    userLevel?: string;
    idNumber?: string;
    fullUrl?: string;
    browser?: 'chromium' | 'firefox' | 'webkit';
    headless?: boolean;
    timeout?: number;
    autoHeal?: boolean;
}

export interface TestResult {
    testCaseId: string;
    testCaseTitle: string;
    status: 'PASS' | 'FAIL' | 'SKIPPED';
    duration: number;
    videoPath?: string;
    screenshotPaths: string[];
    errorMessage?: string;
    steps: StepResult[];
    environment: string;
    executedAt: string;
    ticketId: string;
}

export interface StepResult {
    stepNumber: number;
    action: string;
    expectedResult: string;
    actualResult?: string;
    status: 'PASS' | 'FAIL' | 'SKIPPED';
    screenshotPath?: string;
    errorMessage?: string;
    duration: number;
}

export interface ExecutionProgress {
    ticketId: string;
    currentTestCaseId: string;
    totalTestCases: number;
    completedTestCases: number;
    currentStep?: number;
    totalSteps?: number;
    status: 'running' | 'completed' | 'failed';
    results: TestResult[];
}

export interface TestExecutionRequest {
    ticketId: string;
    environment: TestEnvironment;
    testCases?: string[]; // Optional: run specific test cases
}

export interface TestExecutionResponse {
    results: TestResult[];
    summary: {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
        passRate: number;
    };
    zipPath?: string;
    artifactsPath?: string;
}
