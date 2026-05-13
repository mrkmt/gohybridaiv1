# Long-Term Architecture Plan: Native-Level MCP Playwright Integration

## 1. Executive Summary
This document outlines the strategy to upgrade the Go-Hybrid AI Playwright integration to match the robustness and reliability of native agents (Gemini CLI / Claude CLI). The goal is to move from a fragile CSS-based execution model to a high-fidelity **Ref-Based / Accessibility-First** model.

---

## 2. Core Problem Analysis (Root Causes)

### 2.1 Protocol Handshake Mismatch
*   **Current:** We manually wrap JSON-RPC calls. We attempt to call `initialize` as a "tool," which the MCP server rejects because it's a protocol-level lifecycle method.
*   **Result:** Incomplete server state and "Tool not found" warnings in logs.

### 2.2 Fragile Element Resolution
*   **Current:** We use Regex to find `[ref=s123]` strings in a flat text snapshot.
*   **Result:** High failure rate if the UI is complex or the snapshot format changes slightly.

### 2.3 Data Extraction "Noise"
*   **Current:** `@playwright/mcp` wraps results in Markdown (e.g., `### Result`). Our parsers frequently break when trying to extract JSON arrays or objects from these strings.
*   **Result:** `TypeError: Cannot read properties of undefined (reading 'length')`.

---

## 3. Phase 1: Protocol & Infrastructure (The Foundation)

### 3.1 Standard MCP Lifecycle
*   **Rewrite `PlaywrightMcpClient.ts` communication layer.**
*   Implement proper JSON-RPC lifecycle: `initialize` -> `initialized` notification -> `tools/list`.
*   Separate **Protocol Methods** (prefixed with `tools/`, `resources/`, etc.) from **Tool Calls**.

### 3.2 Robust Output Sanitization Layer
*   Implement a dedicated `McpResponseParser`.
*   Automatically detect and strip Markdown blocks (code fences, headers).
*   Attempt multi-stage parsing: `Strict JSON` -> `Markdown-Wrapped JSON` -> `Double-Quoted JSON`.

---

## 4. Phase 2: Ref-First Execution Engine (The Core)

### 4.1 Accessibility Tree Mapping
*   Instead of Regex, build a **Virtual DOM Map** from the accessibility tree snapshot.
*   Store the relationship between `Ref ID` (s123), `Role`, `Name`, and `State`.
*   Implement `resolveNameToRef` using a fuzzy-search algorithm on the Virtual DOM Map.

### 4.2 Executor "Ref-Only" Mode
*   Modify `McpTestExecutor.ts` to strictly prioritize refs.
*   **Action Flow:** 
    1. AI gives a natural language target (e.g., "Login Button").
    2. Executor looks up the Ref in the current live snapshot map.
    3. Executor calls `browser_click({ ref: 's123' })`.
    4. CSS Selectors are relegated to **Last-Resort Self-Healing** only.

---

## 5. Phase 3: Deep Discovery Integration (The Intelligence)

### 5.1 Native Interface Mismatch Fix
*   The `PageElementDiscoveryService` currently expects a native Playwright `Page` object.
*   **The Fix:** Create a `McpNativeProxy`. This proxy will implement the full Playwright `Page` interface but route all calls through the MCP JSON-RPC layer.
*   This eliminates the need for "Shims" in test scripts and allows the Discovery service to run unmodified.

### 5.2 Real-time State Synchronization
*   Implement a "Snapshot Watcher" that detects when the URL or DOM changes.
*   Keep the Virtual DOM Map in sync so that the AI always has an up-to-date ref list without expensive full-page rescans.

---

## 6. Implementation Roadmap

| Phase | Milestone | Estimated Effort | Status |
| :--- | :--- | :--- | :--- |
| **P1** | Clean JSON-RPC Protocol & Sanitizer | 2-3 Days | Proposed |
| **P2** | Virtual DOM Map & Ref-First Executor | 3-5 Days | In Progress |
| **P3** | Native Proxy Interface for Discovery | 4-6 Days | Proposed |

---

## 7. Success Metrics
1.  **Zero "Tool not found" errors** during initialization.
2.  **>95% success rate** for "Add/Save/Delete" actions without needing CSS selectors.
3.  **Direct usage** of standard Discovery code without manual shimming.
