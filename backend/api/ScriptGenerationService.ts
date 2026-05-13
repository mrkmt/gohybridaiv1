import fetch from 'node-fetch';
import { AgentOrchestrator } from './AgentOrchestrator';
import { SkillRegistry } from './SkillRegistry';
import { CliAgentService } from './CliAgentService';
import { MultiAgentRouter } from './MultiAgentRouter';
import { config } from './config';

// ---------------------------------------------------------------------------
// Types for Harvester recording steps
// ---------------------------------------------------------------------------
interface HarvesterAttribute {
    name: string;
    value: string;
}

interface ComponentInfo {
    attributes?: HarvesterAttribute[];
}

interface HarvesterStep {
    type?: string;
    action?: string;
    text?: string;
    selector?: string;
    value?: string;
    url?: string;
    componentInfo?: ComponentInfo;
    requestBody?: any;
    responseBody?: any;
    method?: string;
    [key: string]: any; // allow extra fields we will discard
}

interface SanitizedStep {
    action: string;
    description?: string;
    target?: string;
    value?: string;
    api_url?: string;
    method?: string;
}

// ---------------------------------------------------------------------------
// 1. DATA SANITISATION — strip noisy fields BEFORE sending to the LLM
// ---------------------------------------------------------------------------

/**
 * Reduces raw Harvester JSON steps to the minimal payload the LLM actually
 * needs. This prevents OOM / context-pressure crashes on small models.
 */
function sanitizeStepsForAI(rawSteps: HarvesterStep[]): SanitizedStep[] {
    if (!rawSteps || !Array.isArray(rawSteps)) return [];

    return rawSteps.map((step) => {
        const action = (step.type || step.action || 'unknown').toLowerCase();

        // ----- UI actions: click, input, blur, focus, etc. -----
        if (['click', 'input', 'blur', 'focus', 'change', 'dblclick'].includes(action)) {
            // Prioritise stable Angular / form-control attributes as the target
            const target = extractStableTarget(step);

            const sanitized: SanitizedStep = {
                action,
                description: step.text || undefined,
                target,
            };

            // Attach value only for input-style actions
            if (['input', 'change'].includes(action) && step.value !== undefined) {
                sanitized.value = String(step.value);
            }

            return sanitized;
        }

        // ----- API / network actions: fetch, xhr, api -----
        if (['fetch', 'xhr', 'api', 'network'].includes(action)) {
            let apiUrl = step.url || '';
            // Strip query parameters — they are noisy and often contain tokens
            try {
                const parsed = new URL(apiUrl);
                apiUrl = `${parsed.origin}${parsed.pathname}`;
            } catch {
                // keep raw url if parsing fails
            }

            return {
                action: 'fetch',
                api_url: apiUrl,
                method: (step.method || 'GET').toUpperCase(),
            } as SanitizedStep;
        }

        // ----- Navigation actions -----
        if (['navigate', 'goto', 'navigation'].includes(action)) {
            return {
                action: 'navigate',
                description: step.url || step.text || '',
            } as SanitizedStep;
        }

        // ----- Fallback: keep minimal info only -----
        return {
            action,
            description: step.text || step.selector || '',
        } as SanitizedStep;
    });
}

/**
 * Extracts the most stable selector from a step's componentInfo attributes.
 * Priority: ng-reflect-name > formcontrolname > name > data-testid > id > fallback to step.selector.
 */
function extractStableTarget(step: HarvesterStep): string {
    const attrs = step.componentInfo?.attributes;
    if (attrs && Array.isArray(attrs)) {
        // Priority order for stable selectors
        const priorityAttrs = [
            'ng-reflect-name',
            'formcontrolname',
            'name',
            'data-testid',
            'data-test-id',
            'id',
        ];

        for (const attrName of priorityAttrs) {
            const found = attrs.find(
                (a) => a.name?.toLowerCase() === attrName && a.value
            );
            if (found) {
                return `[${found.name}="${found.value}"]`;
            }
        }
    }

    // Fallback to the raw selector if no stable attribute was found
    return step.selector || 'unknown';
}

// ---------------------------------------------------------------------------
// 2. STRICT SYSTEM PROMPT — enforces Playwright generation rules
// ---------------------------------------------------------------------------

const STRICT_SYSTEM_PROMPT = `
You are a senior QA automation engineer. Generate a SINGLE, complete TypeScript Playwright test file (.spec.ts) from the sanitized Harvester recording data below.

### ═══════════ MANDATORY RULES ═══════════

#### 🔒 RULE 1 — Dynamic Environment Strategy (NO HARDCODED VALUES)
- NEVER hardcode URLs. Always use environment variables:
    const baseUrl = process.env.BASE_URL || 'http://localhost:4200';
    const customerId = process.env.CUSTOMER_ID || 'default';
    await page.goto(\`\${baseUrl}/\${customerId}/#/login\`);
- NEVER hardcode credentials:
    await page.fill('[ng-reflect-name="username"]', process.env.TEST_USER!);
    await page.fill('[ng-reflect-name="password"]', process.env.TEST_PASS!);

#### 🎯 RULE 2 — Stable Selectors ONLY
- Use ONLY the sanitized \`target\` selectors provided in the data.
- Do NOT invent selectors. Do NOT use fragile XPaths or CSS nth-child.
- ⚠️ FORBIDDEN: [ng-reflect-*] attributes (Angular strips these in production).
  Instead use: [name="username"], #username, input[type="password"], [data-testid="..."]
- ⚠️ ICON-ONLY BUTTONS: If the target button has no text (e.g., "+" icon for "Add New"),
  NEVER use button:has-text("..."). Use CSS class or attribute selectors instead:
  '.k-button-add', 'button[title*="Add"]', 'button[aria-label*="Add"]', 'button:has(svg)'

#### 🔄 RULE 3 — Event Deduplication
- Combine redundant sequences like (focus → input → blur) into a SINGLE \`page.fill()\` call.
- Never emit separate focus/blur actions.

#### 🛡️ RULE 4 — Self-Healing & Resilience
- Import and use healedClick() / universalFill() from playwright-self-healing:
    import { healedClick, universalFill, waitForAngular, kendoStabilizationDelay } from './playwright-self-healing';
  - Use \`await healedClick(page, 'selector', 'ElementName')\` instead of \`page.click()\`
  - Use \`await universalFill(page, 'selector', 'value', { isKendo: true })\` instead of \`page.fill()\`
- Before every interaction, assert visibility:
    await expect(page.locator(selector)).toBeVisible({ timeout: 10000 });
- If a selector contains "k-grid" or "k-dropdown", prioritize [data-role] or [aria-label] over dynamic IDs.

#### 🌐 RULE 5 — Angular/Kendo UI Stability
- For Angular SPAs, use waitUntil: 'domcontentloaded' — NEVER 'networkidle' (Angular has constant background polling).
- After navigation, call \`await waitForAngular(page)\` before interacting.
- After every Kendo UI interaction (Save/Edit/Add), call \`await kendoStabilizationDelay(page, 1000)\`.
- Kendo loading masks (.k-loading-mask) are handled by healedClick — no explicit waits needed.

#### 🔬 RULE 6 — The Three Pillars (Forensic Audit)
1. **[MATH/API]**: For every API-triggering action, generate \`waitForResponse\` to intercept the API call:
       const apiResponse = await page.waitForResponse(resp =>
           resp.url().includes('/api/endpoint') && resp.request().method() === 'POST'
       );
       expect(apiResponse.status()).toBe(200);
2. **[VISUAL]**: At key UI transition points, add a comment:
       // [VISUAL] expect(page).toHaveScreenshot('step-name.png');
3. **[BEHAVIOR/BDD]**: Use \`test.describe\` and \`test.step\` to structure the test in BDD style.

### ═══════════ OUTPUT FORMAT ═══════════
- Output ONLY raw TypeScript code. NO markdown fences. NO explanations.
- Include necessary imports: import { test, expect } from '@playwright/test';
- Import self-healing helpers from playwright-self-healing.
- The test must be self-contained and runnable.
`.trim();

// ---------------------------------------------------------------------------
// 3. THE REFACTORED SERVICE
// ---------------------------------------------------------------------------

export class ScriptGenerationService {
    /**
     * Generates a Playwright script from a Harvester recording.
     * Pipeline: Sanitize → Build Prompt → Call AI (with resilient timeout).
     */
    static async generateFromRecording(
        recordingId: string,
        pool: any,
        options?: { provider?: 'qwen' | 'gemini' | 'codex' }
    ): Promise<string> {
        // ── 1. Fetch recording from DB ──────────────────────────────────
        const { rows } = await pool.query(
            'SELECT app_version, user_id, steps, annotations FROM recordings WHERE id = $1',
            [recordingId]
        );

        if (rows.length === 0) throw new Error('Recording not found');
        const recording = rows[0];

        // ── 2. Load Knowledge-Base context ──────────────────────────────
        const kendoRules = SkillRegistry.executeSkill('KENDO_SELECTOR_RULES', {});
        const playwrightStandards = SkillRegistry.executeSkill('PLAYWRIGHT_STANDARDS', {});
        const globalhrContext = SkillRegistry.executeSkill('GLOBALHR_CONTEXT', {});

        // Domain Knowledge (new — from External Logic/Domain Knowledge)
        let istqbKnowledge = '';
        let userGuide = '';
        let jiraBugPatterns = '';
        try { istqbKnowledge = SkillRegistry.executeSkill('ISTQB_TESTING', {}); } catch { /* optional */ }
        try { userGuide = SkillRegistry.executeSkill('GLOBALHR_USERGUIDE', {}); } catch { /* optional */ }
        try { jiraBugPatterns = SkillRegistry.executeSkill('JIRA_BUG_PATTERNS', {}); } catch { /* optional */ }

        console.log(`[ScriptGen] Loaded Knowledge Base: 
            Kendo Rules: ${kendoRules.includes('# KMT') ? 'MD (NEW)' : 'JSON (OLD)'}
            Playwright Standards: ${playwrightStandards.includes('# Playwright') ? 'MD (NEW)' : 'JSON (OLD)'}
            GlobalHR Context: ${globalhrContext.includes('# GlobalHR') ? 'MD (NEW)' : 'JSON (OLD)'}
            ISTQB Testing: ${istqbKnowledge ? '✅ LOADED' : '❌ MISSING'}
            GlobalHR UserGuide: ${userGuide ? '✅ LOADED' : '❌ MISSING'}
            Jira Bug Patterns: ${jiraBugPatterns ? '✅ LOADED' : '❌ MISSING'}`);

        // ── 3. SANITISE — strip noisy data (Context Pressure fix) ───────
        const rawSteps: HarvesterStep[] = recording.steps || [];
        const sanitizedSteps = sanitizeStepsForAI(rawSteps);

        console.log(
            `[ScriptGen] Sanitized ${rawSteps.length} raw steps → ${sanitizedSteps.length} clean steps ` +
            `(${JSON.stringify(rawSteps).length} bytes → ${JSON.stringify(sanitizedSteps).length} bytes)`
        );

        // ── 4. Build the final prompt ───────────────────────────────────
        const prompt = `
${STRICT_SYSTEM_PROMPT}

### KENDO / ANGULAR SELECTOR RULES:
${kendoRules}

### PLAYWRIGHT BEST PRACTICES:
${playwrightStandards}

### BUSINESS CONTEXT (GlobalHR):
${globalhrContext}

${userGuide ? `### SYSTEM USER GUIDE (GlobalHR Cloud):\n${userGuide}` : ''}

${jiraBugPatterns ? `### KNOWN BUG PATTERNS (from Jira):\n${jiraBugPatterns}` : ''}

${istqbKnowledge ? `### TESTING METHODOLOGY (ISTQB):\n${istqbKnowledge}` : ''}

### RECORDED DATA:
- Module: ${recording.app_version}
- Sanitized Steps: ${JSON.stringify(sanitizedSteps, null, 2)}
- User Notes: ${JSON.stringify(recording.annotations, null, 2)}

GENERATE THE PLAYWRIGHT TEST NOW.
        `.trim();

        // ── 5. Call AI with resilience ──────────────────────────────────
        const provider = options?.provider || 'qwen';

        try {
            // If a CLI provider is requested, use the CliAgentService path
            if (['qwen', 'gemini', 'codex'].includes(provider)) {
                console.log(`[ScriptGen] Using CLI provider: ${provider}`);
                return cleanGeneratedCode(
                    await CliAgentService.generateFromCli(prompt, provider)
                );
            }

            // Default: Use MultiAgentRouter for HTTP API-based generation
            const result = await MultiAgentRouter.route('CODER', prompt, false);
            return cleanGeneratedCode(result.response);
        } catch (error: any) {
            console.warn(`[ScriptGen] AI generation failed: ${error.message}`);
            throw error;
        }
    }
}

// ---------------------------------------------------------------------------
// Helper: clean markdown fences and stray text from generated code
// ---------------------------------------------------------------------------

function cleanGeneratedCode(raw: string): string {
    let code = raw.trim();

    // Remove markdown code fences if the model wrapped them
    code = code.replace(/^```(?:typescript|ts)?\s*\n?/i, '');
    code = code.replace(/\n?```\s*$/i, '');

    return code.trim();
}