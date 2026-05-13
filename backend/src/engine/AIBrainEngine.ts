import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { LocalAIService } from '../../api/LocalAIService';
import { BusinessRule, BusinessRulesService } from '../services/execution/BusinessRulesService';
import { ElementRepositoryService, PageElement } from '../services/ElementRepositoryService';
import { DbClient } from '../services/shared/TelemetryService';
import { appLogger } from '../utils/logger';
import { SmartSkillManager, SkillPattern } from '../services/skills/SmartSkillManager';
import { ISTQB_STANDARDS, IstqbKnowledgeService } from '../../api/IstqbKnowledgeService';
import { UnifiedSkillResolver, ResolvedSkill } from '../services/skills/UnifiedSkillResolver';
import { PageElementDiscoveryService, ElementInfo } from '../services/discovery/PageElementDiscoveryService';
import { DiscoveryCacheService } from '../services/discovery/DiscoveryCacheService';
import { ModuleRegistry } from '../services/shared/ModuleRegistry';
import { SharedBrowserPool } from '../services/discovery/SharedBrowserPool';
import { VectorKnowledgeService } from '../services/VectorKnowledgeService';

// ============================================================================
// CONFIDENCE SCORING INTERFACES
// ============================================================================

export interface ModuleDetectionResult {
    module: string;
    menu: string;
    confidence: number;
    requiresManual: boolean;
    method: 'exact' | 'fuzzy' | 'semantic' | 'registry' | 'default';
    alternatives: string[];
}

export interface ElementDiscoveryResult {
    elements: ElementInfo[];
    source: 'cache' | 'live' | 'static';
    validated: boolean;
    usableCount: number;
    totalCount: number;
}

export interface RuleMatchResult {
    rule: BusinessRule | null;
    skillPatterns: SkillPattern[];
    gaps: string[];
    source: 'db' | 'synthesized' | 'none';
}

export interface ISTQBChecklist {
    boundaryFields: string[];
    equivalenceFields: string[];
    errorPaths: string[];
}

export interface CodeValidation {
    compiles: boolean;
    selectorsValid: boolean;
    istqbCoverage: {
        boundary: boolean;
        equivalence: boolean;
        errorPath: boolean;
    };
    issues: string[];
}

export interface GenerationConfidence {
    overall: number;
    moduleDetection: number;
    uiElements: {
        count: number;
        source: string;
        validated: boolean;
    };
    businessRule: {
        source: string;
        gaps: string[];
    };
    skillPatterns: {
        count: number;
        quality: 'strong' | 'weak' | 'none';
    };
    istqbCoverage: {
        boundary: boolean;
        equivalence: boolean;
        errorPath: boolean;
    };
    codeValidation: {
        compiles: boolean;
        selectorsValid: boolean;
    };
}

export interface TestGenerationResult {
    code: string;
    confidence: GenerationConfidence;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    requiresManualReview: boolean;
    recommendations: string[];
}

export interface JiraIssue {
    issueType: string;
    summary: string;
    description: string;
    comments: string;
}

export class AIBrainEngine {
    private pool: DbClient;

    private static MODULE_ROUTES: Map<string, string> = new Map([
        ['Designation', '#/app.designation'],
        ['Department', '#/app.department'],
        ['Grade', '#/app.grade'],
        ['Leave Type', '#/app.leavetype'],
        ['Team Setup', '#/app.teamsetup'],
        ['Label Setup', '#/app.labelsetup'],
        ['Keyword', '#/app.keyword'],
        ['Public Holiday', '#/app.publicholiday'],
        ['GPS Location', '#/app.gpslocation'],
        ['Employee', '#/app.employee'],
        ['User Level', '#/app.userlevel'],
        ['Menu Permission', '#/app.menupermission'],
        ['Time Attendance', '#/app.timeattendance'],
        ['Performance Journal', '#/app.performancejournal'],
    ]);

    constructor(pool: DbClient) {
        this.pool = pool;
        VectorKnowledgeService.setPool(pool);
    }

    public async processJiraIssue(issue: JiraIssue): Promise<string> {
        appLogger.info(`[AIBrainEngine] Processing Issue: ${issue.summary}`);

        // Step 1: Context Mapping + Skill lookup + Gap detection
        const result = await this.mapContextToRule(issue);
        const matchedRule = result.rule;

        if (result.gaps.length > 0) {
            appLogger.warn(`[AIBrainEngine] Gaps detected: ${result.gaps.join('; ')}`);
        }

        if (matchedRule) {
            await this.saveSynthesizedRule(matchedRule, issue, this.pool);
        }

        // Step 1.5: Resolve unified skills
        const targetModule = matchedRule?.module || this.extractModuleFromIssue(issue);
        const unifiedSkills = await UnifiedSkillResolver.forIssue(issue.issueType, targetModule);

        // Step 2: Auto-Discovery — cache first, live if needed
        const relevantElements = await this.getUIElementsForModule(targetModule);

        // Step 3 & 4: Test Generation
        const { code: playwrightCode } = await this.generatePlaywrightCode(issue, matchedRule, relevantElements, result.skillPatterns, unifiedSkills);

        return playwrightCode;
    }

    // ============================================================================
    // AUTO-DISCOVERY: Cache-first element resolution
    // ============================================================================

    /**
     * Get UI elements for a module.
     * 1. Check discovery cache — instant if fresh (<24h)
     * 2. Auto-discover live page if cache is stale/missing
     * 3. Fall back to static repository
     */
    private async getUIElementsForModule(moduleName: string | undefined): Promise<ElementInfo[]> {
        if (!moduleName) {
            return await this.fallbackToStaticRepo();
        }

        // Step 1: Check cache — instant hit
        const promptContext = DiscoveryCacheService.getPromptContext(moduleName);
        if (promptContext) {
            const status = DiscoveryCacheService.getStatus(moduleName);
            appLogger.info(`[AIBrainEngine] Cache HIT: ${moduleName} (${status.age}, v${status.version}, ${status.elementCount} elements)`);
            return await this.cachedToElementInfos(moduleName);
        }

        // Step 2: Live discovery
        appLogger.info(`[AIBrainEngine] Cache MISS: ${moduleName} — auto-discovering live page`);
        const hashRoute = this.resolveHashRoute(moduleName);

        try {
            const elements = await this.discoverLivePage(hashRoute, moduleName);
            if (elements.length > 0) {
                appLogger.info(`[AIBrainEngine] Auto-discovery OK: ${elements.length} elements from ${moduleName}`);
                return elements;
            }
        } catch (err: any) {
            appLogger.warn(`[AIBrainEngine] Live discovery failed for ${moduleName}: ${err.message}`);
        }

        // Step 3: Fallback to static repo
        return await this.fallbackToStaticRepo(moduleName);
    }

    /**
     * Log in to the baseline account, navigate to a page, scan elements, cache the result.
     * Uses SharedBrowserPool for browser reuse (first launch ~30s, subsequent ~5-15s).
     */
    private async discoverLivePage(hashRoute: string, moduleName: string): Promise<ElementInfo[]> {
        const baseUrl = process.env.BASE_URL;
        if (!baseUrl) {
            throw new Error('[AIBrainEngine] BASE_URL environment variable is not set. Cannot run discovery or execution.');
        }

        const username = process.env.TEST_USERNAME;
        if (!username) {
            throw new Error('[AIBrainEngine] TEST_USERNAME environment variable is not set.');
        }

        const password = process.env.TEST_PASSWORD;
        if (!password) {
            throw new Error('[AIBrainEngine] TEST_PASSWORD environment variable is not set.');
        }

        const idNumber = process.env.TEST_IDNUMBER || '';

        appLogger.info(`[AIBrainEngine] Acquiring browser for discovery: ${baseUrl}${hashRoute}`);
        const start = Date.now();

        // Acquire browser from shared pool (reuses existing or launches fresh)
        const pool = SharedBrowserPool.getInstance();
        const handle = await pool.acquireContext();
        const { browser, context, page } = handle;

        try {
            // Login (skipped if already authenticated from previous discovery)
            await pool.performLogin(page, `${baseUrl}#/login`, { idNumber, username, password });

            // Navigate to target page
            await page.goto(`${baseUrl}${hashRoute}`, { waitUntil: 'commit', timeout: 60000 });
            await page.waitForTimeout(3000);
            await pool.waitForAngularStable(page, 8000);

            // Discover elements
            const inventory = await PageElementDiscoveryService.discoverPage(page, {
                pageName: moduleName,
                section: moduleName,
                deepScan: false,
            });

            // Cache the result
            const cache = DiscoveryCacheService.save(inventory, hashRoute, undefined, moduleName);

            // Also save to static repository for long-term persistence
            const saved = await PageElementDiscoveryService.saveToRepository(inventory, {
                relatedModule: moduleName,
            });

            const elapsed = Date.now() - start;
            const stats = pool.getStats();
            appLogger.info(`[AIBrainEngine] Discovery complete: ${cache.version} cached, ${saved.saved} saved to repo (${elapsed}ms, browser launches: ${stats.launchCount}, reuses: ${stats.reuseCount})`);

            return this.inventoryToElementInfos(cache.inventory);
        } catch (err: any) {
            appLogger.error(`[AIBrainEngine] Discovery error for ${moduleName}: ${err.message}`);
            throw err;
        } finally {
            // Release browser back to pool (keeps it alive for reuse)
            await pool.releaseContext(handle);
        }
    }

    // ============================================================================
    // MODULE NAME NORMALIZATION
    // ============================================================================

    /**
     * Normalize module names from Jira ticket text to known names.
     * e.g., "designation", "Designations", "Designation Module" → "Designation"
     */
    private normalizeModuleName(raw: string): string {
        const lower = raw.toLowerCase().trim();
        const known: Map<string, string> = new Map([
            ['designation', 'Designation'],
            ['designations', 'Designation'],
            ['department', 'Department'],
            ['departments', 'Department'],
            ['grade', 'Grade'],
            ['grades', 'Grade'],
            ['leave type', 'Leave Type'],
            ['leavetype', 'Leave Type'],
            ['team', 'Team Setup'],
            ['team setup', 'Team Setup'],
            ['label', 'Label Setup'],
            ['label setup', 'Label Setup'],
            ['keyword', 'Keyword'],
            ['keywords', 'Keyword'],
            ['holiday', 'Public Holiday'],
            ['public holiday', 'Public Holiday'],
            ['gps', 'GPS Location'],
            ['gps location', 'GPS Location'],
            ['employee', 'Employee'],
            ['employees', 'Employee'],
            ['user level', 'User Level'],
            ['menu', 'Menu Permission'],
            ['menu permission', 'Menu Permission'],
            ['time', 'Time Attendance'],
            ['time attendance', 'Time Attendance'],
            ['performance', 'Performance Journal'],
            ['performance journal', 'Performance Journal'],
            ['journal', 'Performance Journal'],
        ]);
        return known.get(lower) || raw;
    }

    /**
     * Extract module name from Jira issue text.
     */
    private extractModuleFromIssue(issue: JiraIssue): string | undefined {
        const text = `${issue.summary} ${issue.description}`.toLowerCase();
        for (const [keyword, moduleName] of AIBrainEngine.MODULE_ROUTES) {
            const normalizedKey = keyword.toLowerCase().replace(/\s+/g, '');
            if (text.includes(normalizedKey)) return moduleName;
        }

        const candidates = ModuleRegistry.findSimilar(text).sort((a, b) => Number(b.confirmed) - Number(a.confirmed));
        if (candidates.length > 0) {
            return candidates[0].moduleName;
        }
        return undefined;
    }

    /**
     * Guess the hash route from an unknown module name.
     */
    private guessRouteFromModule(moduleName: string): string {
        const normalized = moduleName.toLowerCase()
            .replace(/\s+/g, '')
            .replace(/[^a-z0-9]/g, '');
        return `#/app.${normalized}`;
    }

    private resolveHashRoute(moduleName: string): string {
        const normalized = this.normalizeModuleName(moduleName);
        const directRegistryHit = ModuleRegistry.findSimilar(normalized)
            .sort((a, b) => Number(b.confirmed) - Number(a.confirmed))
            .find(m => !!m.uiRoute);

        if (directRegistryHit?.uiRoute) {
            const route = directRegistryHit.uiRoute.startsWith('/#')
                ? directRegistryHit.uiRoute.slice(1)
                : directRegistryHit.uiRoute;
            return route.startsWith('#/') ? route : `#/${route.replace(/^\/+/, '')}`;
        }

        return AIBrainEngine.MODULE_ROUTES.get(normalized) ||
            AIBrainEngine.MODULE_ROUTES.get(moduleName) ||
            this.guessRouteFromModule(normalized);
    }

    // ============================================================================
    // CACHE CONVERSION HELPERS
    // ============================================================================

    /**
     * Convert cached discovery inventory to ElementInfo[] (AI-friendly format).
     */
    private async cachedToElementInfos(moduleName: string): Promise<ElementInfo[]> {
        const context = DiscoveryCacheService.getPromptContext(moduleName);
        if (!context) return [];

        const cache = DiscoveryCacheService.get(moduleName);
        if (!cache) return [];

        return this.inventoryToElementInfos(cache.inventory);
    }

    /**
     * Convert PageInventory to ElementInfo[].
     */
    private inventoryToElementInfos(inventory: import('../services/discovery/PageElementDiscoveryService').PageInventory): ElementInfo[] {
        const elements: ElementInfo[] = [];

        for (const btn of inventory.buttons) {
            elements.push({ ...btn, type: 'button' });
        }
        for (const inp of inventory.inputs) {
            elements.push({ ...inp, type: inp.type === 'textarea' ? 'textarea' : 'input' });
        }
        for (const dd of inventory.dropdowns) {
            elements.push({ ...dd, type: 'select' });
        }
        for (const grid of inventory.grids) {
            elements.push({
                name: `Grid (${grid.columns.join(', ')})`,
                selector: grid.selector,
                altSelectors: [],
                type: 'grid',
                attributes: {
                    columns: grid.columns.join('|'),
                    isKendo: String(grid.isKendo),
                    hasSearch: String(grid.hasSearch),
                    hasToolbar: String(grid.hasToolbar),
                    hasExport: String(grid.hasExport),
                    rowCount: String(grid.estimatedRowCount),
                },
                isVisible: true,
                isEnabled: true,
            });
        }
        if (inventory.pagination) {
            elements.push({
                name: 'Pagination',
                selector: inventory.pagination.selector,
                altSelectors: [],
                type: 'pagination',
                attributes: {
                    hasPageNumbers: String(inventory.pagination.hasPageNumbers),
                    hasNextPrev: String(inventory.pagination.hasNextPrev),
                },
                isVisible: true,
                isEnabled: true,
            });
        }
        for (const cb of inventory.checkboxes) {
            elements.push({ ...cb, type: 'checkbox' });
        }
        for (const radio of inventory.radios) {
            elements.push({ ...radio, type: 'radio' });
        }

        return elements;
    }

    /**
     * Fallback: get elements from static ElementRepositoryService.
     */
    private async fallbackToStaticRepo(moduleName?: string): Promise<ElementInfo[]> {
        try {
            const repoElements = await ElementRepositoryService.getAll();
            const filtered = moduleName
                ? repoElements.filter(el =>
                    el.page.toLowerCase().includes(moduleName.toLowerCase()) ||
                    el.relatedModule?.toLowerCase().includes(moduleName.toLowerCase()) ||
                    el.section?.toLowerCase().includes(moduleName.toLowerCase())
                )
                : repoElements;

            return filtered.slice(0, 20).map(el => ({
                name: el.elementName,
                selector: el.selector,
                altSelectors: el.altSelectors || [],
                type: el.type,
                attributes: { page: el.page, section: el.section || '' },
                section: el.section,
                isVisible: true,
                isEnabled: true,
            }));
        } catch {
            return [];
        }
    }

    // ============================================================================
    // BUSINESS RULE MATCHING
    // ============================================================================

    private async saveSynthesizedRule(rule: BusinessRule, issue: JiraIssue, pool: DbClient): Promise<void> {
        try {
            const ruleId = `rule-${encodeURIComponent(rule.module.toLowerCase().replace(/\s+/g, '-'))}`;

            await BusinessRulesService.create(pool, {
                id: ruleId,
                module: rule.module,
                subModule: rule.subModule,
                keywords: rule.keywords,
                formulaRule: rule.formulaRule,
                expectedUIBehavior: rule.expectedUIBehavior,
                confidenceScore: rule.confidenceScore,
                status: rule.status || 'proposed',
                jiraId: issue.summary?.slice(0, 50)
            });
            appLogger.info(`[AIBrainEngine] Saved rule: ${rule.module}`, { action: 'save_rule', data: rule });
        } catch (e: any) {
            appLogger.warn('[AIBrainEngine] Failed to save synthesized rule', { error: e.message });
        }
    }

    private async mapContextToRule(issue: JiraIssue): Promise<{
        rule: BusinessRule | null;
        skillPatterns: SkillPattern[];
        gaps: string[];
        source: 'db' | 'synthesized' | 'none';
    }> {
        const gaps: string[] = [];

        // Gather sources in parallel
        const [dbRulesResult, skillPatternsResult, discoveryContext] = await Promise.allSettled([
            BusinessRulesService.searchByText(this.pool, `${issue.summary} ${issue.description}`),
            SmartSkillManager.listPatterns({ issueType: issue.issueType }),
            Promise.resolve(this.extractModuleFromIssue(issue)).then(m => m ? DiscoveryCacheService.getPromptContext(m) : null)
        ]);

        const rules = dbRulesResult.status === 'fulfilled' ? dbRulesResult.value : [];
        const skillPatterns = skillPatternsResult.status === 'fulfilled' ? skillPatternsResult.value : [];
        const discovery = discoveryContext.status === 'fulfilled' ? discoveryContext.value : null;

        if (dbRulesResult.status === 'rejected') {
            gaps.push(`Business rules search failed: ${dbRulesResult.reason}`);
        }
        if (skillPatternsResult.status === 'rejected') {
            gaps.push(`Skill pattern lookup failed: ${skillPatternsResult.reason}`);
        }

        // Gap detection
        if (rules.length === 0) {
            gaps.push('No existing business rules found — synthesizing from scratch');
        } else {
            appLogger.info(`[AIBrainEngine] Found ${rules.length} candidate business rules`);
        }

        if (skillPatterns.length < 3) {
            gaps.push(`Only ${skillPatterns.length} skill pattern(s) available (≥3 recommended for optimized tests)`);
        }

        if (!discovery) {
            gaps.push('No discovery cache available — live browser discovery will be needed');
        }

        const prompt = `
        You are an AI Brain Engine. Your task is to match a described Jira issue with the best existing business logic rule from a provided knowledge base.

        ${rules.length > 0
            ? `Candidate rules from database:\n${JSON.stringify(rules, null, 2)}`
            : 'No existing rules found. Synthesize a new rule from scratch.'}

        Learned Skill Patterns (from previous test executions):
        ${skillPatterns.length > 0
            ? JSON.stringify(skillPatterns.map(p => ({
                module: p.module,
                type: p.type,
                selectors: p.selectors,
                successRate: p.successRate,
                workflow: p.workflow?.slice(0, 5)
            })), null, 2)
            : 'No learned skill patterns yet.'}

        ${discovery
            ? `### Live Page Discovery (current UI elements on the page):\n${discovery}`
            : 'No live page discovery data yet.'}

        Given the following Jira issue:
        Summary: ${issue.summary}
        Description: ${issue.description}
        Comments: ${issue.comments}

        If a candidate rule matches, return it. Otherwise synthesize a new rule object conforming to:
        { "Module": "", "SubModule": "", "Keywords": [], "FormulaRule": "", "ExpectedUIBehavior": "" }

        Return ONLY valid JSON matching this structure, with no extra text or explanation.
        `;

        try {
            const response = await LocalAIService.simpleGenerate(prompt);
            const jsonText = response.replace(/```json/g, '').replace(/```/g, '').trim();
            const rule: BusinessRule = JSON.parse(jsonText);

            // STRUCTURED VALIDATION of synthesized rule
            const ruleGaps = this.validateRuleStructure(rule);
            gaps.push(...ruleGaps);

            // Mark synthesized rules as DRAFT
            if (rules.length === 0) {
                rule.status = 'proposed'; // maps to DB 'proposed' status
                rule.confidenceScore = 30; // Low initial confidence for synthesized rules
                appLogger.warn(`[AIBrainEngine] Synthesized rule marked as DRAFT: ${rule.module}`);
            }

            return { rule, skillPatterns, gaps, source: rules.length === 0 ? 'synthesized' : 'db' };
        } catch (error) {
            appLogger.error('[AIBrainEngine] Failed to map context, returning null');
            gaps.push('AI failed to parse rule mapping response');
            return { rule: null, skillPatterns, gaps, source: 'none' };
        }
    }

    /**
     * Validate rule structure — ensures preconditions, steps, and expected outcome exist.
     */
    private validateRuleStructure(rule: BusinessRule): string[] {
        const structureGaps: string[] = [];

        if (!rule.module) structureGaps.push('Rule missing Module field');
        if (!rule.formulaRule) structureGaps.push('Rule missing FormulaRule (test logic)');
        if (!rule.expectedUIBehavior) structureGaps.push('Rule missing ExpectedUIBehavior (assertion target)');

        return structureGaps;
    }

    // ============================================================================
    // PLAYWRIGHT CODE GENERATION
    // ============================================================================

    /**
     * Truncates context to fit within AI model limits (max ~100k chars).
     * Prioritizes: Jira ticket, ISTQB standards, UI elements.
     * Truncates: Skills, rules if needed.
     */
    private truncateContext(
        issue: JiraIssue,
        ruleDetails: string,
        elementContext: string,
        skillContext: string,
        unifiedSkillContext: string,
        maxChars: number = 100000
    ): { rule: string; elements: string; skills: string; unified: string } {
        const fixedLength = issue.summary.length + issue.description.length + 5000; // standards + prompt
        let remaining = maxChars - fixedLength;

        // Priorities (Allocation of remaining budget)
        let truncatedElements = elementContext;
        if (truncatedElements.length > remaining * 0.4) {
            truncatedElements = truncatedElements.slice(0, Math.floor(remaining * 0.4)) + '\n... (truncated UI elements)';
        }
        remaining -= truncatedElements.length;

        let truncatedRule = ruleDetails;
        if (truncatedRule.length > remaining * 0.3) {
            truncatedRule = truncatedRule.slice(0, Math.floor(remaining * 0.3)) + '\n... (truncated rule)';
        }
        remaining -= truncatedRule.length;

        let truncatedSkills = skillContext;
        if (truncatedSkills.length > remaining * 0.5) {
            truncatedSkills = truncatedSkills.slice(0, Math.floor(remaining * 0.5)) + '\n... (truncated skills)';
        }
        remaining -= truncatedSkills.length;

        let truncatedUnified = unifiedSkillContext;
        if (truncatedUnified.length > remaining) {
            truncatedUnified = truncatedUnified.slice(0, Math.max(0, remaining)) + '\n... (truncated unified context)';
        }

        return {
            rule: truncatedRule,
            elements: truncatedElements,
            skills: truncatedSkills,
            unified: truncatedUnified
        };
    }

    private async generatePlaywrightCode(
        issue: JiraIssue,
        matchedRule: BusinessRule | null,
        elements: ElementInfo[],
        skillPatterns: SkillPattern[],
        unifiedSkills: ResolvedSkill[]
    ): Promise<{ code: string; validation: CodeValidation }> {
        const ruleDetails = matchedRule
            ? `Matched Rule Module: ${matchedRule.module}\nFormula/Rule: ${matchedRule.formulaRule}\nExpected UI: ${matchedRule.expectedUIBehavior}`
            : 'No direct rule matched. Use standard boundary and happy path reasoning.';

        const elementContext = elements.length > 0
            ? `### Discovered UI Elements (USE THESE SELECTORS):\n${elements.map(el =>
                `- "${el.name}" (${el.type}): \`${el.selector}\` [enabled=${el.isEnabled}]${Object.keys(el.attributes).length > 0 ? ` attrs: ${JSON.stringify(el.attributes)}` : ''}`
            ).join('\n')}`
            : 'No pre-discovered UI elements available.';

        const skillContext = skillPatterns.length > 0
            ? `Learned Skill Patterns (reuse these proven selectors):\n${skillPatterns
                .filter(p => p.successRate && p.successRate > 0.7)
                .map(p => `- [${p.type}] ${p.module}: selectors=${JSON.stringify(p.selectors)}, successRate=${p.successRate}`)
                .join('\n')}`
            : 'No learned skills yet.';

        const unifiedSkillContext = unifiedSkills.length > 0
            ? `### Unified Knowledge (sorted by confidence):\n${unifiedSkills
                .slice(0, 15)
                .map((s, i) => `${i + 1}. **[${s.type}] ${s.name}** (${(s.confidence * 100).toFixed(0)}%)\n   ${s.content.slice(0, 300)}`)
                .join('\n')}`
            : 'No additional unified knowledge.';

        // Build ISTQB checklist as STRUCTURED requirements
        const istqbChecklist = this.buildISTQBChecklist(issue, matchedRule);

        // SEMANTIC RAG: Fetch only relevant standards instead of the whole library
        const relevantISTQB = await VectorKnowledgeService.getRelevantISTQB(issue.summary);
        const istqbContext = relevantISTQB || IstqbKnowledgeService.getPromptInjection();

        // SEMANTIC RAG: Fetch business rules from indexed User Guides (Phase 2!)
        const businessDocs = await VectorKnowledgeService.search(issue.summary + " " + issue.description, 'business_rule', 5);
        const businessDocsContext = businessDocs.length > 0 
            ? `### Business Knowledge from User Guides:\n${businessDocs.map(d => `- ${d.content}`).join('\n')}`
            : '';

        // APPLY TRUNCATION (Max ~100k characters for safe token limits)
        const ctx = this.truncateContext(issue, ruleDetails, elementContext, skillContext, unifiedSkillContext);

        const isBug = issue.issueType.toLowerCase() === 'bug';
        
        const typeSpecificInstructions = isBug ? `
        # BUG REPRODUCTION MODE
        This is a reported bug. Your primary goal is REPRODUCTION.
        1. Analyze the description for "Steps to Reproduce".
        2. Create a test that specifically follows those steps.
        3. Add assertions that compare the "Actual Result" vs "Expected Behavior".
        4. Focus on regression: ensure other parts of the module still work.
        ` : `
        # STORY IMPLEMENTATION MODE
        This is a new feature (Story). Your primary goal is COMPREHENSIVE COVERAGE.
        1. Extract all acceptance criteria from the description.
        2. Create data-driven tests for Happy Path, Boundary Values, and Error Paths.
        3. Use the business knowledge provided to validate mandatory fields and specific logic.
        `;

        const prompt = `
        You are an expert SDET testing an Angular 19 + Zone.js + Kendo UI application.
        Output complete Playwright TypeScript code based on the Jira issue and business rule logic provided.

        ${typeSpecificInstructions}

        ISTQB TEST DESIGN CONTEXT:
        ${istqbContext}

        ${businessDocsContext}

        REQUIRED TEST TECHNIQUES (mandatory — include in generated code):
${istqbChecklist.boundaryFields.length > 0 ? `- Boundary Value Analysis for: ${istqbChecklist.boundaryFields.join(', ')}` : ''}
${istqbChecklist.equivalenceFields.length > 0 ? `- Equivalence Partitioning for: ${istqbChecklist.equivalenceFields.join(', ')}` : ''}
${istqbChecklist.errorPaths.length > 0 ? `- Error Path Testing for: ${istqbChecklist.errorPaths.join(', ')}` : ''}

        Requirements:
        1. Implement Data-Driven Playwright TypeScript code (create an array of testCases for Happy Path and Edge/Negative cases).
        2. Use Boundary Value Analysis for all numeric/date fields.
        3. Use Equivalence Partitioning for text inputs (valid value, empty, too long, special chars).
        4. CRITICAL: Import and call \`waitForAngular(page)\` after EVERY navigation and click action.
        5. CRITICAL: Import and call \`waitForLoadingMask(page)\` before interacting with elements.
        6. STRICT SECURITY: NO HARDCODING OF CREDENTIALS. ALWAYS use process.env.TEST_USERNAME and process.env.TEST_PASSWORD.
        7. ROBUST SELECTORS: Prioritize aria-labels, getByRole, or data-testid. DO NOT rely on dynamic Kendo UI IDs.
        8. Focus strictly on answering the prompt requirement. No plain text or descriptions outside code blocks.

        REQUIRED IMPORTS:
\`\`\`typescript
import { test, expect, Page } from '@playwright/test';
import { performLogin } from '../../tests/playwright/login-helper';
import { healedClick, waitForAngular, universalFill, waitForLoadingMask } from '../../tests/playwright/playwright-self-healing';
\`\`\`

        JIRA Ticket:
        - Type: ${issue.issueType}
        - Summary: ${issue.summary}
        - Description: ${issue.description}

        Business Logic Rule:
        ${ctx.rule}

        ${ctx.elements}

        ${ctx.skills}

        ${ctx.unified}

        Produce the Playwright TypeScript script directly.
        `;

        // Generate with retry on empty response
        let response = '';
        let attempts = 0;
        const maxAttempts = 2;

        do {
            response = await LocalAIService.simpleGenerate(prompt);
            attempts++;
        } while (!response.trim() && attempts < maxAttempts);

        const code = response.replace(/^```(typescript|ts)?\s*/, '').replace(/\s*```$/, '').trim();

        // POST-GENERATION VALIDATION
        const validation = this.validateGeneratedCode(code, elements, istqbChecklist);

        return { code, validation };
    }

    /**
     * Build ISTQB checklist from issue and rule context.
     * Extracts numeric fields for boundary analysis, enum fields for equivalence partitioning.
     */
    private buildISTQBChecklist(issue: JiraIssue, rule: BusinessRule | null): ISTQBChecklist {
        const checklist: ISTQBChecklist = {
            boundaryFields: [],
            equivalenceFields: [],
            errorPaths: []
        };

        if (rule) {
            // Extract numeric-like fields for boundary value analysis
            const formulaText = (rule.formulaRule || '').toLowerCase();
            const boundaryKeywords = ['amount', 'count', 'days', 'limit', 'age', 'year', 'month', 'salary', 'rate', 'percentage', 'number', 'quantity', 'hours'];
            for (const kw of boundaryKeywords) {
                if (formulaText.includes(kw)) {
                    checklist.boundaryFields.push(kw);
                }
            }

            // Extract quoted strings for equivalence partitioning
            const quotedStrings = (rule.formulaRule || '').match(/'([^']{2,})'/g) || [];
            checklist.equivalenceFields = [...new Set(quotedStrings.map(s => s.replace(/'/g, '')))];

            // Extract validation-related terms for error path testing
            const validationTerms = ['required', 'must', 'cannot', 'invalid', 'error', 'reject', 'fail', 'not allow', 'not permitted'];
            const fullRuleText = `${rule.formulaRule} ${rule.expectedUIBehavior}`.toLowerCase();
            for (const term of validationTerms) {
                if (fullRuleText.includes(term)) {
                    checklist.errorPaths.push(term);
                }
            }
        }

        // Fallback: derive from issue summary if no rule
        if (!rule || checklist.boundaryFields.length === 0) {
            const summaryLower = issue.summary.toLowerCase();
            if (summaryLower.includes('amount') || summaryLower.includes('salary') || summaryLower.includes('pay')) {
                checklist.boundaryFields.push('amount');
            }
            if (summaryLower.includes('count') || summaryLower.includes('number') || summaryLower.includes('limit')) {
                checklist.boundaryFields.push('count');
            }
        }

        return checklist;
    }

    /**
     * Post-generation validation of Playwright code.
     * Checks selector validity, ISTQB coverage hints, and basic TypeScript validity.
     */
    private validateGeneratedCode(code: string, elements: ElementInfo[], checklist: ISTQBChecklist): CodeValidation {
        const validation: CodeValidation = {
            compiles: true,
            selectorsValid: false,
            istqbCoverage: { boundary: false, equivalence: false, errorPath: false },
            issues: []
        };

        // 0. Real TypeScript Compilation Check
        try {
            const tmpDir = path.join(process.cwd(), 'tmp', 'validation');
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
            
            const tmpFile = path.join(tmpDir, `valid_${uuidv4()}.ts`);
            // Mock imports for fast check without dependencies
            const mockCode = `
                function test(a:any, b:any, c:any){}; 
                const expect = (a:any) => ({ toHaveText: (b:any) => {}, toBeVisible: () => {} });
                const page = {} as any;
                ${code}
            `;
            fs.writeFileSync(tmpFile, mockCode);
            
            const { execSync } = require('child_process');
            execSync(`npx tsc ${tmpFile} --noEmit --esModuleInterop --skipLibCheck --target esnext`, { stdio: 'pipe' });
            fs.unlinkSync(tmpFile);
        } catch (tscErr: any) {
            validation.compiles = false;
            validation.issues.push(`TypeScript Compilation Error: ${tscErr.message.split('\n')[0]}`);
        }

        // 1. Extract used selectors from code
        const selectorMatches = code.match(/'(#[^']+'|data-testid=["'][^"']+["']|aria-label=["'][^"']+["'])/g) || [];
        const selectorRegexMatches = code.match(/getByRole\([^)]+\)|getByText\([^)]+\)|getByLabel\([^)]+\)/g) || [];
        const allUsedSelectors = [...selectorMatches, ...selectorRegexMatches];

        // 2. Validate against discovered elements
        const cachedSelectors = new Set(elements.map(e => e.selector.toLowerCase()));
        const hasValidSelectors = allUsedSelectors.length === 0 || allUsedSelectors.some(sel => {
            const selLower = sel.toLowerCase();
            return cachedSelectors.has(selLower) ||
                selLower.includes('data-testid') ||
                selLower.includes('getbyrole') ||
                selLower.includes('getbytext') ||
                selLower.includes('getbylabel');
        });
        validation.selectorsValid = hasValidSelectors;

        if (!validation.selectorsValid && allUsedSelectors.length > 0) {
            validation.issues.push('Some selectors may not match discovered UI elements — verify manually');
        }

        // 3. ISTQB coverage check — look for evidence of test techniques in code
        const codeLower = code.toLowerCase();
        validation.istqbCoverage.boundary = checklist.boundaryFields.length === 0 ||
            codeLower.includes('boundary') ||
            codeLower.includes('edge') ||
            codeLower.includes('min') ||
            codeLower.includes('max') ||
            codeLower.includes('0') ||
            codeLower.includes('-1') ||
            codeLower.includes('999');
        validation.istqbCoverage.equivalence = checklist.equivalenceFields.length === 0 ||
            codeLower.includes('valid') ||
            codeLower.includes('invalid') ||
            codeLower.includes('empty') ||
            codeLower.includes('special');
        validation.istqbCoverage.errorPath = checklist.errorPaths.length === 0 ||
            codeLower.includes('error') ||
            codeLower.includes('fail') ||
            codeLower.includes('reject') ||
            codeLower.includes('invalid') ||
            codeLower.includes('expect(');

        // 4. Security check — no hardcoded credentials
        if (codeLower.includes('password') && codeLower.includes('=') && !codeLower.includes('process.env')) {
            validation.issues.push('POTENTIAL SECURITY: Password may be hardcoded — use process.env.TEST_PASSWORD');
        }
        if (codeLower.includes('username') && codeLower.includes('=') && !codeLower.includes('process.env')) {
            validation.issues.push('POTENTIAL SECURITY: Username may be hardcoded — use process.env.TEST_USERNAME');
        }

        return validation;
    }

    public async extractRuleFromIssue(issue: JiraIssue): Promise<BusinessRule | null> {
        const result = await this.mapContextToRule(issue);
        return result.rule;
    }

    public async analyzeIssue(issue: JiraIssue): Promise<{
        rule: BusinessRule | null,
        skillPatterns: SkillPattern[],
    }> {
        return this.mapContextToRule(issue);
    }

    // ============================================================================
    // CONFIDENCE-SCORING PIPELINE (Enhanced first-time Jira ticket processing)
    // ============================================================================

    /**
     * Full pipeline with confidence scoring and risk assessment.
     * Replaces processJiraIssue when you need visibility into generation quality.
     */
    public async processJiraIssueWithConfidence(issue: JiraIssue): Promise<TestGenerationResult> {
        appLogger.info(`[AIBrainEngine] Starting confidence-scoring pipeline for: ${issue.summary}`);

        // Step 1: Module detection with confidence
        const { module, confidence: moduleConfidence } = this.detectModuleWithConfidence(issue);

        // Step 2: UI element discovery with source tracking
        const elementsResult = await this.getUIElementsForModule(module);
        const discoveryResult: ElementDiscoveryResult = {
            elements: elementsResult,
            source: elementsResult.length > 0 ? 'cache' : 'static',
            validated: elementsResult.length > 0,
            usableCount: elementsResult.length,
            totalCount: elementsResult.length
        };

        // Step 3: Rule matching with gap detection
        const ruleResult = await this.mapContextToRule(issue);

        // Step 4: Code generation with ISTQB checklist
        const generationResult = await this.generatePlaywrightCode(
            issue,
            ruleResult.rule,
            discoveryResult.elements,
            ruleResult.skillPatterns,
            await UnifiedSkillResolver.forIssue(issue.issueType, module)
        );

        // Aggregate confidence scores
        const scores = this.calculateConfidenceScores({
            moduleConfidence,
            discoveryResult,
            ruleResult,
            validation: generationResult.validation
        });

        const overallConfidence = scores.reduce((a, b) => a + b, 0) / scores.length;
        const riskLevel = overallConfidence >= 0.7 ? 'LOW' : overallConfidence >= 0.5 ? 'MEDIUM' : 'HIGH';
        const requiresManualReview = riskLevel === 'HIGH' || moduleConfidence < 0.5;

        const recommendations = this.generateRecommendations({
            moduleConfidence,
            discoveryResult,
            ruleResult,
            validation: generationResult.validation,
            overallConfidence
        });

        // Log the assessment
        appLogger.info(`[AIBrainEngine] Confidence: ${(overallConfidence * 100).toFixed(0)}%, Risk: ${riskLevel}`, {
            moduleConfidence: (moduleConfidence * 100).toFixed(0) + '%',
            elementCount: discoveryResult.usableCount,
            elementSource: discoveryResult.source,
            ruleSource: ruleResult.source,
            gaps: ruleResult.gaps.length,
            selectorValid: generationResult.validation.selectorsValid,
            riskLevel,
            recommendations
        });

        return {
            code: generationResult.code,
            confidence: {
                overall: Math.round(overallConfidence * 100) / 100,
                moduleDetection: Math.round(moduleConfidence * 100) / 100,
                uiElements: {
                    count: discoveryResult.usableCount,
                    source: discoveryResult.source,
                    validated: discoveryResult.validated
                },
                businessRule: {
                    source: ruleResult.source,
                    gaps: ruleResult.gaps
                },
                skillPatterns: {
                    count: ruleResult.skillPatterns.length,
                    quality: ruleResult.skillPatterns.length >= 3 ? 'strong' : ruleResult.skillPatterns.length >= 1 ? 'weak' : 'none'
                },
                istqbCoverage: generationResult.validation.istqbCoverage,
                codeValidation: {
                    compiles: generationResult.validation.compiles,
                    selectorsValid: generationResult.validation.selectorsValid
                }
            },
            riskLevel,
            requiresManualReview,
            recommendations
        };
    }

    /**
     * Detect module with confidence scoring (no AI call — uses existing methods).
     */
    private detectModuleWithConfidence(issue: JiraIssue): { module: string; confidence: number } {
        const text = `${issue.summary} ${issue.description}`.toLowerCase();

        // Check ModuleRegistry first (confirmed > draft)
        const registryCandidates = ModuleRegistry.findSimilar(text)
            .sort((a, b) => Number(b.confirmed) - Number(a.confirmed));

        if (registryCandidates.length > 0 && registryCandidates[0].confirmed) {
            return { module: registryCandidates[0].moduleName, confidence: 0.85 };
        }

        // Fallback to extraction
        const extracted = this.extractModuleFromIssue(issue);
        if (extracted) {
            return { module: extracted, confidence: 0.60 };
        }

        // Last resort
        return { module: 'Unknown', confidence: 0.20 };
    }

    /**
     * Calculate individual confidence scores for aggregation.
     */
    private calculateConfidenceScores(ctx: {
        moduleConfidence: number;
        discoveryResult: ElementDiscoveryResult;
        ruleResult: RuleMatchResult;
        validation: CodeValidation;
    }): number[] {
        const scores: number[] = [];

        // Module detection confidence (already 0-1)
        scores.push(ctx.moduleConfidence);

        // UI element source confidence
        const sourceScores: Record<string, number> = { cache: 0.95, live: 0.75, static: 0.40 };
        scores.push(sourceScores[ctx.discoveryResult.source] || 0.30);

        // Element count confidence (need at least 3)
        scores.push(Math.min(ctx.discoveryResult.usableCount / 10, 1.0));

        // Business rule confidence
        if (ctx.ruleResult.rule) {
            scores.push((ctx.ruleResult.source === 'db' ? 0.80 : 0.40));
        } else {
            scores.push(0.20);
        }

        // Skill pattern confidence
        const patternCount = ctx.ruleResult.skillPatterns.length;
        scores.push(patternCount >= 3 ? 0.85 : patternCount >= 1 ? 0.50 : 0.25);

        // Validation confidence
        scores.push(ctx.validation.selectorsValid ? 0.85 : 0.40);
        scores.push(ctx.validation.compiles ? 0.90 : 0.30);

        return scores;
    }

    /**
     * Generate actionable recommendations based on confidence assessment.
     */
    private generateRecommendations(ctx: {
        moduleConfidence: number;
        discoveryResult: ElementDiscoveryResult;
        ruleResult: RuleMatchResult;
        validation: CodeValidation;
        overallConfidence: number;
    }): string[] {
        const recs: string[] = [];

        if (ctx.moduleConfidence < 0.5) {
            recs.push('Module detection confidence is low — verify the target module manually');
        }

        if (ctx.discoveryResult.usableCount < 3) {
            recs.push(`Only ${ctx.discoveryResult.usableCount} UI element(s) found — run live discovery or add elements to repository`);
        }

        if (ctx.ruleResult.source === 'synthesized') {
            recs.push('Business rule was synthesized (not in DB) — review for edge cases and accuracy');
        }

        if (ctx.ruleResult.gaps.length > 0) {
            recs.push(`Generation gaps detected: ${ctx.ruleResult.gaps.join('; ')}`);
        }

        if (ctx.ruleResult.skillPatterns.length < 3) {
            recs.push('Few learned skill patterns available — consider training the system with more test runs');
        }

        if (!ctx.validation.istqbCoverage.boundary) {
            recs.push('Boundary Value Analysis not detected in generated code — add edge cases for numeric fields');
        }

        if (!ctx.validation.istqbCoverage.equivalence) {
            recs.push('Equivalence Partitioning not detected — add valid/invalid input test cases');
        }

        if (!ctx.validation.selectorsValid) {
            recs.push('Some selectors may not match discovered UI elements — verify before running tests');
        }

        if (ctx.validation.issues.length > 0) {
            recs.push(`Code issues: ${ctx.validation.issues.join('; ')}`);
        }

        if (ctx.overallConfidence >= 0.7 && recs.length === 0) {
            recs.push('Generation quality is high — ready for execution');
        }

        return recs;
    }
}
