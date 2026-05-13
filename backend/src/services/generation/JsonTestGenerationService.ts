import {
  TestSpecification,
  TestScenario,
  validateTestSpecification,
  getValidationErrors,
} from './TestSpecSchema';
import { compileTestSpec } from './JSONToPlaywrightCompiler';
import { resolveSpecTargets, buildRetryHint } from './TestSpecTargetResolver';
import { buildEnterpriseRulesBlock } from '../prompts/enterprise-execution-rules';
import { UnifiedAIOrchestrator, TaskType } from '../../../api/UnifiedAIOrchestrator';
import { scoreTestSpecification, QualityScore } from '../TestSpecQualityScorer';
import { ModuleRegistry } from '../shared/ModuleRegistry';
import { DiscoveryCacheService } from '../discovery/DiscoveryCacheService';
import { McpDiscoveryService } from '../mcp/McpDiscoveryService';
import { McpStep } from '../../types/mcp.types';
import { ContextManager } from '../../../api/ContextManager';
import { GeneratedTestOrganizer } from '../GeneratedTestOrganizer';
import { AgentOrchestrator } from '../AgentOrchestrator';
import { SkillRegistryService } from '../skills/SkillRegistryService';
import { SmartTicketSummarizer } from '../shared/SmartTicketSummarizer';
import { getJiraAxios } from '../../utils/jiraAxios';
import { appLogger } from '../../utils/logger';
import { UsageTrackerService } from '../shared/UsageTrackerService';
import { capPromptWithWarning } from '../../utils/PromptUtils';
import { JsonExtractor } from '../../utils/JsonExtractor';
import * as fs from 'fs';
import * as path from 'path';

const ISTQB_CONDENSED = `
ISTQB test design (apply to every generated test):
- Equivalence Partitioning: one valid + one invalid input per field
- Boundary Value Analysis: test at min, min+1, max-1, max for numeric fields
- State Transition: cover Draft→Submitted→Approved→Rejected for workflow entities
- Error Guessing: empty required fields, max+1 length, duplicate codes, special chars
- Every scenario needs at least ONE assertion (visible element, URL, API response, or text)
- Bug tickets: include exact reproduction step + expected vs actual + regression check
`.trim();

export interface JsonTestGenerationResult {
  success: boolean;
  specification?: TestSpecification;
  qualityScore?: QualityScore;
  compiledScript?: string;
  scriptPath?: string;
  compiledScripts?: Record<string, string>;
  errors?: string[];
  retries?: number;
  tokensUsed?: {
    prompt: number;
    completion: number;
    total: number;
  };
  /**
   * McpStep[] per scenario ID, ready to be saved to TestScriptStore.
   * Present on success. Callers that have a DB pool can persist these
   * immediately via TestScriptStore.save().
   */
  mcpSteps?: Record<string, import('../../types/mcp.types').McpStep[]>;
}

export interface JsonGenerationOptions {
  ticketId: string;
  summary: string;
  description: string;
  module: string;
  issueType?: 'Bug' | 'Story';
  baseUrl: string;
  credentials?: {
    username: string;
    password: string;
    idNumber?: string;
  };
  isLoginTest?: boolean;
  businessRules?: string[];
  uiHints?: string[];
  acceptanceCriteria?: string[];
  attachmentSummaries?: string[];
  jiraComments?: string[];
  selectorReference?: any;
  bugReproductionSteps?: Array<{ stepNumber: number; description: string; testData?: string }>;
  maxRetries?: number;
  customInstructions?: string[];
  skillContext?: string;
  learnedPatterns?: any[];
  flakinessData?: any;
  /**
   * Live accessibility snapshot injected by McpDiscoveryService.
   * When present, replaces the stale DiscoveryCacheService context in buildPrompt().
   * Format: McpDiscoveryService.buildPromptContext() output string.
   */
  liveSnapshot?: string;
  /**
   * Whether to attempt live MCP discovery before generation.
   * Default: true when credentials are provided.
   * Set to false to skip discovery and use cache only.
   */
  enableLiveDiscovery?: boolean;
  /**
   * Ticket classification from TicketClassifier.classify().
   * When provided, AgentOrchestrator injects scope/type instructions
   * into both the planning and coding prompts for context-aware generation.
   */
  ticketClassification?: import('../../types/jira-context.types').TicketClassification;
  /**
   * Phase 3: structured state graph paths derived from ModuleStateGraph.
   * When present, the AI generates test steps that follow these exact transitions.
   * AI fills DATA VALUES only — selectors/labels come from the path transitions.
   */
  graphPaths?: import('../graph/ModuleStateGraph').StatePath[];
  pool?: any;
}

export class JsonTestGenerationService {
  private static readonly MAX_RETRIES = 3;
  private static readonly OUTPUT_DIR = path.join(process.cwd(), 'tests', 'generated');

  static async generateAndCompile(options: JsonGenerationOptions): Promise<JsonTestGenerationResult> {
    console.log(`[JsonTestGeneration] Starting generation for ${options.ticketId}...`);

    // ── Live Discovery (Phase 1) ────────────────────────────────────────────
    // Attempt a real-time accessibility snapshot so Vertex AI sees the ACTUAL
    // current UI instead of the potentially stale DiscoveryCacheService output.
    // Falls back to cache silently if discovery fails or is disabled.
    let resolvedOptions = options;
    if (options.enableLiveDiscovery !== false && options.credentials && !options.liveSnapshot) {
      resolvedOptions = await this.tryLiveDiscovery(options);
    }

    // Phase 3: load state graph paths for structured test generation
    if (options.pool) {
      try {
        const { ModuleStateGraphService } = await import('../graph/ModuleStateGraph');
        const moduleId = options.module.toUpperCase().slice(0, 10);
        const graph = await ModuleStateGraphService.load(options.pool, moduleId);
        if (graph) {
          const happyPaths = ModuleStateGraphService.generatePaths(graph, 'happy');
          if (happyPaths.length > 0) {
            resolvedOptions = { ...resolvedOptions, graphPaths: happyPaths };
            appLogger.info(`[JsonTestGeneration] Injecting ${happyPaths.length} graph paths for "${moduleId}"`);
          }
        }
      } catch (graphErr: any) {
        appLogger.warn(`[JsonTestGeneration] Graph load failed (non-fatal): ${graphErr.message}`);
      }
    }

    const promptContext = this.buildPrompt(resolvedOptions);
    const effectiveOptions: JsonGenerationOptions = {
        ...resolvedOptions,
        skillContext: [resolvedOptions.skillContext, promptContext].filter(Boolean).join('\n\n---\n\n'),
    };
    
    try {
        const result = await AgentOrchestrator.orchestrateGeneration(effectiveOptions);
        const aiResponse = result.jsonSpec;

        // Debug: log raw AI output first 500 chars for diagnosability
        appLogger.debug(`[JsonTestGeneration] Raw AI response (first 500 chars): ${aiResponse.slice(0, 500)}`);

        const cleanedResponse = this.patchEnvelope(this.cleanJsonResponse(aiResponse), options);
        const validationResult = validateTestSpecification(cleanedResponse);

        if (!validationResult.success) {
            // B3: Return field-level schema errors instead of the generic message.
            const fieldErrors = getValidationErrors(validationResult.errors);
            // Dump context around the error location to help diagnose structural issues
            const errMsg = fieldErrors[0] || '';
            const posMatch = errMsg.match(/position (\d+)/i);
            const errPos = posMatch ? parseInt(posMatch[1], 10) : -1;
            const snippetStart = Math.max(0, errPos - 200);
            const snippetEnd = Math.min(cleanedResponse.length, errPos + 200);
            appLogger.warn(
                `[JsonTestGeneration] Validation failure. Error at pos ${errPos}.\n` +
                `Context (pos ${snippetStart}-${snippetEnd}):\n${cleanedResponse.slice(snippetStart, snippetEnd)}\n` +
                `Full cleaned JSON (first 1200 chars): ${cleanedResponse.slice(0, 1200)}`,
            );
            return {
                success: false,
                errors: ['TestSpec validation failed', ...fieldErrors],
            };
        }

        // S4-3: Target resolution gate. Every element reference must resolve
        // against the discovery cache (or already carry a selectorHint) before
        // we hand the spec to the compiler. Unresolved targets become a
        // structured error so the caller can retry with LLM hints, rather than
        // silently shipping a script with a broken selector.
        const resolution = resolveSpecTargets(validationResult.data, effectiveOptions.module);
        appLogger.info(
            `[JsonTestGeneration] Target resolution: ${resolution.stats.resolvedFromCache} resolved, ` +
            `${resolution.stats.alreadyHadHint} pre-hinted, ${resolution.stats.unresolved} unresolved`,
        );

        // B2: Auto-retry when targets are unresolved.
        // Append the structured hint to customInstructions and re-call the LLM
        // once. This closes the loop so the caller never sees a broken selector
        // silently reach the compiler.
        if (resolution.unresolved.length > 0) {
            const retryHint = buildRetryHint(resolution);
            appLogger.warn(
                `[JsonTestGeneration] ${resolution.unresolved.length} unresolved target(s) — attempting one auto-retry with resolution hint`,
            );

            const retryOptions: JsonGenerationOptions = {
                ...effectiveOptions,
                customInstructions: [
                    ...(effectiveOptions.customInstructions || []),
                    `CORRECTION REQUIRED — the following elements could not be found in the discovery cache. ` +
                    `You MUST use only the element names listed in the selector reference below.\n\n${retryHint}`,
                ],
            };

            try {
                const retryResult = await AgentOrchestrator.orchestrateGeneration(retryOptions);
                const retryCleaned = this.patchEnvelope(this.cleanJsonResponse(retryResult.jsonSpec), options);
                const retryValidation = validateTestSpecification(retryCleaned);

                if (retryValidation.success) {
                    const retryResolution = resolveSpecTargets(retryValidation.data, effectiveOptions.module);
                    appLogger.info(
                        `[JsonTestGeneration] Retry resolution: ${retryResolution.stats.resolvedFromCache} resolved, ` +
                        `${retryResolution.stats.unresolved} still unresolved`,
                    );

                    if (retryResolution.unresolved.length === 0) {
                        // Retry succeeded — continue with the enriched spec from retry.
                        // Fall through by reassigning and continuing below.
                        const enrichedSpec = retryResolution.spec;
                        return this.compileAndReturn(enrichedSpec, options, effectiveOptions, retryResult.tokenUsage);
                    }

                    // Retry reduced but did not eliminate all unresolved targets.
                    // Proceed with semantic-fallback selectors rather than blocking generation.
                    // These steps will attempt to run; if the element truly doesn't exist they
                    // will produce a CODE_FAULT or EXEC_FAULT during execution — which is the
                    // correct outcome rather than preventing all test cases from being created.
                    appLogger.warn(
                        `[JsonTestGeneration] ${retryResolution.unresolved.length} target(s) still unresolved for ` +
                        `"${effectiveOptions.module}" — proceeding with semantic fallbacks. ` +
                        `Unresolved: ${retryResolution.unresolved.map((u: any) => u.target ?? u).join(', ')}`,
                    );
                    return this.compileAndReturn(retryResolution.spec, options, effectiveOptions, retryResult.tokenUsage);
                }
            } catch (retryErr: any) {
                appLogger.warn(`[JsonTestGeneration] Auto-retry failed: ${retryErr.message}`);
            }

            // Retry unavailable or failed — surface the original hint.
            return {
                success: false,
                errors: [
                    `${resolution.unresolved.length} step target(s) could not be resolved against discovery cache for module "${effectiveOptions.module}".`,
                    retryHint,
                ],
            };
        }

        // All targets resolved — compile and return.
        return this.compileAndReturn(resolution.spec, options, effectiveOptions, result.tokenUsage);
    } catch (e: any) {
        return { success: false, errors: [e.message] };
    }
  }

  /**
   * Shared compilation step — used by both the main path and the B2 retry path.
   * Compiles an already-resolved and validated TestSpecification into Playwright
   * .spec.ts files (one full script + a per-scenario map for execution).
   */
  private static compileAndReturn(
    enrichedSpec: TestSpecification,
    options: JsonGenerationOptions,
    effectiveOptions: JsonGenerationOptions,
    tokenUsage?: { prompt: number; completion: number; total: number }
  ): JsonTestGenerationResult {
    const compilerOptions = {
      baseUrl: options.baseUrl,
      ticketId: options.ticketId,
      moduleName: effectiveOptions.module,
      recordVideo: true,
      recordTrace: true,
      viewport: { width: 1440, height: 900 },
      credentials: options.credentials,
      isLoginTest: options.isLoginTest,
      timeout: 180000,
    };

    const fullScript = compileTestSpec(enrichedSpec, compilerOptions);
    fs.mkdirSync(this.OUTPUT_DIR, { recursive: true });
    const scriptPath = path.join(this.OUTPUT_DIR, `${options.ticketId}_${Date.now()}.spec.ts`);
    fs.writeFileSync(scriptPath, fullScript, 'utf8');

    const compiledScripts: Record<string, string> = {};
    const mcpSteps: Record<string, McpStep[]> = {};

    enrichedSpec.scenarios.forEach(s => {
      const singleScenarioSpec: TestSpecification = {
        ...enrichedSpec,
        scenarios: [JSON.parse(JSON.stringify(s))],
      };
      compiledScripts[s.id] = compileTestSpec(singleScenarioSpec, compilerOptions);

      // Convert spec steps → McpStep[] for TestScriptStore (zero-overhead, sync)
      const converted = this.convertScenarioToMcpSteps(s);
      if (converted.length > 0) {
        mcpSteps[s.id] = converted;
      }
    });

    return {
      success: true,
      specification: enrichedSpec,
      compiledScripts,
      scriptPath,
      mcpSteps,
      tokensUsed: tokenUsage
        ? { prompt: tokenUsage.prompt, completion: tokenUsage.completion, total: tokenUsage.total }
        : { prompt: 0, completion: 0, total: 0 },
    };
  }

  /**
   * Convert a TestScenario's steps into McpStep[] for storage in TestScriptStore.
   * Steps that cannot be mapped are skipped (they'll still work via compiled script).
   *
   * Mapping:
   *   goto         → browser_navigate
   *   click        → browser_click  (uses selectorHint > element)
   *   fill         → browser_type   (uses selectorHint > field)
   *   selectOption → browser_select_option
   *   assertVisible/assertText → browser_snapshot (with assertText metadata)
   *   waitForText  → browser_wait_for
   *   waitForSelector → browser_wait_for
   */
  private static convertScenarioToMcpSteps(scenario: any): McpStep[] {
    const steps: McpStep[] = [];
    if (!Array.isArray(scenario.steps)) return steps;

    for (const s of scenario.steps) {
      const type   = s.type || s.action || '';
      const hint   = s.selectorHint || '';
      const field  = s.field  || s.element || hint || '';
      const elem   = s.element || hint || field;
      const value  = s.value  || s.text || s.expected || '';
      const url    = s.url    || s.target || '';

      try {
        switch (type) {
          case 'goto':
          case 'navigate':
            if (url) steps.push({ action: 'browser_navigate', url });
            break;
          case 'click':
            if (elem) steps.push({ action: 'browser_click', element: elem });
            break;
          case 'fill':
            if (field) steps.push({ action: 'browser_type', element: hint || field, text: value });
            break;
          case 'selectOption':
            if (field && value) steps.push({ action: 'browser_select_option', element: hint || field, option: value });
            break;
          case 'assertVisible':
          case 'assertText':
            // Store assertion as a snapshot step with metadata
            steps.push({ action: 'browser_snapshot' } as McpStep);
            break;
          case 'waitForText':
            if (value || s.text) steps.push({ action: 'browser_wait_for', text: value || s.text });
            break;
          case 'waitForSelector':
            steps.push({ action: 'browser_wait_for', timeout: 5000 });
            break;
          case 'screenshot':
            steps.push({ action: 'browser_take_screenshot' });
            break;
          // skip: check, uploadFile, hover, execute — handled by compiled script
        }
      } catch {
        // skip invalid step
      }
    }
    return steps;
  }

  /**
   * Attempt live MCP discovery.  Returns a new options object with `liveSnapshot`
   * populated.  On any failure, returns the original options unchanged so the
   * caller silently falls back to the stale cache.
   *
   * Timeout: 30 s.  We don't want discovery to block generation for too long.
   */
  private static async tryLiveDiscovery(options: JsonGenerationOptions): Promise<JsonGenerationOptions> {
    if (!options.credentials || !options.baseUrl) return options;

    const DISCOVERY_TIMEOUT_MS = 30_000;
    try {
      appLogger.info(`[JsonTestGeneration] Attempting live discovery for "${options.module}"...`);
      const discovery = await Promise.race([
        McpDiscoveryService.discover({
          module:      options.module,
          baseUrl:     options.baseUrl,
          credentials: {
            username: options.credentials.username,
            password: options.credentials.password,
            idNumber: options.credentials.idNumber,
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Live discovery timed out')), DISCOVERY_TIMEOUT_MS),
        ),
      ]);

      appLogger.info(
        `[JsonTestGeneration] Live discovery succeeded for "${options.module}" ` +
        `(${discovery.snapshot.length} chars, hash=${discovery.selectorHash})`,
      );
      return { ...options, liveSnapshot: discovery.promptContext };

    } catch (err: any) {
      appLogger.warn(
        `[JsonTestGeneration] Live discovery failed for "${options.module}": ${err.message} — using cache`,
      );
      return options; // unchanged — buildPrompt will use DiscoveryCacheService
    }
  }

  private static buildPrompt(options: JsonGenerationOptions): string {
    const sections: string[] = [];
    sections.push(`## Testing Methodology\n\n${ISTQB_CONDENSED}`);

    // ── Discovery context: prefer live snapshot, fall back to cache ──────────
    let discoveryContext: string;
    if (options.liveSnapshot) {
      // Live MCP snapshot: always up-to-date real UI
      discoveryContext = options.liveSnapshot;
      appLogger.info(`[JsonTestGeneration] Using LIVE snapshot for "${options.module}" in prompt`);
    } else {
      // Stale cache fallback
      discoveryContext = DiscoveryCacheService.getPromptContext(options.module, 14) ||
                         DiscoveryCacheService.getSeededPromptContext(options.module) ||
                         '';
      if (discoveryContext) {
        appLogger.debug(`[JsonTestGeneration] Using cached discovery for "${options.module}"`);
      }
    }

    const enterpriseRules = buildEnterpriseRulesBlock({
      ticketType: options.issueType || 'Unknown',
      module: options.module || '',
      discoveryContext,
    });
    sections.push(`## Execution Rules\n\n${enterpriseRules}`);

    if (options.graphPaths?.length) {
      sections.push(this.buildGraphPathsBlock(options.graphPaths));
    }

    const body = sections.join('\n\n---\n\n');
    return ContextManager.trimContext(body, options.ticketId);
  }

  /**
   * Inject missing top-level envelope fields (ticketId, feature, module) from
   * known options so Zod validation never fails due to the AI omitting them.
   * Also handles AI wrapping the real spec inside a wrapper key like
   * "testSpecification", "spec", "result", "output", etc.
   */
  private static patchEnvelope(json: string, opts: JsonGenerationOptions): string {
    try {
      const obj = JSON.parse(json);
      if (typeof obj !== 'object' || Array.isArray(obj)) return json;

      // Unwrap common single-key wrappers: { testSpecification: {...} }
      const topKeys = Object.keys(obj);
      if (topKeys.length === 1 && typeof obj[topKeys[0]] === 'object' && !Array.isArray(obj[topKeys[0]])) {
        const inner = obj[topKeys[0]];
        if (inner.scenarios || inner.ticketId) {
          appLogger.warn(`[JsonTestGeneration] Unwrapping AI wrapper key "${topKeys[0]}"`);
          Object.assign(obj, inner);
          delete obj[topKeys[0]];
        }
      }

      // If still no "scenarios" key, promote the first array field found
      if (!Array.isArray(obj.scenarios)) {
        const arrayKey = Object.keys(obj).find(k => Array.isArray(obj[k]));
        if (arrayKey) {
          appLogger.warn(`[JsonTestGeneration] Promoting key "${arrayKey}" → "scenarios"`);
          obj.scenarios = obj[arrayKey];
          if (arrayKey !== 'scenarios') delete obj[arrayKey];
        }
      }

      // Inject missing required envelope fields from known options
      if (!obj.ticketId) obj.ticketId = opts.ticketId;
      if (!obj.feature)  obj.feature  = opts.summary || opts.ticketId;
      if (!obj.module)   obj.module   = opts.module  || 'Unknown';

      return JSON.stringify(obj);
    } catch {
      return json;
    }
  }

  /**
   * Extract and normalise the raw JSON string from an LLM response.
   *
   * Handles Vertex AI deviation patterns (in order):
   *   1. Markdown code fence  ``` json … ```  → stripped
   *   2. JSON boundary isolation (first { or [)
   *   3. JSONC cleaning — removes line comments, block comments, trailing commas
   *   4. Root is an ARRAY  [...]              → wrapped as { scenarios: [...] }
   *   5. Missing "scenarios" key but has another array key  → remapped
   *   6. Partial/truncated JSON               → best-effort scenario recovery
   */
  private static cleanJsonResponse(response: string): string {
    // ── Step 1: strip the code fence (if present) ─────────────────────────────
    let rawJson = response.trim();
    const fenceMatch = rawJson.match(/```(?:json|javascript|typescript|js|ts)?\s*([\s\S]*?)\s*```/);
    if (fenceMatch) {
      rawJson = fenceMatch[1].trim();
    } else {
      // No fence — find the first meaningful JSON boundary
      const firstBrace   = rawJson.indexOf('{');
      const firstBracket = rawJson.indexOf('[');
      if (firstBrace !== -1 || firstBracket !== -1) {
        const start = firstBrace === -1 ? firstBracket
                    : firstBracket === -1 ? firstBrace
                    : Math.min(firstBrace, firstBracket);
        const openChar  = rawJson[start];
        const closeChar = openChar === '{' ? '}' : ']';
        const end = rawJson.lastIndexOf(closeChar);
        if (end > start) rawJson = rawJson.substring(start, end + 1);
      }
    }

    // ── Step 2: fast-path — try raw parse first (structured=true gives valid JSON) ──
    // When Vertex AI uses responseMimeType:'application/json' it guarantees syntactically
    // valid JSON. Applying repair heuristics to already-valid JSON risks corrupting it
    // (e.g. inserting spurious commas). Only fall through to the repair pipeline if the
    // raw JSON is not parseable.
    try {
      const fastParsed = JSON.parse(rawJson);
      appLogger.debug('[JsonTestGeneration] Fast-path parse succeeded — skipping repair pipeline');
      // Still normalise root shape
      if (Array.isArray(fastParsed)) {
        appLogger.warn('[JsonTestGeneration] AI returned root array — wrapping as { scenarios: [...] }');
        return JSON.stringify({ scenarios: fastParsed });
      }
      if (fastParsed && typeof fastParsed === 'object' && !fastParsed.scenarios) {
        const arrayKey = Object.keys(fastParsed).find(k => Array.isArray(fastParsed[k]));
        if (arrayKey) {
          appLogger.warn(`[JsonTestGeneration] AI returned { ${arrayKey}: [...] } — remapping to { scenarios: [...] }`);
          return JSON.stringify({ ...fastParsed, scenarios: fastParsed[arrayKey] });
        }
      }
      return JSON.stringify(fastParsed);
    } catch {
      // Raw JSON not parseable — fall through to repair pipeline
      appLogger.debug('[JsonTestGeneration] Fast-path parse failed — applying repair pipeline');
    }

    // ── Step 2a: JSONC → JSON (strip comments + trailing commas) ─────────────
    rawJson = this.stripJsonComments(rawJson);

    // ── Step 2b: repair missing commas between array elements ─────────────────
    // AI frequently emits consecutive objects without a comma: {...}\n{...}
    // The state-machine repair is safe: it only touches characters outside strings.
    rawJson = this.repairMissingCommas(rawJson);

    // ── Step 3: parse + normalise (after repair) ──────────────────────────────
    try {
      const parsed = JSON.parse(rawJson);

      // If AI returned a root array, wrap it as { scenarios: [...] }
      if (Array.isArray(parsed)) {
        appLogger.warn('[JsonTestGeneration] AI returned root array — wrapping as { scenarios: [...] }');
        return JSON.stringify({ scenarios: parsed });
      }

      // If AI returned an object without a "scenarios" key but with a different
      // array key (e.g. "testCases", "tests"), promote it.
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (!parsed.scenarios) {
          const arrayKey = Object.keys(parsed).find(k => Array.isArray(parsed[k]));
          if (arrayKey) {
            appLogger.warn(`[JsonTestGeneration] AI returned { ${arrayKey}: [...] } — remapping to { scenarios: [...] }`);
            return JSON.stringify({ ...parsed, scenarios: parsed[arrayKey] });
          }
        }
      }

      return JSON.stringify(parsed);
    } catch {
      // ── Step 3: partial-JSON recovery ─────────────────────────────────────
      // The AI occasionally produces valid JSON that is truncated mid-token by
      // the model's output limit. We try to salvage all complete scenario
      // objects before the cut-off and return a valid (shorter) spec.
      const recovered = this.recoverTruncatedJson(rawJson);
      if (recovered) {
        appLogger.warn(
          `[JsonTestGeneration] Malformed JSON recovered: ` +
          `${recovered.scenarios.length} complete scenario(s) salvaged from truncated response`,
        );
        return JSON.stringify(recovered);
      }
      // Truly unparseable — return stripped text so Zod produces a clear error
      return rawJson;
    }
  }

  /**
   * Repair missing commas between consecutive array elements.
   *
   * AI often outputs objects in arrays without separating commas:
   *   [ {...} {...} ]  →  [ {...}, {...} ]
   *
   * Uses a character-level state machine to only operate outside strings,
   * so JSON string values containing `}{` are not affected.
   */
  private static repairMissingCommas(input: string): string {
    let result = '';
    let inString = false;
    let escape = false;

    for (let i = 0; i < input.length; i++) {
      const ch = input[i];

      if (escape) { result += ch; escape = false; continue; }

      if (inString) {
        if (ch === '\\') { escape = true; result += ch; continue; }
        if (ch === '"') {
          // Closing string quote — look ahead for another array value
          inString = false;
          result += ch;
          let j = i + 1;
          while (j < input.length && ' \t\r\n'.includes(input[j])) j++;
          // If next token is another value start (string/object/array), need a comma.
          // Safe: after a closing string, } and ] don't need commas here —
          // they close the container, not start a new element.
          if (j < input.length && (input[j] === '"' || input[j] === '{' || input[j] === '[')) {
            result += ',';
          }
          continue;
        }
        result += ch;
        continue;
      }

      if (ch === '"') { inString = true; result += ch; continue; }

      result += ch;

      // After a closing brace/bracket, scan ahead for next non-whitespace.
      // If the next real token is an opening brace/bracket (another element),
      // insert a comma to separate them.
      if (ch === '}' || ch === ']') {
        let j = i + 1;
        while (j < input.length && ' \t\r\n'.includes(input[j])) j++;
        if (j < input.length && (input[j] === '{' || input[j] === '[' || input[j] === '"')) {
          result += ',';
        }
      }
    }

    return result;
  }

  /**
   * Convert JSONC (JSON with Comments) to strict JSON.
   *
   * Removes:
   *   • Single-line comments  (double-slash to end of line)
   *   • Multi-line block comments
   *   • Trailing commas before } or ]
   *
   * Uses a character-level state machine to avoid breaking strings.
   */
  private static stripJsonComments(input: string): string {
    let result = '';
    let i = 0;
    let inString = false;
    let escape = false;

    while (i < input.length) {
      const ch = input[i];
      const next = input[i + 1];

      if (escape) {
        result += ch;
        escape = false;
        i++;
        continue;
      }

      if (inString) {
        if (ch === '\\') { escape = true; result += ch; i++; continue; }
        if (ch === '"')  { inString = false; }
        result += ch;
        i++;
        continue;
      }

      // Outside string
      if (ch === '"') { inString = true; result += ch; i++; continue; }

      // Single-line comment
      if (ch === '/' && next === '/') {
        while (i < input.length && input[i] !== '\n') i++;
        continue;
      }

      // Multi-line comment
      if (ch === '/' && next === '*') {
        i += 2;
        while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++;
        i += 2;
        continue;
      }

      result += ch;
      i++;
    }

    // Remove trailing commas: ,  followed by optional whitespace and } or ]
    result = result.replace(/,(\s*[}\]])/g, '$1');

    return result;
  }

  /**
   * Best-effort recovery for truncated JSON.
   *
   * Strategy:
   *  1. Find the outer `{ ... "scenarios": [ ... ] ... }` shell.
   *  2. Walk the `scenarios` array and collect every element that ends with a
   *     complete `}` (i.e., balanced braces).
   *  3. Return a valid spec object with only the complete scenarios.
   *
   * Returns null if nothing useful can be salvaged.
   */
  private static recoverTruncatedJson(raw: string): { scenarios: any[] } | null {
    try {
      // Find the start of the scenarios array under any known key name
      // AI sometimes uses "testScenarios", "testCases", "cases", "tests" instead of "scenarios"
      const SCENARIO_ARRAY_KEYS = [
        '"scenarios"',
        '"testScenarios"',
        '"testCases"',
        '"cases"',
        '"tests"',
        '"test_cases"',
      ];
      let scenariosIdx = -1;
      for (const key of SCENARIO_ARRAY_KEYS) {
        const idx = raw.indexOf(key);
        if (idx !== -1) { scenariosIdx = idx; break; }
      }
      if (scenariosIdx === -1) return null;

      const arrayStart = raw.indexOf('[', scenariosIdx);
      if (arrayStart === -1) return null;

      // Walk character by character collecting complete objects
      const scenarios: any[] = [];
      let depth = 0;
      let inString = false;
      let escape = false;
      let objStart = -1;

      for (let i = arrayStart + 1; i < raw.length; i++) {
        const ch = raw[i];

        if (escape) { escape = false; continue; }
        if (ch === '\\' && inString) { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;

        if (ch === '{') {
          if (depth === 0) objStart = i;
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0 && objStart !== -1) {
            // We have a complete object — try to parse it
            const objText = raw.substring(objStart, i + 1);
            try {
              scenarios.push(JSON.parse(objText));
            } catch {
              // Skip malformed individual object
            }
            objStart = -1;
          }
        } else if (ch === ']' && depth === 0) {
          break; // End of scenarios array
        }
      }

      // Discard scenarios with no steps — they're truncated stubs
      const usable = scenarios.filter(
        (s: any) => Array.isArray(s.steps) && s.steps.length > 0,
      );
      if (usable.length === 0) return null;
      scenarios.length = 0;
      scenarios.push(...usable);

      // Try to recover top-level fields from the outer object
      let ticketId = 'UNKNOWN';
      let feature = 'Unknown';
      let module = 'Unknown';
      try {
        const tidMatch = raw.match(/"ticketId"\s*:\s*"([^"]+)"/);
        const featMatch = raw.match(/"feature"\s*:\s*"([^"]+)"/);
        const modMatch  = raw.match(/"module"\s*:\s*"([^"]+)"/);
        if (tidMatch) ticketId = tidMatch[1];
        if (featMatch) feature = featMatch[1];
        if (modMatch)  module  = modMatch[1];
      } catch {}

      return { scenarios, ticketId, feature, module } as any;
    } catch {
      return null;
    }
  }

  private static buildGraphPathsBlock(paths: import('../graph/ModuleStateGraph').StatePath[]): string {
    if (!paths.length) return '';

    const lines: string[] = [
      '## State Graph Paths (STRUCTURED CONSTRAINTS)',
      '',
      'These paths are derived from the live UI state graph. Each test scenario MUST follow one of these paths.',
      'YOUR ROLE: supply test DATA VALUES only. Selectors/labels are provided — use them exactly.',
      '',
    ];

    for (let i = 0; i < Math.min(paths.length, 5); i++) {
      const p = paths[i];
      lines.push(`### Path ${i + 1} (total cost: ${p.totalCost})`);
      lines.push(`States: ${p.states.join(' → ')}`);
      lines.push('Transitions:');
      p.transitions.forEach((t, idx) => {
        lines.push(`  ${idx + 1}. [${t.transitionType}] Click/interact "${t.triggerSelector}" → wait for ${t.waitFor} → reach ${t.to}`);
      });
      lines.push('');
    }

    lines.push(
      '**CRITICAL RULE**: Generate test steps in the exact order of the transitions above.',
      'Do NOT invent new selectors or actions. Fill in form field values as test data.',
    );

    return lines.join('\n');
  }
}
