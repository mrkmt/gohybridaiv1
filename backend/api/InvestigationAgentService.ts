import { SkillRegistry } from './SkillRegistry';
import type { AgentResult } from './AgentOrchestrator';
import { ContextManager } from './ContextManager';
import { MultiAgentRouter } from './MultiAgentRouter';
import { config } from './config';
import { z } from 'zod';
import { KnowledgeService } from './KnowledgeService';
import { IstqbKnowledgeService } from './IstqbKnowledgeService';
import { HrTemplateService } from './HrTemplateService';
import { RiskPredictorService } from './RiskPredictorService';
const { LRUCache } = require('lru-cache');

const InvestigationSchema = z.object({
    issueType: z.string().default('OTHER'),
    checklist: z.array(z.object({
        id: z.number().optional(),
        description: z.string(),
        category: z.string(),
        testSuggestion: z.string()
    })),
    summary: z.string().default('Investigation completed')
});

const ReviseSchema = z.object({
    adminSetupSteps: z.array(z.object({
        id: z.number(),
        action: z.string(),
        details: z.string()
    })),
    testExecutionSteps: z.array(z.object({
        id: z.number(),
        action: z.string(),
        details: z.string()
    })),
    evidenceRequired: z.array(z.string())
});

export interface InvestigationCheck {
    id: number;
    description: string;
    category: string;
    testSuggestion: string;
    status: 'pending' | 'passed' | 'failed' | 'warning';
    result?: string;
}

export interface InvestigationResult {
    investigationId: string;
    jiraId: string;
    issueType: string;
    checklist: InvestigationCheck[];
    summary: string;
    status: 'completed' | 'error';
    aiModel: string;
    riskScore?: number;
    riskLevel?: string;
    riskPatterns?: string[];
}

export class InvestigationAgentService {
    private static readonly CACHE_TTL_MS = 1;
    // @ts-ignore - lru-cache v5 types not available
    private static responseCache = new LRUCache({
        max: 100, // Maximum 100 entries
        ttl: 60 * 60 * 1000, // 1 hour default TTL
        updateAgeOnGet: true, // Refresh TTL on access
        updateAgeOnHas: true // Refresh TTL on has checks
    });

    static async investigate(
        jiraId: string,
        jiraData: { summary: string; description: string;[key: string]: any },
        pool: any,
        forceCloud: boolean = false
    ): Promise<InvestigationResult> {

        console.log(`[Investigation Agent] Starting investigation for ${jiraId}${forceCloud ? ' (FORCE CLOUD)' : ''}`);
        const cacheKey = this.buildCacheKey('investigate', jiraId, { ...jiraData, forceCloud });
        const cached = this.responseCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL_MS) {
            return cached.value as InvestigationResult;
        }

        const userLevelRules = SkillRegistry.executeSkill("USERLEVEL_RULES", {});
        const globalhrContext = SkillRegistry.executeSkill("GLOBALHR_CONTEXT", {});
        const istqbGuidelines = IstqbKnowledgeService.getPromptInjection();
        
        const fullText = jiraData.summary + ' ' + jiraData.description;
        const hrTemplates = HrTemplateService.getRelevantTemplates(fullText);
        const riskData = RiskPredictorService.analyzeRisk(fullText);

        const relevantDocs = await KnowledgeService.findSemanticDocs(fullText, 2);
        const docContext = relevantDocs.map(d => `[FILE: ${d.title}]\n${d.snippet}`).join('\n\n');

        const maxChars = Math.max(2000, config.investigation.promptMaxChars);
        const shortContext = globalhrContext.slice(0, Math.floor(maxChars * 0.35));
        const shortRules = userLevelRules.slice(0, Math.floor(maxChars * 0.45));
        const shortDesc = String(jiraData.description || '').slice(0, Math.floor(maxChars * 0.2));

        const prompt = `
### TASK: Investigate a Jira Bug Report
You are an AI Investigation Agent for "GlobalHR Cloud" system.

### BUSINESS CONTEXT:
${shortContext}

### HR SCENARIO TEMPLATES:
${hrTemplates}

### TESTING STANDARDS (ISTQB):
${istqbGuidelines}

### PROJECT-SPECIFIC KNOWLEDGE (DEEP DIVE):
${docContext || 'No additional context found.'}

### USER LEVEL INVESTIGATION RULES:
${shortRules}

### JIRA TICKET:
- ID: ${jiraId} | Summary: ${jiraData.summary}
- Description: ${shortDesc}

### INSTRUCTIONS:
1. Classify the issue: LOGIN_FAILED, PAGE_404, PERMISSION_DENIED, API_ERROR, DATA_VALIDATION, OTHER
2. Generate 3-8 checklist items with specific test suggestions
3. Tag each item: [FUNCTIONAL], [VISUAL], [DATA], or [NETWORK]

### OUTPUT FORMAT (STRICT JSON - NO MARKDOWN, NO EXPLANATIONS):
{
  "issueType": "CLASSIFICATION_HERE",
  "checklist": [
    {
      "id": 1,
      "description": "Specific check to perform",
      "category": "Category name",
      "testSuggestion": "Exact Playwright action or verification"
    }
  ],
  "summary": "One sentence conclusion"
}

Return ONLY the JSON object. No markdown. No explanations. No code blocks.
`;

        try {
            let routed;
            if (forceCloud) {
                routed = await MultiAgentRouter.routeWithProfile(config.investigation.cloudProfileName, ContextManager.trimContext(prompt, 8192), true, config.investigation.cloudTimeoutMs);
            } else {
                const profile = await MultiAgentRouter.getProfileForRole('INVESTIGATOR');
                if (!profile) throw new Error('INVESTIGATOR profile not found');

                routed = await MultiAgentRouter.route('INVESTIGATOR', ContextManager.trimContext(prompt, profile.contextLimit || 4096), true, config.investigation.localTimeoutMs);
            }
            
            const aiResult: AgentResult = {
                response: routed.response,
                modelUsed: `${routed.model} (${routed.profile})`,
                status: 'success',
                agent: 'investigator-single'
            };

            console.log(`[Investigation Agent] Raw AI response (${aiResult.response.length} chars):`);
            console.log(aiResult.response.substring(0, 500) + '...');

            // Extract JSON from response (handle markdown code blocks, explanations, etc.)
            let rawJson = aiResult.response;
            
            // Strategy 1: Look for JSON in markdown code blocks
            const markdownMatch = aiResult.response.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (markdownMatch) {
                console.log('[Investigation Agent] Found JSON in markdown code block');
                rawJson = markdownMatch[1];
            }
            
            // Strategy 2: Look for outermost JSON object
            const jsonMatch = rawJson.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                rawJson = jsonMatch[0];
            }

            // Strategy 3: Clean up common issues
            rawJson = rawJson
                .replace(/^[^{]*/, '')  // Remove everything before first {
                .replace(/[^}]*$/, '')  // Remove everything after last }
                .replace(/,\s*}/g, '}')  // Remove trailing commas
                .replace(/,\s*]/g, ']')  // Remove trailing commas in arrays
                .replace(/'/g, '"')      // Convert single quotes to double
                .replace(/\n/g, ' ')     // Remove newlines
                .replace(/\s+/g, ' ');   // Normalize whitespace

            let parsed: any;

            try {
                const jsonObj = JSON.parse(rawJson);
                console.log('[Investigation Agent] JSON parsed successfully:', JSON.stringify(jsonObj, null, 2).substring(0, 300));
                const validated = InvestigationSchema.safeParse(jsonObj);
                if (validated.success) {
                    parsed = validated.data;
                } else {
                    console.warn('[Investigation Agent] JSON validation failed:', validated.error);
                    parsed = await this.tryCloudRepairJSON(aiResult.response, aiResult.response, 'INVESTIGATE');
                }
            } catch (parseError: any) {
                console.error('[Investigation Agent] JSON parse error:', parseError.message);
                console.error('[Investigation Agent] Raw JSON that failed:', rawJson.substring(0, 500));
                
                // Fallback: Generate basic checklist from AI response text
                console.log('[Investigation Agent] Generating fallback checklist from response...');
                parsed = this.generateFallbackChecklist(aiResult.response, jiraData.summary);
            }

            // Final fallback if everything failed
            if (!parsed || !parsed.checklist) {
                console.warn('[Investigation Agent] All parsing failed, using emergency fallback');
                parsed = this.generateFallbackChecklist(aiResult.response, jiraData.summary);
            }

            let checklist: InvestigationCheck[] = (parsed.checklist || []).map((check: any, i: number) => ({
                id: check.id || i + 1,
                description: check.description || 'Unknown check',
                category: check.category || 'General',
                testSuggestion: check.testSuggestion || '',
                status: 'pending' as const
            })).slice(0, config.investigation.maxChecks);

            const investigationId = require('uuid').v4();
            const result: InvestigationResult = {
                investigationId,
                jiraId,
                issueType: parsed.issueType || 'OTHER',
                checklist,
                summary: parsed.summary || 'Investigation completed',
                status: 'completed',
                aiModel: aiResult.modelUsed,
                riskScore: riskData.score,
                riskLevel: riskData.level,
                riskPatterns: riskData.patterns
            };

            this.responseCache.set(cacheKey, { value: result, timestamp: Date.now() });
            return result;

        } catch (err: any) {
            console.error('[Investigation Agent] Error:', err.message);
            return {
                investigationId: require('uuid').v4(),
                jiraId,
                issueType: 'OTHER',
                checklist: [{ id: 1, description: 'AI Failed', category: 'Error', testSuggestion: err.message, status: 'warning' }],
                summary: `Error: ${err.message}`,
                status: 'completed',
                aiModel: 'fallback',
                riskScore: riskData.score,
                riskLevel: riskData.level,
                riskPatterns: riskData.patterns
            };
        }
    }

    static async revise(
        jiraId: string,
        approvedChecklist: InvestigationCheck[],
        humanInput: any,
        targetEnv: string
    ): Promise<any> {
        const reproduceRules = SkillRegistry.executeSkill("REPRODUCE_WORKFLOW", {});
        const prompt = `### TASK: Revise Plan\n${reproduceRules}\nChecklist: ${JSON.stringify(approvedChecklist)}\nInput: ${JSON.stringify(humanInput)}\nEnv: ${targetEnv}`;

        try {
            const routed = await MultiAgentRouter.route('INVESTIGATOR', prompt, true);
            const jsonMatch = routed.response.match(/\{[\s\S]*\}/);
            const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : routed.response);
            return { jiraId, ...parsed, aiModel: routed.model };
        } catch (err: any) {
            return { jiraId, status: 'error', error: err.message };
        }
    }

    private static buildCacheKey(type: string, jiraId: string, payload: any): string {
        return `${type}:${jiraId}:${JSON.stringify(payload).length}`;
    }

    private static async tryCloudRepairJSON(prompt: string, rawResponse: string, type: 'INVESTIGATE' | 'REVISE'): Promise<any> {
        if (config.investigation.cloudMode === 'off') return this.getFallbackData(rawResponse, type);
        try {
            const routed = await MultiAgentRouter.routeWithProfile(config.investigation.cloudProfileName, `Fix this JSON for ${type}:\n${rawResponse}`, true);
            const match = routed.response.match(/\{[\s\S]*\}/);
            return JSON.parse(match ? match[0] : routed.response);
        } catch {
            return this.getFallbackData(rawResponse, type);
        }
    }

    private static getFallbackData(raw: string, type: string): any {
        return type === 'INVESTIGATE' ? { issueType: 'OTHER', checklist: [], summary: 'Parse failed' } : { adminSetupSteps: [], testExecutionSteps: [] };
    }

    /**
     * Generate a basic checklist from AI response text when JSON parsing fails.
     * This ensures users always get SOME checklist even if AI formatting is broken.
     */
    private static generateFallbackChecklist(aiResponse: string, summary: string): any {
        console.log('[Investigation Agent] Generating fallback checklist from text response...');
        
        // Extract any meaningful text from the response
        const cleanText = aiResponse
            .replace(/```/g, '')
            .replace(/json/g, '')
            .replace(/\{|\}/g, '')
            .replace(/"/g, '')
            .trim();

        // Generate basic checklist based on common patterns
        const checklist = [];
        
        // Always add these standard checks
        checklist.push({
            id: 1,
            description: "Verify the recorded user actions match expected workflow",
            category: "Functional",
            testSuggestion: "Review Harvester recording steps and compare with expected user journey"
        });

        checklist.push({
            id: 2,
            description: "Check network requests for errors (4xx, 5xx status codes)",
            category: "Network",
            testSuggestion: "Inspect network logs in Harvester JSON for failed API calls"
        });

        checklist.push({
            id: 3,
            description: "Verify UI elements are visible and enabled",
            category: "UI",
            testSuggestion: "Check that all form fields and buttons are interactable"
        });

        // If response mentions specific keywords, add relevant checks
        const lowerResponse = cleanText.toLowerCase();
        if (lowerResponse.includes('login') || lowerResponse.includes('password') || lowerResponse.includes('auth')) {
            checklist.push({
                id: 4,
                description: "Validate authentication credentials",
                category: "Authentication",
                testSuggestion: "Verify username/password are correct and account is not locked"
            });
        }

        if (lowerResponse.includes('api') || lowerResponse.includes('endpoint') || lowerResponse.includes('network')) {
            checklist.push({
                id: 5,
                description: "Check API endpoint availability",
                category: "Backend",
                testSuggestion: "Verify backend service is running and endpoints are accessible"
            });
        }

        if (lowerResponse.includes('permission') || lowerResponse.includes('access') || lowerResponse.includes('role')) {
            checklist.push({
                id: 6,
                description: "Verify user permissions and roles",
                category: "Authorization",
                testSuggestion: "Check User Level configuration and menu access rights"
            });
        }

        return {
            issueType: 'OTHER',
            checklist,
            summary: `AI analysis incomplete. Generated ${checklist.length} standard verification checks based on: ${summary.substring(0, 50)}...`
        };
    }

    private static async tryCloudRefineChecklist(prompt: string, parsed: any): Promise<any | null> {
        return null;
    }
}
