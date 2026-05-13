    1 # Implementation Plan: Playwright MCP UI Live Discovery & Execution
    2
    3 ## Background & Motivation
    4 The current Playwright MCP implementation has critical gaps preventing it from functioning correctly as the autonomous testing
      foundation. The `@modelcontextprotocol/server-playwright` dependency is missing, incorrect tool names are being called (e.g.,
      `playwright_snapshot`), errors are swallowed silently, and the execution router never leverages cached test scripts due to UI
      hash generation failures.
    5
    6 ## Objective
    7 Refactor and finalize the Playwright MCP integration across both Live Discovery and Live Execution phases. This will transform
      the pipeline to reuse successful AI test generation scripts deterministically via a connected Playwright MCP session, reducing
      AI cost and drastically improving execution speed.
    8
    9 ## Key Files & Context
   10 - `backend/package.json`
   11 - `backend/src/services/mcp/PlaywrightMcpClient.ts`
   12 - `backend/src/services/discovery/LiveDiscoveryCrawler.ts`
   13 - `backend/src/services/discovery/TestingDiscoveryService.ts`
   14 - `backend/src/services/execution/TestingExecutionOrchestrator.ts`
   15 - `backend/src/services/execution/SmartExecutionRouter.ts`
   16 - `backend/src/services/execution/McpTestExecutor.ts`
   17
   18 ## Implementation Steps
   19
   20 ### Step 1: Install Missing Dependency & Configuration
   21 - Add `"@modelcontextprotocol/server-playwright": "^0.1.0"` to `backend/package.json` dependencies.
   22 - Add `ENABLE_MCP=true` to the `.env` schema for a controlled feature flag rollout.
   23
   24 ### Step 2: Correct MCP Tool Names & Client Methods
   25 - Modify `PlaywrightMcpClient.ts` to utilize valid tool names: `playwright_navigate`, `playwright_click`,
      `playwright_evaluate`, etc.
   26 - Replace `snapshot()` implementation with `playwright_evaluate` to extract an accessibility tree similar to `aria-snapshot`.
   27 - Fix `waitForText()` and `pressKey()` using the native tools or `playwright_evaluate` wrappers.
   28
   29 ### Step 3: Implement Safe Factory & Health-Check
   30 - Introduce `createSafe()` in `PlaywrightMcpClient` to catch initialization failures gracefully.
   31 - Add a lightweight health-check (e.g., a simple `navigate` to `about:blank`) inside the factory to verify connectivity.
   32
   33 ### Step 4: Refactor Live Discovery to Leverage MCP
   34 - Modify `LiveDiscoveryCrawler.ts` to accept an instantiated `PlaywrightMcpClient`.
   35 - Implement `crawlModuleWithMCP` using `playwright_evaluate` to extract the DOM interactive element inventory.
   36 - Update `TestingDiscoveryService.ts` to pass the MCP client (if available) rather than launching a redundant
      `SharedBrowserPool`.
   37
   38 ### Step 5: Save Executed MCP Steps & Ensure Deterministic Routing
   39 - Update `TestingExecutionOrchestrator.ts` to save successful AI-generated test steps into the `TestScriptStore` converted to
      `McpStep[]` format.
   40 - Ensure `snapshotHash()` computes successfully during execution initialization to allow `SmartExecutionRouter` to correctly
      identify matching saved scripts.
   41
   42 ### Step 6: Build `McpTestExecutor` with Self-Healing
   43 - Update `McpTestExecutor.ts` to iterate over saved `McpStep[]` utilizing valid `PlaywrightMcpClient` methods.
   44 - Introduce `SelfHealingService` fallback logic: if a step fails, trigger the AI self-healing prompt to repair the selector and
      retry the step.
   45
   46 ### Step 7: Session-Scoped MCP Client Management
   47 - Manage a single `PlaywrightMcpClient` per execution session in `TestingExecutionOrchestrator.ts`.
   48 - Ensure the client is reused across multiple test cases, avoiding process leaks or resource exhaustion.
   49
   50 ### Step 8: Real-Time Execution Step Events
   51 - Introduce `execution:step` and `discovery:progress` WebSocket events emitted via `JobEvents`.
   52 - Ensure `McpTestExecutor` broadcasts `ExecutionStepEvent` after each action, enabling real-time UI timelines.
   53
   54 ## Verification & Testing
   55 - Unit tests to verify `snapshotHash` determinism.
   56 - Run `npm run test:e2e` to validate that a cached test completely bypasses the generative AI path and correctly executes via
      `McpTestExecutor`.
   57 - Monitor Node.js process count (`tasklist` or `ps`) to ensure `npx @modelcontextprotocol/server-playwright` spawns once per
      session and exits cleanly.
   58
   59 ## Migration & Rollback
   60 - If `ENABLE_MCP=false` or if `createSafe()` returns `null`, the orchestration naturally falls back to the existing AI
      execution runner, creating zero breaking changes for existing environments.

  Does this detailed plan look good to you? Once you approve, we can transition to implementation.
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
 > add like 🟢 playwright - Ready (21 tools)
     Tools:
     - mcp_playwright_browser_click
     - mcp_playwright_browser_close
     - mcp_playwright_browser_console_messages
     - mcp_playwright_browser_drag
     - mcp_playwright_browser_evaluate
     - mcp_playwright_browser_file_upload
     - mcp_playwright_browser_fill_form
     - mcp_playwright_browser_handle_dialog
     - mcp_playwright_browser_hover
     - mcp_playwright_browser_navigate
     - mcp_playwright_browser_navigate_back
     - mcp_playwright_browser_network_requests
     - mcp_playwright_browser_press_key
     - mcp_playwright_browser_resize
     - mcp_playwright_browser_run_code
     - mcp_playwright_browser_select_option
     - mcp_playwright_browser_snapshot
     - mcp_playwright_browser_tabs
     - mcp_playwright_browser_take_screenshot
     - mcp_playwright_browser_type
     - mcp_playwright_browser_wait_fo those and First, add the official package and remove any broken one:

   bash
   npm uninstall @modelcontextprotocol/server-playwright
   npm install @playwright/mcp
   2. Playwright MCP Connection Pool
   Create src/services/mcp/PlaywrightMCPPool.ts. This singleton maintains one persistent browser connection for the entire
   application, reusing the auth state so you never need to log in again during a session.

   typescript
   // src/services/mcp/PlaywrightMCPPool.ts
   import { Client } from '@modelcontextprotocol/sdk/client/index.js';
   import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
   import { appLogger } from '@api/utils/logger';
   import path from 'path';
   import fs from 'fs';

   const AUTH_STATE_PATH = path.join(process.cwd(), 'local_storage', 'auth_state.json');
   const HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== 'false'; // default true

   export class PlaywrightMCPPool {
     private static client: Client | null = null;
     private static transport: StdioClientTransport | null = null;
     private static reconnectAttempts = 0;
     private static readonly MAX_RECONNECT = 3;

     /**
      * Returns a connected MCP client. Creates one if none exists.
      * The client is connected to the @playwright/mcp server.
      */
     static async getClient(): Promise<Client> {
       if (this.client && this.isConnected()) {
         return this.client;
       }

       await this.ensureConnection();
       return this.client!;
     }

     private static isConnected(): boolean {
       // The MCP SDK does not expose a direct "connected" flag,
       // but if the transport is open, the client should work.
       try {
         return this.transport !== null && this.client !== null;
       } catch {
         return false;
       }
     }

     private static async ensureConnection(): Promise<void> {
       const authArgs = fs.existsSync(AUTH_STATE_PATH)
         ? [`--storage-state=${AUTH_STATE_PATH}`]
         : [];

       const args = ['@playwright/mcp', ...authArgs];
       if (HEADLESS) args.push('--headless');

       this.transport = new StdioClientTransport({
         command: 'npx',
         args,
       });

       this.client = new Client(
         { name: 'gohybridai-v2', version: '2.0.0' },
         { capabilities: {} }
       );

       try {
         await this.client.connect(this.transport);
         appLogger.info('[MCP] Connected to Playwright server');
         this.reconnectAttempts = 0;

         // Ensure we can call a basic tool
         await this.client.callTool({
           name: 'browser_navigate',
           arguments: { url: 'about:blank' },
         });
         appLogger.info('[MCP] Playwright server health check passed');
       } catch (error: any) {
         this.reconnectAttempts++;
         appLogger.error(`[MCP] Connection failed (attempt ${this.reconnectAttempts}): ${error.message}`);
         if (this.reconnectAttempts < this.MAX_RECONNECT) {
           await new Promise(resolve => setTimeout(resolve, 2000));
           return this.ensureConnection();
         }
         throw new Error('MCP server unavailable after max reconnects');
       }
     }

     /**
      * Gracefully shut down the MCP connection.
      */
     static async close(): Promise<void> {
       if (this.transport) {
         await this.transport.close();
         this.transport = null;
       }
       this.client = null;
       appLogger.info('[MCP] Connection closed');
     }
   }
   Key points:

   Uses --headless and persists the auth state file so you log in only once.

   Retries on failure (up to 3 attempts).

   Verifies connectivity with a trivial browser_navigate call.

   3. MCP‑Based Live Discovery Service
   Replace the old MCPDiscoveryService.ts with this version. It extracts a full PageInventory by navigating, waiting for Angular
   stability, and evaluating a DOM‑extraction script – all via official MCP tools.

   typescript
   // src/services/discovery/MCPDiscoveryService.ts
   import { Client } from '@modelcontextprotocol/sdk/client/index.js';
   import { PlaywrightMCPPool } from '@services/mcp/PlaywrightMCPPool';
   import { PageInventory, ElementInfo } from '@types';
   import { appLogger } from '@api/utils/logger';
   import { JobEvents } from '@execution/TestingExecutionOrchestrator'; // for progress

   export class MCPDiscoveryService {

     /**
      * Discover a module page and return its UI inventory.
      * @param moduleName - e.g. "Department"
      * @param route - relative URL (e.g. "#/app.department")
      * @param ticketId - for progress events
      */
     static async discoverModule(
       moduleName: string,
       route: string,
       ticketId: string
     ): Promise<PageInventory> {
       const client = await PlaywrightMCPPool.getClient();

       // 1. Navigate
       const navResult = await client.callTool({
         name: 'browser_navigate',
         arguments: { url: route },
       });
       appLogger.info(`[MCP Discovery] Navigated to ${route}`);

       // 2. Wait for Angular stability (custom JS)
       await client.callTool({
         name: 'browser_evaluate',
         arguments: {
           expression: `async () => {
             const testabilities = window.getAllAngularTestabilities?.();
             if (testabilities) {
               await Promise.all(testabilities.map(t => t.whenStable()));
             }
             return true;
           }`,
         },
       });
       appLogger.info('[MCP Discovery] Angular stable');

       // 3. Extract interactive elements using evaluate
       const extractResult = await client.callTool({
         name: 'browser_evaluate',
         arguments: {
           expression: `() => {
             const stableSelector = (el) => {
               const fcn = el.getAttribute('formcontrolname') || el.getAttribute('formControlName');
               if (fcn) return \`[formcontrolname="\${fcn}"]\`;
               const name = el.getAttribute('name');
               if (name) return \`[name="\${name}"]\`;
               const id = el.id && !el.id.startsWith('k-') && !el.id.startsWith('ng-') ? el.id : null;
               if (id) return \`#\${id}\`;
               return el.tagName.toLowerCase();
             };

             const extract = (selector, type) => {
               return [...document.querySelectorAll(selector)]
                 .filter(el => el.offsetParent !== null || el.tagName.toLowerCase() === 'iframe')
                 .slice(0, 100)
                 .map(el => ({
                   name: el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') ||
   el.textContent?.trim().substring(0, 40) || '',
                   selector: stableSelector(el),
                   altSelectors: [],
                   type,
                   attributes: {
                     tag: el.tagName.toLowerCase(),
                     id: el.id || '',
                     name: el.getAttribute('name') || '',
                     formcontrolname: el.getAttribute('formcontrolname') || el.getAttribute('formControlName') || '',
                     placeholder: el.getAttribute('placeholder') || '',
                   },
                   isVisible: el.offsetParent !== null,
                   isEnabled: !(el.hasAttribute('disabled')),
                 }));
             };

             const buttons = extract(
               'button, .k-button, [role="button"], a.k-button',
               'button'
             );
             const inputs = extract(
               'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, [contenteditable="true"]',
               'input'
             );
             const dropdowns = extract(
               'select, kendo-dropdownlist, .k-dropdownlist, [role="combobox"]',
               'dropdown'
             );

             return JSON.stringify({
               url: window.location.href,
               hash: window.location.hash,
               pageTitle: document.title,
               discoveredAt: new Date().toISOString(),
               buttons,
               inputs,
               dropdowns,
               grids: [],
               pagination: null,
               tabs: [],
               modals: [],
               checkboxes: [],
               radios: [],
               other: [],
               summary: \`Discovered \${buttons.length} buttons, \${inputs.length} inputs, \${dropdowns.length} dropdowns\`
             });
           }`,
         },
       });

       const resultText = (extractResult as any).content[0].text;
       const inventory: PageInventory = JSON.parse(resultText);

       // Emit progress event
       JobEvents.emit('discovery:progress', {
         ticketId,
         progress: 100,
         message: `Discovery complete (${inventory.summary})`,
       });

       return inventory;
     }
   }
   What’s changed:

   No raw DOM parsing or flaky selectors – the browser itself extracts the data.

   Uses the stable selector logic (formcontrolname, name, id).

   Emits progress events that the frontend can display.

   4. MCP Replay Executor (Instant Script Replay)
   Create src/services/execution/MCPReplayExecutor.ts. This enables zero‑AI‑cost execution of previously successful MCP steps.

   typescript
   // src/services/execution/MCPReplayExecutor.ts
   import { Client } from '@modelcontextprotocol/sdk/client/index.js';
   import { McpStep } from '@services/scripts/TestScriptStore';
   import { TestResult, TestResultStatus } from '@types';
   import { appLogger } from '@api/utils/logger';
   import { FailureClassificationService } from './FailureClassificationService';
   import { JobEvents } from './TestingExecutionOrchestrator';
   import { SelfHealingService } from './SelfHealingService'; // see note

   export class MCPReplayExecutor {

     /**
      * Execute a sequence of MCP steps on a live browser.
      * Handles healing on failure.
      * @returns A TestResult with status and forensic note.
      */
     static async execute(
       caseId: string,
       caseName: string,
       steps: McpStep[],
       client: Client,
       ticketId: string
     ): Promise<TestResult> {
       const startTime = Date.now();

       for (let i = 0; i < steps.length; i++) {
         const step = steps[i];
         appLogger.info(`[MCP Replay] Step ${i + 1}/${steps.length}: ${step.action}`);

         try {
           await client.callTool({
             name: step.action,
             arguments: step.args,
           });

           // Emit step event
           JobEvents.emit('execution:step', {
             kind: 'step.pass',
             ticketId,
             caseId,
             stepNumber: i + 1,
             message: `Step ${i + 1}: ${step.action} passed`,
             ts: Date.now(),
           });

         } catch (error: any) {
           // Attempt healing
           appLogger.warn(`[MCP Replay] Step ${step.action} failed: ${error.message}`);

           const healedStep = await this.healStep(step, client);
           if (healedStep) {
             try {
               await client.callTool({
                 name: healedStep.action,
                 arguments: healedStep.args,
               });
               JobEvents.emit('execution:step', {
                 kind: 'heal.pass',
                 ticketId,
                 caseId,
                 stepNumber: i + 1,
                 message: `Healed step: ${healedStep.action} on ${healedStep.args.element}`,
                 ts: Date.now(),
               });
             } catch (healError: any) {
               return this.failureResult(caseId, caseName, startTime, healError.message);
             }
           } else {
             return this.failureResult(caseId, caseName, startTime, error.message);
           }
         }
       }

       return {
         caseId,
         caseName,
         status: 'PASS',
         duration: `${Date.now() - startTime}ms`,
       };
     }

     private static async healStep(
       failedStep: McpStep,
       client: Client
     ): Promise<McpStep | null> {
       // Obtain a fresh accessibility snapshot
       try {
         const snapshotResult = await client.callTool({
           name: 'browser_snapshot',
           arguments: {},
         });
         const snapshotText = (snapshotResult as any).content[0].text;

         // Use the existing self-healing service (which calls Vertex AI) to propose a new selector
         const healedSelector = await SelfHealingService.repairSelector(
           failedStep.args.element,
           snapshotText
         );

         if (healedSelector && healedSelector !== failedStep.args.element) {
           return {
             ...failedStep,
             args: {
               ...failedStep.args,
               element: healedSelector,
             },
           };
         }
       } catch (e) {
         appLogger.warn(`[MCP Replay] Healing error: ${(e as Error).message}`);
       }
       return null;
     }

     private static failureResult(
       caseId: string,
       caseName: string,
       startTime: number,
       errorMsg: string
     ): TestResult {
       const classification = FailureClassificationService.classifyFailure(errorMsg);
       return {
         caseId,
         caseName,
         status: classification.isApplicationBug ? 'FAIL' : 'CODE_FAULT',
         duration: `${Date.now() - startTime}ms`,
         errorMessage: errorMsg,
         forensicNote: classification.explanation,
       };
     }
   }
   Note: The SelfHealingService.repairSelector method already exists in your codebase. If you prefer to keep the healing logic
   within this executor, you can call Vertex AI directly from here.

   5. Updated Smart Execution Router
   The SmartExecutionRouter now uses the TestScriptStore to load saved MCP steps and the MCPReplayExecutor to run them.

   typescript
   // src/services/execution/SmartExecutionRouter.ts (updated)
   import { TestScriptStore, SavedScript } from '@services/scripts/TestScriptStore';
   import { MCPDiscoveryService } from '@services/discovery/MCPDiscoveryService';
   import { PlaywrightMCPPool } from '@services/mcp/PlaywrightMCPPool';
   import { TestSession, TestScenario } from '@types';
   import { appLogger } from '@api/utils/logger';

   export interface RoutingDecision {
     strategy: 'execute_saved' | 'ai_generate';
     reason: string;
     savedScript?: SavedScript;
   }

   export class SmartExecutionRouter {
     private scriptStore = new TestScriptStore();

     async decide(
       session: TestSession,
       scenario: TestScenario,
       currentUiHash: string
     ): Promise<RoutingDecision> {
       const { ticketId } = session;

       const saved = await this.scriptStore.load(ticketId, scenario.id);
       if (!saved) {
         return {
           strategy: 'ai_generate',
           reason: `No saved script for ${ticketId}/${scenario.id}`,
         };
       }

       const uiChanged = saved.uiHash !== currentUiHash;
       if (uiChanged) {
         appLogger.warn(`[SmartRouter] UI change for ${ticketId}, regeneration required`);
         return {
           strategy: 'ai_generate',
           reason: 'UI hash mismatch',
           savedScript: saved,
         };
       }

       appLogger.info(`[SmartRouter] Perfect match! Replaying saved MCP script`);
       return {
         strategy: 'execute_saved',
         reason: 'UI hash match',
         savedScript: saved,
       };
     }

     /**
      * Execute a saved script directly via MCP.
      */
     async executeSaved(
       savedScript: SavedScript,
       ticketId: string
     ): Promise<any> {
       const client = await PlaywrightMCPPool.getClient();
       return MCPReplayExecutor.execute(
         savedScript.ticketId,
         savedScript.scenarioName,
         savedScript.steps,
         client,
         ticketId
       );
     }
   }
   6. Integration into TestingExecutionOrchestrator
   The orchestrator now uses MCP for discovery and can route to SmartExecutionRouter.executeSaved.

   typescript
   // Inside TestingExecutionOrchestrator.execute()
   if (mcpClient) {
     uiHash = await (await this.mcpDiscovery.getClient()).callTool(...).then(r => r.content[0].text); // simplified
   }

   for (const testCase of casesToRun) {
     const decision = await this.smartRouter.decide(session, scenario, uiHash);
     if (decision.strategy === 'execute_saved' && decision.savedScript) {
       // Instant replay
       result = await this.smartRouter.executeSaved(decision.savedScript, ticketId);
     } else {
       // Fallback to AI generation / AutonomousRunner
       result = await this.legacyExecute(testCase, ...);
     }
     // ...
   }
   7. Dependency Cleanup
   Remove references to the old, broken MCP code:

   Delete src/services/mcp/PlaywrightMcpClient.ts

   Delete src/services/discovery/McpDiscoveryService.ts (the old one)

   8. Summary
   With these changes, your system gains:

   Reliable browser automation using the official @playwright/mcp server.

   Instant test replay when the UI hash matches, saving 90% of AI calls.

   Live healing using Vertex AI on browser_snapshot.

   One persistent browser with automatic auth state reuse – no duplicate logins. and 📦 Updated McpStep Type (ready for
   TestScriptStore.ts)
   typescript
   // src/services/scripts/TestScriptStore.ts (relevant section)

   export type McpStep =
     | { action: 'browser_navigate'; url: string }
     | { action: 'browser_click'; element: string; ref?: string }
     | { action: 'browser_type'; element: string; text: string }
     | { action: 'browser_fill_form'; fields: Array<{ name: string; value: string }> }
     | { action: 'browser_select_option'; element: string; option: string }
     | { action: 'browser_hover'; element: string }
     | { action: 'browser_drag'; source: string; target: string }
     | { action: 'browser_press_key'; key: string }
     | { action: 'browser_take_screenshot'; fileName?: string }
     | { action: 'browser_snapshot' } // accessibility tree
     | { action: 'browser_evaluate'; expression: string }
     | { action: 'browser_run_code'; code: string }
     | { action: 'browser_wait_for'; text?: string; timeout?: number }
     | { action: 'browser_handle_dialog'; accept?: boolean }
     | { action: 'browser_close' }
     | { action: 'browser_file_upload'; element: string; files: string[] };

   export interface SavedScript {
       id: string;
       ticketId: string;
       scenarioId: string;
       scenarioName: string;
       module: string;
       steps: McpStep[];          // <-- now strictly typed
       uiHash: string;
       passRate: number;
       lastRunAt: Date;
       source: 'ai' | 'manual';
   }
   Why this shape?

   Each action type is a separate union member with only the relevant arguments.

   This mirrors the exact tool signatures from @playwright/mcp v1.0+.

   The MCPReplayExecutor can now safely do client.callTool({ name: step.action, arguments: step }) without any extra mapping.

   🔄 How to migrate existing data
   If there are stored scripts in the database using the old McpStep format, a migration script can map old action names to new
   ones:

   typescript
   // Temporary migration helper (run once)
   function upgradeMcpStep(old: any): McpStep {
     switch (old.action) {
       case 'navigate': return { action: 'browser_navigate', url: old.value || old.target };
       case 'fill': return { action: 'browser_type', element: old.target, text: old.value };
       case 'click': return { action: 'browser_click', element: old.target };
       case 'select': return { action: 'browser_select_option', element: old.target, option: old.value };
       // … etc
       default: throw new Error(`Unknown step action: ${old.action}`);
     }
   }
   ✅ Integration Points
   MCPReplayExecutor.execute() – already built to accept McpStep[] and call client.callTool({ name: step.action, arguments: step }).

   TestScriptStore.save() – will now store the new McpStep[] type in the steps JSONB column.

   SmartExecutionRouter – loads SavedScript and passes steps to the executor.

   AI Generation – when Vertex AI generates a test plan, the backend prompts it to output a list of McpStep objects using the
   official tool names. Example prompt snippet:

   text
   Output a JSON array of MCP steps. Use these tool names only:
   browser_navigate, browser_click, browser_type, browser_snapshot, browser_evaluate…
   No other changes are needed in the previously designed architecture.

   📁 Where to put the type
   The McpStep type should live next to its usage – ideally in a single shared types file to avoid duplication. Given your codebase,
   I recommend:

   Create src/types/mcp.types.ts and export McpStep from there.

   Import it in both TestScriptStore.ts and the executor.

   This way, any future additions to the MCP toolset require changes in one place only. and 📦 1. New Dependency
   Add to package.json (then run npm install):

   json
   {
     "dependencies": {
       "@playwright/mcp": "latest"
     }
   }
   The @modelcontextprotocol/sdk is already present.

   🧩 2. Strict McpStep Type + Zod Validation
   Create src/types/mcp.types.ts. This single source of truth ensures type‑safety for every tool call.

   typescript
   // src/types/mcp.types.ts
   import { z } from 'zod';

   // --- Action Unions ---
   const McpNavigate = z.object({
     action: z.literal('browser_navigate'),
     url: z.string().min(1)
   });
   const McpClick = z.object({
     action: z.literal('browser_click'),
     element: z.string().min(1),
     ref: z.string().optional()
   });
   const McpType = z.object({
     action: z.literal('browser_type'),
     element: z.string().min(1),
     text: z.string()
   });
   const McpFillForm = z.object({
     action: z.literal('browser_fill_form'),
     fields: z.array(z.object({ name: z.string(), value: z.string() }))
   });
   const McpSelectOption = z.object({
     action: z.literal('browser_select_option'),
     element: z.string(),
     option: z.string()
   });
   const McpHover = z.object({ action: z.literal('browser_hover'), element: z.string() });
   const McpDrag = z.object({ action: z.literal('browser_drag'), source: z.string(), target: z.string() });
   const McpPressKey = z.object({ action: z.literal('browser_press_key'), key: z.string() });
   const McpTakeScreenshot = z.object({ action: z.literal('browser_take_screenshot'), fileName: z.string().optional() });
   const McpSnapshot = z.object({ action: z.literal('browser_snapshot') });
   const McpEvaluate = z.object({ action: z.literal('browser_evaluate'), expression: z.string().min(1) });
   const McpRunCode = z.object({ action: z.literal('browser_run_code'), code: z.string().min(1) });
   const McpWaitFor = z.object({ action: z.literal('browser_wait_for'), text: z.string().optional(), timeout: z.number().optional()
   });
   const McpHandleDialog = z.object({ action: z.literal('browser_handle_dialog'), accept: z.boolean().optional() });
   const McpClose = z.object({ action: z.literal('browser_close') });
   const McpFileUpload = z.object({ action: z.literal('browser_file_upload'), element: z.string(), files: z.array(z.string()) });

   export const McpStepSchema = z.discriminatedUnion('action', [
     McpNavigate,
     McpClick,
     McpType,
     McpFillForm,
     McpSelectOption,
     McpHover,
     McpDrag,
     McpPressKey,
     McpTakeScreenshot,
     McpSnapshot,
     McpEvaluate,
     McpRunCode,
     McpWaitFor,
     McpHandleDialog,
     McpClose,
     McpFileUpload
   ]);

   export type McpStep = z.infer<typeof McpStepSchema>;
   🔌 3. Playwright MCP Connection Pool
   Create src/services/mcp/PlaywrightMCPPool.ts. This singleton maintains one persistent browser with automatic auth state reuse.

   typescript
   // src/services/mcp/PlaywrightMCPPool.ts
   import { Client } from '@modelcontextprotocol/sdk/client/index.js';
   import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
   import { appLogger } from '@api/utils/logger';
   import path from 'path';
   import fs from 'fs';

   const AUTH_STATE_PATH = path.join(process.cwd(), 'local_storage', 'auth_state.json');
   const HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== 'false';

   export class PlaywrightMCPPool {
     private static client: Client | null = null;
     private static transport: StdioClientTransport | null = null;
     private static reconnectAttempts = 0;
     private static readonly MAX_RECONNECT = 3;

     /**
      * Returns a connected MCP client. Creates one if none exists.
      */
     static async getClient(): Promise<Client> {
       if (this.client && this.isConnected()) {
         return this.client;
       }
       await this.ensureConnection();
       return this.client!;
     }

     private static isConnected(): boolean {
       try {
         return this.transport !== null && this.client !== null;
       } catch { return false; }
     }

     private static async ensureConnection(): Promise<void> {
       const authArgs = fs.existsSync(AUTH_STATE_PATH)
         ? [`--storage-state=${AUTH_STATE_PATH}`]
         : [];

       const args = ['@playwright/mcp', ...authArgs];
       if (HEADLESS) args.push('--headless');

       this.transport = new StdioClientTransport({
         command: 'npx',
         args,
       });

       this.client = new Client(
         { name: 'gohybridai-v2', version: '2.0.0' },
         { capabilities: {} }
       );

       try {
         await this.client.connect(this.transport);
         appLogger.info('[MCP] Connected to Playwright server');
         this.reconnectAttempts = 0;

         // Health check
         await this.client.callTool({
           name: 'browser_navigate',
           arguments: { url: 'about:blank' },
         });
         appLogger.info('[MCP] Health check passed');
       } catch (error: any) {
         this.reconnectAttempts++;
         appLogger.error(`[MCP] Connection failed (attempt ${this.reconnectAttempts}): ${error.message}`);
         if (this.reconnectAttempts < this.MAX_RECONNECT) {
           await new Promise(resolve => setTimeout(resolve, 2000));
           return this.ensureConnection();
         }
         throw new Error('MCP server unavailable after max reconnects');
       }
     }

     static async close(): Promise<void> {
       if (this.transport) {
         await this.transport.close();
         this.transport = null;
       }
       this.client = null;
       appLogger.info('[MCP] Connection closed');
     }
   }
   🔍 4. MCP‑Based Discovery Service
   Replace the old discovery service with src/services/discovery/MCPDiscoveryService.ts. It uses official tools to navigate, wait
   for Angular, and extract an element inventory.

   typescript
   // src/services/discovery/MCPDiscoveryService.ts
   import { Client } from '@modelcontextprotocol/sdk/client/index.js';
   import { PlaywrightMCPPool } from '@services/mcp/PlaywrightMCPPool';
   import { PageInventory } from '@types';
   import { appLogger } from '@api/utils/logger';
   import { JobEvents } from '@execution/TestingExecutionOrchestrator';

   export class MCPDiscoveryService {

     static async discoverModule(
       moduleName: string,
       route: string,   // e.g. "https://test.globalhr.com.mm/ook#/app.department"
       ticketId: string
     ): Promise<PageInventory> {
       const client = await PlaywrightMCPPool.getClient();

       // 1. Navigate
       await client.callTool({
         name: 'browser_navigate',
         arguments: { url: route },
       });
       appLogger.info(`[MCP Discovery] Navigated to ${route}`);

       // 2. Wait for Angular (custom JS)
       await client.callTool({
         name: 'browser_evaluate',
         arguments: {
           expression: `async () => {
             const testabilities = window.getAllAngularTestabilities?.();
             if (testabilities) {
               await Promise.all(testabilities.map(t => t.whenStable()));
             }
             return true;
           }`,
         },
       });
       appLogger.info('[MCP Discovery] Angular stable');

       // 3. Extract elements using evaluate
       const extractResult = await client.callTool({
         name: 'browser_evaluate',
         arguments: {
           expression: `() => {
             const stableSelector = (el) => {
               const fcn = el.getAttribute('formcontrolname') || el.getAttribute('formControlName');
               if (fcn) return \`[formcontrolname="\${fcn}"]\`;
               const name = el.getAttribute('name');
               if (name) return \`[name="\${name}"]\`;
               const id = el.id && !el.id.startsWith('k-') && !el.id.startsWith('ng-') ? el.id : null;
               if (id) return \`#\${id}\`;
               return el.tagName.toLowerCase();
             };

             const extract = (selector, type) => {
               return [...document.querySelectorAll(selector)]
                 .filter(el => el.offsetParent !== null || el.tagName.toLowerCase() === 'iframe')
                 .slice(0, 100)
                 .map(el => ({
                   name: el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') ||
   el.textContent?.trim().substring(0, 40) || '',
                   selector: stableSelector(el),
                   altSelectors: [],
                   type,
                   attributes: {
                     tag: el.tagName.toLowerCase(),
                     id: el.id || '',
                     name: el.getAttribute('name') || '',
                     formcontrolname: el.getAttribute('formcontrolname') || el.getAttribute('formControlName') || '',
                     placeholder: el.getAttribute('placeholder') || '',
                   },
                   isVisible: el.offsetParent !== null,
                   isEnabled: !(el.hasAttribute('disabled')),
                 }));
             };

             const buttons = extract(
               'button, .k-button, [role="button"], a.k-button',
               'button'
             );
             const inputs = extract(
               'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, [contenteditable="true"]',
               'input'
             );
             const dropdowns = extract(
               'select, kendo-dropdownlist, .k-dropdownlist, [role="combobox"]',
               'dropdown'
             );

             return JSON.stringify({
               url: window.location.href,
               hash: window.location.hash,
               pageTitle: document.title,
               discoveredAt: new Date().toISOString(),
               buttons,
               inputs,
               dropdowns,
               grids: [],
               pagination: null,
               tabs: [],
               modals: [],
               checkboxes: [],
               radios: [],
               other: [],
               summary: \`Discovered \${buttons.length} buttons, \${inputs.length} inputs, \${dropdowns.length} dropdowns\`
             });
           }`,
         },
       });

       const resultText = (extractResult as any).content[0].text;
       const inventory: PageInventory = JSON.parse(resultText);

       JobEvents.emit('discovery:progress', {
         ticketId,
         progress: 100,
         message: `Discovery complete (${inventory.summary})`,
       });

       return inventory;
     }
   }
   ⚡ 5. MCP Replay Executor (Instant Script Replay)
   Create src/services/execution/MCPReplayExecutor.ts. This replays saved MCP steps and heals on failure.

   typescript
   // src/services/execution/MCPReplayExecutor.ts
   import { Client } from '@modelcontextprotocol/sdk/client/index.js';
   import { McpStep } from '@types/mcp.types';
   import { TestResult } from '@types';
   import { appLogger } from '@api/utils/logger';
   import { FailureClassificationService } from './FailureClassificationService';
   import { SelfHealingService } from './SelfHealingService';
   import { JobEvents } from './TestingExecutionOrchestrator';

   export class MCPReplayExecutor {

     static async execute(
       caseId: string,
       caseName: string,
       steps: McpStep[],
       client: Client,
       ticketId: string
     ): Promise<TestResult> {
       const startTime = Date.now();

       for (let i = 0; i < steps.length; i++) {
         const step = steps[i];
         appLogger.info(`[MCP Replay] Step ${i + 1}/${steps.length}: ${step.action}`);

         try {
           await client.callTool({ name: step.action, arguments: step });
           JobEvents.emit('execution:step', {
             kind: 'step.pass',
             ticketId,
             caseId,
             stepNumber: i + 1,
             message: `Step ${i + 1}: ${step.action} passed`,
             ts: Date.now(),
           });
         } catch (error: any) {
           appLogger.warn(`[MCP Replay] Step ${step.action} failed: ${error.message}`);

           // Attempt healing
           let healed = false;
           try {
             const snapshotResult = await client.callTool({ name: 'browser_snapshot', arguments: {} });
             const snapshotText = (snapshotResult as any).content[0].text;
             const newSelector = await SelfHealingService.repairSelector(
               (step as any).element || '',
               snapshotText
             );
             if (newSelector) {
               const healedStep = { ...step, element: newSelector } as McpStep;
               await client.callTool({ name: step.action, arguments: healedStep });
               healed = true;
               JobEvents.emit('execution:step', {
                 kind: 'heal.pass',
                 ticketId,
                 caseId,
                 stepNumber: i + 1,
                 message: `Healed step: ${step.action} on ${newSelector}`,
                 ts: Date.now(),
               });
             }
           } catch (healErr) {
             // continue to classification
           }

           if (!healed) {
             const classification = FailureClassificationService.classifyFailure(error.message);
             return {
               caseId,
               caseName,
               status: classification.isApplicationBug ? 'FAIL' : 'CODE_FAULT',
               duration: `${Date.now() - startTime}ms`,
               errorMessage: error.message,
               forensicNote: classification.explanation,
             };
           }
         }
       }

       return {
         caseId,
         caseName,
         status: 'PASS',
         duration: `${Date.now() - startTime}ms`,
       };
     }
   }
   📜 6. Updated TestScriptStore
   Modify src/services/scripts/TestScriptStore.ts to use the new McpStep type and Zod validation on save.

   typescript
   // src/services/scripts/TestScriptStore.ts (updated)
   import { DatabaseService } from '@shared/DatabaseService';
   import { appLogger } from '@api/utils/logger';
   import { McpStep, McpStepSchema } from '@types/mcp.types';

   export interface SavedScript {
     id: string;
     ticketId: string;
     scenarioId: string;
     scenarioName: string;
     module: string;
     steps: McpStep[];
     uiHash: string;
     passRate: number;
     lastRunAt: Date;
     source: 'ai' | 'manual';
   }

   export class TestScriptStore {
     async load(ticketId: string, scenarioId: string): Promise<SavedScript | null> {
       const res = await DatabaseService.query(
         `SELECT * FROM test_scripts WHERE ticket_id = $1 AND scenario_id = $2`,
         [ticketId, scenarioId]
       );
       if (res.rows.length === 0) return null;
       const row = res.rows[0];
       return {
         id: row.id,
         ticketId: row.ticket_id,
         scenarioId: row.scenario_id,
         scenarioName: row.scenario_name,
         module: row.module,
         steps: row.steps as McpStep[],
         uiHash: row.ui_hash,
         passRate: parseFloat(row.pass_rate),
         lastRunAt: row.last_run_at,
         source: row.source,
       };
     }

     async save(
       ticketId: string,
       scenarioId: string,
       steps: McpStep[],
       uiHash: string,
       metadata: { scenarioName: string; module: string }
     ): Promise<void> {
       // Validate steps before saving
       const validation = McpStepSchema.array().safeParse(steps);
       if (!validation.success) {
         appLogger.error('[TestScriptStore] Invalid MCP steps, cannot save');
         return;
       }

       appLogger.info(`[TestScriptStore] Saving clean script for ${ticketId}/${scenarioId}`);
       await DatabaseService.query(
         `INSERT INTO test_scripts (ticket_id, scenario_id, scenario_name, module, steps, ui_hash, last_pass_at, pass_count,
   run_count)
          VALUES ($1, $2, $3, $4, $5, $6, NOW(), 1, 1)
          ON CONFLICT (ticket_id, scenario_id) DO UPDATE SET
            steps = EXCLUDED.steps,
            ui_hash = EXCLUDED.ui_hash,
            scenario_name = EXCLUDED.scenario_name,
            last_pass_at = NOW(),
            pass_count = test_scripts.pass_count + 1,
            run_count = test_scripts.run_count + 1,
            updated_at = NOW()`,
         [ticketId, scenarioId, metadata.scenarioName, metadata.module, JSON.stringify(steps), uiHash]
       );
     }

     // recordOutcome, hasUiChanged, listSavedTickets remain unchanged except for types
   }
   🧠 7. Updated SmartExecutionRouter
   src/services/execution/SmartExecutionRouter.ts now uses MCPReplayExecutor and the new TestScriptStore.

   typescript
   // src/services/execution/SmartExecutionRouter.ts
   import { TestScriptStore, SavedScript } from '@services/scripts/TestScriptStore';
   import { PlaywrightMCPPool } from '@services/mcp/PlaywrightMCPPool';
   import { MCPReplayExecutor } from './MCPReplayExecutor';
   import { TestSession, TestScenario } from '@types';
   import { appLogger } from '@api/utils/logger';

   export interface RoutingDecision {
     strategy: 'execute_saved' | 'ai_generate';
     reason: string;
     savedScript?: SavedScript;
   }

   export class SmartExecutionRouter {
     private scriptStore = new TestScriptStore();

     async decide(
       session: TestSession,
       scenario: TestScenario,
       currentUiHash: string
     ): Promise<RoutingDecision> {
       const saved = await this.scriptStore.load(session.ticketId, scenario.id);
       if (!saved) return { strategy: 'ai_generate', reason: 'No saved script' };

       if (saved.uiHash !== currentUiHash) {
         return { strategy: 'ai_generate', reason: 'UI hash mismatch', savedScript: saved };
       }

       return { strategy: 'execute_saved', reason: 'UI hash match', savedScript: saved };
     }

     async executeSaved(savedScript: SavedScript): Promise<any> {
       const client = await PlaywrightMCPPool.getClient();
       return MCPReplayExecutor.execute(
         savedScript.ticketId,
         savedScript.scenarioName,
         savedScript.steps,
         client,
         savedScript.ticketId
       );
     }
   }
   🎛️ 8. Integration Into TestingExecutionOrchestrator
   Modify TestingExecutionOrchestrator.ts to use MCP for discovery and saved‑script replay.

   Discovery (inside execute() or executeLive()):

   typescript
   // Before running test cases, if MCP is available, do live discovery
   if (this.mcpClient) {
     const hash = await this.mcpDiscovery.getUiHash(); // helper calling browser_evaluate
     // ...
   }
   Execution loop:

   typescript
   const decision = await this.smartRouter.decide(session, scenario, uiHash);
   if (decision.strategy === 'execute_saved' && decision.savedScript) {
     result = await this.smartRouter.executeSaved(decision.savedScript);
   } else {
     // Fallback to original AI-generated compilation / AutonomousRunner
     result = await this.legacyExecute(testCase, ...);
   }
   ✅ Summary of Changes
   New type system (src/types/mcp.types.ts) – strict McpStep union.

   Connection pool (PlaywrightMCPPool) – persistent browser, auth reuse.

   MCP discovery (MCPDiscoveryService) – extracts real selectors live.

   MCP replay executor (MCPReplayExecutor) – instant replay with live healing.

   Updated TestScriptStore – validates steps on save.

   Updated SmartExecutionRouter – routes to MCP replay when possible.

   Orchestrator integration – seamlessly falls back to legacy if MCP unavailable.

   The result is a stable, long‑term MCP architecture that will immediately reduce AI costs and improve execution speed. With the
   official @playwright/mcp server, all tool calls are guaranteed to work, and your saved scripts become a real asset rather than
   wasted data.