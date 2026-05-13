import { CloudAIService } from '../../api/CloudAIService';
import { LocalAIService } from '../../api/LocalAIService';
import { CliAgentService } from '../../api/CliAgentService';
import { config } from '../../api/config';
import { getStepIngestionServer } from '../../api/ws/StepIngestionServer';
import { AiCachingService } from './AiCachingService';
import { moduleConfigs, ModuleConfig } from '../../src/config/module-configs';
import { generateCrudSpec } from '../../src/templates/crud-template';

/**
 * Module Knowledge Interface (from StepIngestionServer)
 */
interface ModuleKnowledge {
    moduleName: string;
    menuLabel: string;
    route: string;
    url: string;
    networkApiMappings: Record<string, string>;
    lastUpdated: string;
}

/**
 * Minified HTML Element for Semantic Fallback
 */
interface MinifiedHtmlElement {
    selector: string;
    role?: string;
    label?: string;
    text?: string;
    type?: string;
}

/**
 * Enhanced Script Generation Options
 */
interface EnhancedGenerationOptions {
    provider?: 'qwen' | 'gemini' | 'codex';
    jiraId?: string;
    moduleName?: string;
    menuLabel?: string;
    useGoalOriented?: boolean;
    includeSemanticFallback?: boolean;
}

/**
 * Enhanced Script Generation Service
 * 
 * Implements Goal-Oriented Execution Flow:
 * - Uses direct page.goto(route) when route/url exists in module-knowledge
 * - Implements Semantic Fallback using getByLabel()/getByRole() when selectors are missing
 * - Leverages Crawler's minified HTML for intelligent locator generation
 */
export class EnhancedScriptGenerationService {
    private static readonly CACHE_CATEGORY = 'enhanced-script';

    /**
     * System Prompt for Goal-Oriented Test Generation
     */
    private static buildSystemPrompt(options: {
        moduleKnowledge?: ModuleKnowledge;
        minifiedHtml?: MinifiedHtmlElement[];
        kendoRules: string;
        playwrightStandards: string;
        businessContext: string;
        helperGuidance?: string;
    }): string {
        const { moduleKnowledge, minifiedHtml, kendoRules, playwrightStandards, businessContext, helperGuidance } = options;

        const goalOrientedRule = moduleKnowledge?.route
            ? `
#### 🎯 RULE 0 — GOAL-ORIENTED NAVIGATION (PRIORITY)
- A route/URL exists in module-knowledge for "${moduleKnowledge.menuLabel}": \`${moduleKnowledge.route}\`
- **The FIRST step of the test MUST be** \`page.goto()\` using the known route instead of clicking through sidebar menus.
- Example:
    \`\`\`typescript
    // Direct navigation to ${moduleKnowledge.menuLabel}
    await page.goto('${moduleKnowledge.route}');
    await page.waitForLoadState('networkidle');
    \`\`\`
- Skip all sidebar/menu clicking steps when direct navigation is available.
`
            : `
#### 🎯 RULE 0 — NAVIGATION
- If no known route exists, navigate through the application menu as recorded.
- Use stable selectors for menu items: [ng-reflect-name], [data-testid], aria-label.
`;

        const semanticFallbackRule = minifiedHtml && minifiedHtml.length > 0
            ? `
#### 🔍 RULE 1 — SEMANTIC FALLBACK (SELECTOR RECOVERY)
- If a recorded selector is missing or fails, use semantic locators based on the minified HTML analysis:
    - Use \`page.getByLabel('...')\` for form inputs with associated labels
    - Use \`page.getByRole('button', { name: '...' })\` for buttons
    - Use \`page.getByRole('textbox')\` for text inputs
    - Use \`page.getByPlaceholder('...')\` for inputs with placeholders
    - Use \`page.getByText('...')\` for elements containing specific text

- Minified HTML elements available for reference:
    ${JSON.stringify(minifiedHtml.slice(0, 10), null, 2)}

- Example fallback strategy:
    \`\`\`typescript
    // Primary: Try recorded selector first
    const primary = page.locator('[ng-reflect-name="username"]');
    if (!await primary.isVisible()) {
        // Fallback 1: Use getByLabel
        const fallback1 = page.getByLabel('Username');
        if (await fallback1.isVisible()) {
            await fallback1.fill('value');
        } else {
            // Fallback 2: Use getByRole
            const fallback2 = page.getByRole('textbox', { name: /username/i });
            await fallback2.fill('value');
        }
    }
    \`\`\`
`
            : `
#### 🔍 RULE 1 — SELECTOR STABILITY
- Use ONLY the sanitized \`target\` selectors provided in the data.
- Do NOT invent selectors. Do NOT use fragile XPaths or CSS nth-child.
- If no target is provided, add a TODO comment: // TODO: verify selector manually
`;

        return `
You are a senior QA automation engineer specializing in Playwright test generation for Angular/Kendo UI applications.

### ═══════════ MANDATORY RULES ═══════════
${goalOrientedRule}
${semanticFallbackRule}

#### 🔒 RULE 2 — Dynamic Environment Strategy (NO HARDCODED VALUES)
- NEVER hardcode URLs. Always use environment variables:
    const baseUrl = process.env.BASE_URL || 'http://localhost:4200';
    const customerId = process.env.CUSTOMER_ID || 'default';
    await page.goto(\`\${baseUrl}/\${customerId}/login\`);
- NEVER hardcode credentials:
    await page.locator('[ng-reflect-name="username"]').fill(process.env.TEST_USER!);
    await page.locator('[ng-reflect-name="password"]').fill(process.env.TEST_PASS!);

#### 🔄 RULE 3 — Event Deduplication
- Combine redundant sequences like (focus → input → blur) into a SINGLE \`page.locator().fill()\` call.
- Never emit separate focus/blur actions.

#### 🛡️ RULE 4 — Self-Healing & Resilience
- Every critical interaction (click/fill) MUST be wrapped in a retry-wait block to handle Kendo UI hydration:
    await expect(page.locator(selector)).toBeVisible({ timeout: 10000 });
    await page.locator(selector).click();
- If a selector contains "k-grid" or "k-dropdown", prioritize [data-role] or [aria-label] over dynamic IDs.
- For SPAs, always use \`await page.waitForLoadState('networkidle')\` after navigation or major form submissions.

#### 🔬 RULE 5 — The Three Pillars (Forensic Audit)
1. **[MATH/API]**: For every \`fetch\` step, generate \`waitForResponse\` to intercept the API call and assert the HTTP status code:
       const apiResponse = await page.waitForResponse(resp =>
           resp.url().includes('/api/endpoint') && resp.request().method() === 'POST'
       );
       expect(apiResponse.status()).toBe(200);
2. **[VISUAL]**: At key UI transition points, add a comment:
       // [VISUAL] expect(page).toHaveScreenshot('step-name.png');
3. **[BEHAVIOR/BDD]**: Use \`test.describe\` and \`test.step\` to structure the test in BDD style.

### KENDO / ANGULAR SELECTOR RULES:
${kendoRules}

${helperGuidance ?? ''}

### PLAYWRIGHT BEST PRACTICES:
${playwrightStandards}

### BUSINESS CONTEXT (GlobalHR):
${businessContext}

### ═══════════ OUTPUT FORMAT ═══════════
- Output ONLY raw TypeScript code. NO markdown fences. NO explanations.
- Include necessary imports: import { test, expect } from '@playwright/test';
- The test must be self-contained and runnable.
`.trim();
    }

    /**
     * Generate enhanced Playwright script with goal-oriented execution
     */
    static async generateEnhancedScript(
        recordingId: string,
        pool: any,
        options: EnhancedGenerationOptions = {}
    ): Promise<string> {
        const {
            provider = 'qwen',
            jiraId,
            moduleName,
            menuLabel,
            useGoalOriented = true,
            includeSemanticFallback = true,
        } = options;

        // ── 1. Fetch recording from DB ──────────────────────────────────
        const { rows } = await pool.query(
            'SELECT app_version, user_id, steps, annotations, recording_url FROM recordings WHERE id = $1',
            [recordingId]
        );

        if (rows.length === 0) throw new Error('Recording not found');
        const recording = rows[0];

        // ── 2. Load Knowledge-Base context ──────────────────────────────
        const kendoRules = this.loadKendoRules();
        const playwrightStandards = this.loadPlaywrightStandards();
        const businessContext = this.loadBusinessContext();

        // ── 3. Fetch Module Knowledge (for Goal-Oriented Navigation) ───
        let moduleKnowledge: ModuleKnowledge | undefined;
        if (useGoalOriented && moduleName && menuLabel) {
            const ingestionServer = getStepIngestionServer();
            if (ingestionServer) {
                moduleKnowledge = ingestionServer.getModuleKnowledge(moduleName, menuLabel);
            }

            // Fallback to cache if not in memory
            if (!moduleKnowledge) {
                const cached = AiCachingService.getCache<ModuleKnowledge>(
                    { cacheKey: `${moduleName}:${menuLabel}` },
                    this.CACHE_CATEGORY as 'plan' | 'script'
                );
                if (cached) {
                    moduleKnowledge = cached;
                }
            }

            if (moduleKnowledge) {
                console.log(`[EnhancedScriptGen] Found route for ${moduleName} > ${menuLabel}: ${moduleKnowledge.route}`);
            }
        }

        // ── 4. Fetch Minified HTML (for Semantic Fallback) ─────────────
        let minifiedHtml: MinifiedHtmlElement[] | undefined;
        if (includeSemanticFallback) {
            minifiedHtml = await this.fetchMinifiedHtmlElements(recordingId, pool);
        }

        const moduleConfig = this.findModuleConfig(moduleName || moduleKnowledge?.moduleName, menuLabel || moduleKnowledge?.menuLabel);
        const helperGuidance = this.buildHelperGuidance(moduleConfig, moduleKnowledge);

        // ── 5. Sanitize steps ──────────────────────────────────────────
        const rawSteps: any[] = recording.steps || [];
        const sanitizedSteps = this.sanitizeStepsForAI(rawSteps);

        console.log(
            `[EnhancedScriptGen] Sanitized ${rawSteps.length} raw steps → ${sanitizedSteps.length} clean steps`
        );

        // ── 6. Build the enhanced prompt ───────────────────────────────
        const prompt = this.buildSystemPrompt({
            moduleKnowledge,
            minifiedHtml,
            kendoRules,
            playwrightStandards,
            businessContext,
            helperGuidance,
        });

        const fullPrompt = `
${prompt}

### RECORDED DATA:
- Module: ${recording.app_version}
- Jira ID: ${jiraId || 'N/A'}
- Recording URL: ${recording.recording_url || 'N/A'}
- Sanitized Steps: ${JSON.stringify(sanitizedSteps, null, 2)}
- User Notes: ${JSON.stringify(recording.annotations, null, 2)}

${moduleKnowledge ? `### MODULE KNOWLEDGE (Use for direct navigation):
- Module: ${moduleKnowledge.moduleName}
- Menu: ${moduleKnowledge.menuLabel}
- Route: ${moduleKnowledge.route}
- URL: ${moduleKnowledge.url}
` : ''}

GENERATE THE PLAYWRIGHT TEST NOW.
        `.trim();

        // ── 7. Call AI Provider ────────────────────────────────────────
        let script: string;
        try {
            script = await this.callAIProvider(fullPrompt, provider);
        } catch (error: any) {
            console.warn(`[EnhancedScriptGen] AI generation failed: ${error.message}. Falling back to helper template.`);
            script = this.buildTemplateFallback(moduleConfig, moduleKnowledge);
        }

        if (!script) {
            script = this.buildTemplateFallback(moduleConfig, moduleKnowledge);
        }

        // ── 8. Cache the generated script ──────────────────────────────
        if (jiraId) {
            AiCachingService.setCache(
                { jiraId, recordingId },
                this.CACHE_CATEGORY as 'plan' | 'script',
                { script, moduleKnowledge, generatedAt: new Date().toISOString() },
                30 * 24 * 60 * 60 * 1000 // 30 days
            );
        }

        return script;
    }

    /**
     * Sanitize steps for AI consumption (same as ScriptGenerationService)
     */
    private static sanitizeStepsForAI(rawSteps: any[]): any[] {
        if (!rawSteps || !Array.isArray(rawSteps)) return [];

        return rawSteps.map((step) => {
            const action = (step.type || step.action || 'unknown').toLowerCase();

            if (['click', 'input', 'blur', 'focus', 'change', 'dblclick'].includes(action)) {
                const target = this.extractStableTarget(step);
                const sanitized: any = {
                    action,
                    description: step.text || undefined,
                    target,
                };

                if (['input', 'change'].includes(action) && step.value !== undefined) {
                    sanitized.value = String(step.value);
                }

                return sanitized;
            }

            if (['fetch', 'xhr', 'api', 'network'].includes(action)) {
                let apiUrl = step.url || '';
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
                };
            }

            if (['navigate', 'goto', 'navigation'].includes(action)) {
                return {
                    action: 'navigate',
                    description: step.url || step.text || '',
                };
            }

            return {
                action,
                description: step.text || step.selector || '',
            };
        });
    }

    /**
     * Extract stable target selector from step
     */
    private static extractStableTarget(step: any): string {
        const attrs = step.componentInfo?.attributes;
        if (attrs && Array.isArray(attrs)) {
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
                    (a: any) => a.name?.toLowerCase() === attrName && a.value
                );
                if (found) {
                    return `[${found.name}="${found.value}"]`;
                }
            }
        }

        return step.selector || 'unknown';
    }

    /**
     * Fetch minified HTML elements from Crawler's storage
     */
    private static async fetchMinifiedHtmlElements(
        recordingId: string,
        pool: any
    ): Promise<MinifiedHtmlElement[] | undefined> {
        try {
            // Try to fetch from object_repository or crawler storage
            const { rows } = await pool.query(
                `SELECT minified_html, page_url FROM crawler_pages 
                 WHERE recording_id = $1 OR page_url = $2 
                 ORDER BY crawled_at DESC LIMIT 1`,
                [recordingId, recordingId]
            );

            if (rows.length > 0 && rows[0].minified_html) {
                const minifiedData = JSON.parse(rows[0].minified_html);
                return minifiedData.elements?.map((el: any) => ({
                    selector: el.selector,
                    role: el.role,
                    label: el.label,
                    text: el.textContent,
                    type: el.type,
                })) || undefined;
            }
        } catch (error: any) {
            console.warn('[EnhancedScriptGen] Failed to fetch minified HTML:', error.message);
        }

        return undefined;
    }

    /**
     * Load Kendo rules from SkillRegistry or file
     */
    private static loadKendoRules(): string {
        try {
            // Try SkillRegistry first
            const { SkillRegistry } = require('../SkillRegistry');
            return SkillRegistry.executeSkill('KENDO_SELECTOR_RULES', {}) || '';
        } catch {
            return `
# Kendo UI Selector Rules
- Prefer [data-role] over dynamic IDs
- Use [aria-label] for accessibility-aware selection
- For grids: .k-grid tbody tr for rows, .k-grid-header for headers
- For dropdowns: .k-dropdown-wrap .k-input for input, .k-list-container for list
- Wait for .k-loading-mask to be hidden before interactions
`;
        }
    }

    /**
     * Load Playwright standards from SkillRegistry or file
     */
    private static loadPlaywrightStandards(): string {
        try {
            const { SkillRegistry } = require('../SkillRegistry');
            return SkillRegistry.executeSkill('PLAYWRIGHT_STANDARDS', {}) || '';
        } catch {
            return `
# Playwright Best Practices
- Use expect().toBeVisible() before interactions
- Use waitForLoadState('networkidle') after navigation
- Use waitForResponse() for API assertions
- Use test.step() for BDD-style structure
`;
        }
    }

    /**
     * Load business context from SkillRegistry or file
     */
    private static loadBusinessContext(): string {
        try {
            const { SkillRegistry } = require('../SkillRegistry');
            return SkillRegistry.executeSkill('GLOBALHR_CONTEXT', {}) || '';
        } catch {
            return 'GlobalHR Cloud Application - HR Management System';
        }
    }

    private static findModuleConfig(moduleName?: string, menuLabel?: string): ModuleConfig | undefined {
        const target = (moduleName || menuLabel || '').toLowerCase();
        if (!target) return undefined;
        return moduleConfigs.find((cfg) => cfg.name.toLowerCase() === target);
    }

    private static buildHelperGuidance(moduleConfig?: ModuleConfig, moduleKnowledge?: ModuleKnowledge): string {
        if (!moduleConfig) return '';
        const routeHint = moduleKnowledge?.route || moduleConfig.baseRoute;
        return `
### HELPER MODULE GUIDANCE (${moduleConfig.name})
- Template generator: \`backend/src/templates/crud-template.ts\` (imports all helpers).
- Use helpers:\`fillFormField\`, \`healedClick\`, \`filterKendoGrid\`, \`waitForAppReady\`, \`waitForKendoLoader\` from \`backend/src/helpers\`.
- Primary selector hints: ${Object.entries(moduleConfig.selectors || {}).map(([key, val]) => `${key}= ${val}`).join(', ') || 'none'}
- Sample route: ${routeHint}
`.trim();
    }

    private static buildTemplateFallback(moduleConfig?: ModuleConfig, moduleKnowledge?: ModuleKnowledge): string {
        const targetModule = moduleConfig || moduleConfigs[0];
        if (!targetModule) {
            return `// Fallback template unavailable because no module configuration was found.`;
        }
        return generateCrudSpec(targetModule);
    }

    /**
     * Call AI provider based on options.
     * Routes through MultiAgentRouter for HTTP-based models or CliAgentService for CLI tools.
     */
    private static async callAIProvider(
        prompt: string,
        provider: 'qwen' | 'gemini' | 'codex'
    ): Promise<string> {
        if (['qwen', 'gemini', 'codex'].includes(provider)) {
            console.log(`[EnhancedScriptGen] Using CLI provider: ${provider}`);
            const result = await CliAgentService.generateFromCli(prompt, provider);
            return this.cleanGeneratedCode(result);
        }

        // Default: Use MultiAgentRouter (OpenRouter Qwen via HTTP API)
        try {
            const { MultiAgentRouter } = require('../MultiAgentRouter');
            const result = await MultiAgentRouter.route('CODER', prompt, false);
            return this.cleanGeneratedCode(result.response);
        } catch (error: any) {
            console.warn(`[EnhancedScriptGen] AI provider failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Clean generated code (remove markdown fences)
     */
    private static cleanGeneratedCode(raw: string): string {
        let code = raw.trim();
        code = code.replace(/^```(?:typescript|ts)?\s*\n?/i, '');
        code = code.replace(/\n?```\s*$/i, '');
        return code.trim();
    }
}
