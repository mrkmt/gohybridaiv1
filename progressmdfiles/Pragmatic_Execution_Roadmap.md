# Pragmatic Execution Roadmap: Go-Hybrid AI

## Background & Motivation
The Go-Hybrid AI test execution platform is transitioning from a proof-of-concept to a reliable, multi-user production system. Initial testing revealed stability issues under load (e.g., OOM crashes due to unbound Playwright instances), blocking of the Node.js event loop due to simulated jobs, and missing observability. 

Previous roadmaps suggested adopting heavy frameworks like LangChain, which introduces unnecessary complexity and distracts from core system reliability. The motivation of this plan is ruthless prioritization: stabilizing the core execution loop, ensuring robust concurrency, and gaining deep observability before scaling further.

## Scope & Impact
This plan covers the immediate and mid-term tasks required to make the system production-ready for the QA team. It impacts the test execution orchestrator, browser pool management, error tracking, and AI generation prompts. It specifically scopes *out* unnecessary architectural overhauls (like switching AI orchestration frameworks) to focus on concrete fixes.

## Proposed Solution
A phased implementation focusing on:
1.  **Concurrency & Stability**: Replacing fake execution loops with real BullMQ workers and capping browser contexts.
2.  **Observability & Data Safety**: Integrating Sentry for real-time error tracking and scheduling automated database backups.
3.  **Execution Correctness**: Enhancing Playwright action mappings (specifically Kendo dropdowns) and fixing Agentic Executor's "Step 2" schema bugs.
4.  **Skill/Prompt Engineering**: Centralizing business rules and UI context to improve AI generation quality, without rewriting the orchestration engine.

## Alternatives Considered
-   **LangChain / Vercel AI SDK**: Considered for agentic execution. *Rejected* because the existing `AiControllerService` and `MultiAgentRouter` with Vertex AI structured outputs are already functional. The failures are due to prompt/schema mismatches, not the orchestration framework.
-   **Horizontal Scaling (Adding more VMs)**: Considered to handle concurrency. *Rejected* because the current system lacks local boundaries (browser pooling limits). Adding servers without fixing the application-level constraints would just lead to distributed OOM crashes.

## Phased Implementation Plan

### Phase 1: Core Reliability (Weeks 1-2)
*Focus: Stop crashes, blockages, and silent failures.*
1.  **BullMQ Real Workers & Deduplication (Critical)**:
    *   Remove `simulateJob()` from orchestrator.
    *   Implement dedicated BullMQ worker processes to handle `TestingExecutionOrchestrator.execute()`.
    *   Implement Ticket Deduplication using unique `jobId`s (e.g., `execution-ATT-22`) to prevent concurrent runs of the same ticket, streaming the single execution state to all interested clients.
2.  **Browser Concurrency Limit (Critical)**:
    *   Enforce `MAX_CONTEXTS=4` in `SharedBrowserPool`.
    *   Implement queuing for browser requests exceeding the limit.
3.  **Sentry Integration**:
    *   Initialize `@sentry/node` globally to catch unhandled exceptions and AI failures.
4.  **Database Backup**:
    *   Set up a nightly `pg_dump` cron job with 7-day retention.
5.  **Dropdown Mapping Fix**:
    *   Update `JSONToPlaywrightCompiler` to map dropdown actions to `browser_select_option` for Kendo UI.

### Phase 2: Agentic Schema & Execution (Weeks 2-3)
*Focus: Fix AI action generation and enable self-healing.*
1.  **Fix Agentic "Step 2" Bug**:
    *   Update `AgenticTestExecutor` to detect `undefined` targets in AI responses and return a prompt correction hint instead of throwing a validation error.
2.  **Hybrid Execution Integration**:
    *   Wire `TestingExecutionOrchestrator` to fallback to `AgenticTestExecutor` seamlessly when a strict replay step fails.
3.  **Centralized Prompt Module**:
    *   Create a module to inject specific business rules and element selectors (from Discovery cache) dynamically into the test generation prompt.

### Phase 3: QA Team Integration & Metrics (Week 4)
*Focus: Usability and performance monitoring.*
1.  **Jira Webhooks**:
    *   Trigger test execution automatically when a Jira ticket transitions to "In Testing".
2.  **Prometheus + Grafana**:
    *   Expose metrics (Playwright pool usage, BullMQ queue length) and build a basic dashboard.
3.  **Pilot Testing**:
    *   Onboard 2-3 manual QA testers to run real scenarios and gather UI/UX feedback.

## Verification & Testing
-   **Load Test**: Run 5 simultaneous ticket executions. Verification passes if memory stays within bounds and all 5 complete sequentially via BullMQ without crashing the Node process.
-   **Error Simulation**: Intentionally break a selector and verify that Sentry captures the event and the Agentic Executor successfully self-heals.

## Migration & Rollback
-   **Rollback**: The BullMQ transition can be toggled via a `.env` flag (e.g., `USE_BULLMQ=true/false`) to easily revert to the in-memory executor if the worker setup fails in production.
