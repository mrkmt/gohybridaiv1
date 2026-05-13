# Long-Term Plan: Testing Workspace & Multi-User Architecture

## 🎯 Vision
Transition Go-Hybrid AI from a single-user chat tool into a scalable **Enterprise Testing Workspace**. The system will support multiple concurrent testers, provide global administrative oversight, and manage tests as a permanent module-based regression library rather than just transient Jira tickets.

---

## 🏗️ 1. The "Test Explorer" UI (Primary View)
Move away from a Chat-only interface to a structured dashboard with three distinct visibility levels:

### A. My Workspace (Personal View)
*   **Focus**: Jira tickets assigned to the logged-in user.
*   **Auto-Filter**: Automatically shows tickets in "In Testing" or "Ready for Test" status.
*   **Action**: One-click "Start Auto-Test" or "Review Results".

### B. Team Dashboard (Collaborative View)
*   **Live Feed**: Shows all active test executions across the whole team.
*   **Conflict Prevention**: If a ticket is already being tested by User A, User B sees a "Busy" badge and a "Join Session" button to watch the live stream instead of starting a duplicate run.
*   **Status Indicators**: Real-time pass/fail counters for the current sprint.

### C. Admin Console (Global View)
*   **Resource Monitor**: View BullMQ queue depth and active Playwright browser contexts.
*   **Cost Management**: Track Vertex AI token usage per project/module.
*   **System Health**: Sentry error feed and database backup status.

---

## 📂 2. Hierarchical Ticket & Module Management
Instead of treating every ticket as an isolated event, organize knowledge hierarchically:

1.  **Project Level**: Group tickets by Jira Project Key (e.g., `ATT`, `HR`, `PAY`).
2.  **Module Level**: Group tests by system module (e.g., `Attendance`, `Payroll`, `Performance`).
    *   *Long-Term Goal*: Build a "Module Regression Suite" where passing scripts from individual tickets are automatically added to a permanent library for that module.
3.  **Ticket Type Intelligence**:
    *   **BUG**: Switches AI to "Reproduction Mode" (expecting failure first).
    *   **STORY**: Switches AI to "Verification Mode" (Happy Path + Edge Cases).
    *   **DONE**: Moves scripts to read-only "Regression" status.

---

## ⚙️ 3. Backend Architecture Enhancements

### A. Multi-User WebSocket Broadcasting (Channels)
*   Upgrade the current WebSocket logic to use **Rooms/Channels** based on `ticketId`.
*   All users interested in `ATT-22` will join the `ticket:ATT-22` room and receive the same execution logs, reducing backend overhead.

### B. Execution Guardrails & Deduplication
*   **State Machine**: Enforce strict status transitions. A ticket cannot move to `EXECUTING` if it's already in the queue.
*   **User Attribution**: Every test run is tagged with the `userId`. The database will track who ran which test and when.

### C. Workspace API
*   `GET /api/workspace/summary`: Aggregate stats for the dashboard.
*   `GET /api/workspace/tickets`: Filtered, paginated list of tickets with integrated Go-Hybrid AI metadata (last run date, pass rate).

---

## 📈 4. Roadmap to Implementation

### Step 1: Design Phase (Later)
*   Finalize Figma/Mockups for the "Test Explorer" grid view.
*   Define the JSON schema for the new Workspace API.

### Step 2: Foundation (Phase 3 Backend)
*   Implement the `TestingWorkspaceController`.
*   Update WebSocket logic to support multi-user broadcasting.

### Step 3: Frontend Rollout
*   Add the "Explorer" toggle to the sidebar.
*   Onboard the Admin Console for system oversight.

### Step 4: Regression Automation
*   Enable "Module-Level" test execution (running all tests for "Payroll" in one click).
