export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
    metadata?: {
        usage?: {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
        };
        model?: string;
        profile?: string;
    };
    actionBlock?: {
        type: 'start_testing' | 'test_cases' | 'execution' | 'results' | 'scenarios_selection' | 'test_cases_review' | 'environment_setup';
        ticketId?: string;
        ticketStatus?: string;
        testCases?: any[];
        scenarios?: any[];
    };
}

export interface ChatSession {
    id: string;
    title: string;
    messages: ChatMessage[];
    jiraId?: string;
    lastModified: number;
}
