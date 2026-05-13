/**
 * Unified Skill Resolver
 *
 * Single entry point that queries all skill/knowledge systems in priority order:
 * 1. SmartSkillManager (learned patterns with success rates)
 * 2. SkillRegistry (file-based skill cache)
 * 3. SkillDiscoveryService (external Playwright snippets)
 * 4. CustomSkillManager (user-defined custom skills)
 *
 * Returns deduplicated, scored results for test generation context.
 *
 * @author GoHybrid AI Team
 * @date 2026-04-06
 */

import { SmartSkillManager, SkillPattern } from './SmartSkillManager';
import { Skill, SkillRegistry } from './SkillRegistry';
import { SkillDiscoveryService, PlaywrightSnippet } from './SkillDiscoveryService';
import { CustomSkill, CustomSkillManager } from './CustomSkillManager';
import { ISTQB_STANDARDS, IstqbKnowledgeService } from '../../../api/IstqbKnowledgeService';
import { appLogger } from '../../utils/logger';

// ============================================================================
// UNIFIED TYPES
// ============================================================================

export interface ResolvedSkill {
    id: string;
    name: string;
    type: 'learned' | 'registry' | 'discovery' | 'custom' | 'istqb';
    module?: string;
    content: string;
    confidence: number;  // 0.0 - 1.0 (learned skills have real success rates, others are estimated)
    source: string;
}

export interface SkillQuery {
    issueType?: string;   // 'story' | 'bug' | 'task' | 'epic'
    module?: string;      // e.g. 'Designation', 'Department', 'Employee'
    keywords?: string[];  // Additional search terms
    includeISTQB?: boolean; // Whether to include ISTQB standards
}

// ============================================================================
// UNIFIED SKILL RESOLVER
// ============================================================================

export class UnifiedSkillResolver {

    /**
     * Resolve all skills relevant to a query, with deduplication and scoring.
     * Results are sorted by confidence (highest first).
     */
    static async resolve(query: SkillQuery): Promise<ResolvedSkill[]> {
        const results: ResolvedSkill[] = [];

        // 1. SmartSkillManager — learned patterns with real success rates
        const learned = await this.resolveLearnedSkills(query);
        results.push(...learned);

        // 2. SkillRegistry — file-based loaded skills
        const registry = await this.resolveRegistrySkills(query);
        results.push(...registry);

        // 3. SkillDiscoveryService — external Playwright snippets
        const discovery = await this.resolveDiscoverySkills(query);
        results.push(...discovery);

        // 4. CustomSkillManager — user-defined custom skills
        const custom = await this.resolveCustomSkills(query);
        results.push(...custom);

        // 5. ISTQB standards — if requested
        if (query.includeISTQB !== false) {
            const istqb = this.resolveISTQB(query);
            results.push(...istqb);
        }

        // Deduplicate semantically and sort by confidence (highest first)
        const seen = new Set<string>();
        return results
            .filter(r => {
                const dedupeKey = `${r.type}:${(r.module || '').toLowerCase()}:${r.name.toLowerCase()}:${r.content.slice(0, 160).toLowerCase()}`;
                if (seen.has(dedupeKey)) return false;
                seen.add(dedupeKey);
                return true;
            })
            .sort((a, b) => b.confidence - a.confidence);
    }

    // -------------------------------------------------------------------
    // SOURCE: Learned skills (SmartSkillManager)
    // -------------------------------------------------------------------

    private static async resolveLearnedSkills(query: SkillQuery): Promise<ResolvedSkill[]> {
        try {
            const [jiraPatterns, workflowPatterns] = await Promise.all([
                SmartSkillManager.listPatterns({
                    type: 'jira',
                    module: query.module,
                    issueType: query.issueType
                }),
                SmartSkillManager.listPatterns({
                    type: 'jira',
                    module: query.module
                })
            ]);
            const patterns = [...jiraPatterns, ...workflowPatterns];

            // Filter by keywords if provided
            const filtered = query.keywords
                ? patterns.filter(p =>
                    query.keywords!.some(kw =>
                        p.module?.toLowerCase().includes(kw.toLowerCase()) ||
                        p.selectors?.some(s => s.toLowerCase().includes(kw.toLowerCase())) ||
                        p.issueType?.toLowerCase().includes(kw.toLowerCase()) ||
                        p.workflow?.some(w => JSON.stringify(w).toLowerCase().includes(kw.toLowerCase()))
                    )
                )
                : patterns;

            return filtered.map(p => ({
                id: `learned:${p.id}`,
                name: `${p.module || 'Unknown'} (${p.type})`,
                type: 'learned' as const,
                module: p.module,
                content: JSON.stringify({
                    selectors: p.selectors,
                    workflow: p.workflow,
                    checklist: p.checklist,
                    learnedPatterns: p.learnedPatterns,
                    version: p.version
                }),
                confidence: this.computeConfidence(
                    p.successRate ?? 0.5,
                    query,
                    p.module,
                    p.issueType
                ),
                source: 'SmartSkillManager'
            }));
        } catch (e: any) {
            appLogger.warn('[UnifiedSkillResolver] Learned skill resolution failed', { error: e.message });
            return [];
        }
    }

    // -------------------------------------------------------------------
    // SOURCE: Registry skills (SkillRegistry)
    // -------------------------------------------------------------------

    private static async resolveRegistrySkills(query: SkillQuery): Promise<ResolvedSkill[]> {
        try {
            // Ensure registry is initialized
            if (SkillRegistry.getAllSkills().length === 0) {
                await SkillRegistry.initialize();
            }

            const skills = SkillRegistry.findSkills(query.module, query.issueType);

            // Filter by keywords if provided
            const filtered = query.keywords
                ? skills.filter(s =>
                    query.keywords!.some(kw =>
                        s.module?.toLowerCase().includes(kw.toLowerCase()) ||
                        JSON.stringify(s.content).toLowerCase().includes(kw.toLowerCase())
                    )
                )
                : skills;

            return filtered.map(s => ({
                id: `registry:${s.id}`,
                name: s.name,
                type: 'registry' as const,
                module: s.module,
                content: typeof s.content === 'string' ? s.content : JSON.stringify(s.content),
                confidence: this.computeConfidence(0.5, query, s.module),
                source: 'SkillRegistry'
            }));
        } catch (e: any) {
            appLogger.warn('[UnifiedSkillResolver] Registry skill resolution failed', { error: e.message });
            return [];
        }
    }

    // -------------------------------------------------------------------
    // SOURCE: Discovery skills (SkillDiscoveryService)
    // -------------------------------------------------------------------

    private static async resolveDiscoverySkills(query: SkillQuery): Promise<ResolvedSkill[]> {
        try {
            if (!query.module && (!query.keywords || query.keywords.length === 0)) {
                return [];
            }

            const snippets = await SkillDiscoveryService.discoverPlaywrightSkills();

            // Filter by keywords if provided
            const filtered = query.keywords
                ? snippets.filter(s =>
                    query.keywords!.some(kw =>
                        s.name.toLowerCase().includes(kw.toLowerCase()) ||
                        s.description.toLowerCase().includes(kw.toLowerCase()) ||
                        s.body.some(b => b.toLowerCase().includes(kw.toLowerCase()))
                    )
                )
                : snippets;

            return filtered.slice(0, 10).map(s => ({
                id: `discovery:${s.name}:${s.prefix}`,
                name: s.name,
                type: 'discovery' as const,
                content: s.body.join('\n'),
                confidence: this.computeConfidence(0.3, query),
                source: 'SkillDiscoveryService'
            }));
        } catch (e: any) {
            appLogger.warn('[UnifiedSkillResolver] Discovery skill resolution failed', { error: e.message });
            return [];
        }
    }

    // -------------------------------------------------------------------
    // SOURCE: Custom skills (CustomSkillManager)
    // -------------------------------------------------------------------

    private static async resolveCustomSkills(query: SkillQuery): Promise<ResolvedSkill[]> {
        try {
            const skills = CustomSkillManager.getAllSkills();

            // Filter by keywords if provided
            const filtered = query.keywords
                ? skills.filter(s =>
                    query.keywords!.some(kw =>
                        s.name.toLowerCase().includes(kw.toLowerCase()) ||
                        s.description.toLowerCase().includes(kw.toLowerCase()) ||
                        s.content.toLowerCase().includes(kw.toLowerCase())
                    )
                )
                : skills;

            return filtered.map(s => ({
                id: `custom:${s.id}`,
                name: s.name,
                type: 'custom' as const,
                content: s.content,
                confidence: this.computeConfidence(0.6, query),
                source: 'CustomSkillManager'
            }));
        } catch (e: any) {
            appLogger.warn('[UnifiedSkillResolver] Custom skill resolution failed', { error: e.message });
            return [];
        }
    }

    // -------------------------------------------------------------------
    // SOURCE: ISTQB standards
    // -------------------------------------------------------------------

    private static resolveISTQB(query: SkillQuery): ResolvedSkill[] {
        return [
            {
                id: 'istqb:test-design-techniques',
                name: 'ISTQB Test Design Techniques',
                type: 'istqb',
                content: ISTQB_STANDARDS.test_design_techniques.join('\n'),
                confidence: 1.0,
                source: 'IstqbKnowledgeService'
            },
            {
                id: 'istqb:quality-attributes',
                name: 'ISTQB Quality Attributes',
                type: 'istqb',
                content: ISTQB_STANDARDS.quality_attributes.join('\n'),
                confidence: 1.0,
                source: 'IstqbKnowledgeService'
            },
            {
                id: 'istqb:globalhr-pillars',
                name: 'GlobalHR Three Pillars',
                type: 'istqb',
                content: IstqbKnowledgeService.getPromptInjection().trim(),
                confidence: 1.0,
                source: 'IstqbKnowledgeService'
            }
        ];
    }

    // -------------------------------------------------------------------
    // UTILITY: Format resolved skills into AI prompt context
    // -------------------------------------------------------------------

    static async formatForAI(query: SkillQuery, maxResults: number = 10): Promise<string> {
        const skills = await this.resolve(query);
        const top = skills.slice(0, maxResults);

        if (top.length === 0) {
            return 'No relevant skills found. Use standard Playwright best practices.';
        }

        let context = '### Relevant Skills & Knowledge (sorted by confidence)\n\n';

        for (let i = 0; i < top.length; i++) {
            const skill = top[i];
            const confidence = (skill.confidence * 100).toFixed(0);
            // Truncate content to 150 chars per skill to reduce prompt bloat
            const contentPreview = skill.content.length > 150 ? skill.content.substring(0, 150) + '...' : skill.content;
            context += `${i + 1}. **[${skill.type}] ${skill.name}** (${confidence}% confidence)\n`;
            context += `   Source: ${skill.source}\n`;
            if (skill.module) context += `   Module: ${skill.module}\n`;
            context += `   Content: ${contentPreview}\n\n`;
        }

        return context;
    }

    // -------------------------------------------------------------------
    // UTILITY: Get skills for a specific Jira issue type
    // -------------------------------------------------------------------

    static async forIssue(issueType: string, module?: string): Promise<ResolvedSkill[]> {
        return this.resolve({
            issueType: issueType.toLowerCase() as SkillQuery['issueType'],
            module,
            includeISTQB: true
        });
    }

    // -------------------------------------------------------------------
    // UTILITY: Get skills formatted for AI injection for a specific issue
    // -------------------------------------------------------------------

    static async forIssuePrompt(issueType: string, module?: string): Promise<string> {
        return this.formatForAI({
            issueType: issueType.toLowerCase() as SkillQuery['issueType'],
            module,
            includeISTQB: true
        });
    }

    private static computeConfidence(
        base: number,
        query: SkillQuery,
        module?: string,
        issueType?: string
    ): number {
        let confidence = base;

        if (query.module && module && query.module.toLowerCase() === module.toLowerCase()) {
            confidence += 0.2;
        }

        if (query.issueType && issueType && query.issueType.toLowerCase() === issueType.toLowerCase()) {
            confidence += 0.1;
        }

        if (query.keywords && query.keywords.length > 0) {
            confidence += 0.05;
        }

        return Math.min(confidence, 0.99);
    }
}
