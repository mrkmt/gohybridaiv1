import { z } from 'zod';
import { ContextManager } from './ContextManager';
import { MultiAgentRouter } from './MultiAgentRouter';
import { ElementRepositoryService } from '../src/services/ElementRepositoryService';
import { AiCachingService } from '../src/services/AiCachingService';

const BddPlanSchema = z.object({
    steps: z.array(z.string()).min(1),
    targetRuleId: z.string().optional(),
});

export const ReproductionPlanRequestSchema = z.object({
    jiraId: z.string().min(1),
    ticket: z.object({
        summary: z.string().optional(),
        description: z.any().optional(),
    }).optional(),
    userInstructions: z.string().optional(), // NEW: User's specific requirements
    // Human Inputs
    url: z.string().url().optional(),
    customerId: z.string().optional(),
    environmentType: z.enum(['Development', 'Staging', 'Production']).default('Development'),
    idNumber: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    userLevel: z.string().optional(), // Admin, HR-Manager, Employee, etc.
    
    sanitizedSteps: z.array(z.unknown()).default([]),
    detectedForms: z.array(z.unknown()).optional(),
    detectedRules: z.array(z.unknown()).optional(),
});

type ReproductionPlanRequest = z.infer<typeof ReproductionPlanRequestSchema>;

function redactValue(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    const s = String(value);
    if (!s.trim()) return undefined;
    if (s.includes('***')) return '<REDACTED>';
    if (/\bpassword\b/i.test(s)) return '<REDACTED>';
    if (/\btoken\b/i.test(s)) return '<REDACTED>';
    return '<USER_INPUT>';
}

function sanitizeForPlan(step: any): Record<string, unknown> {
    const action = String(step?.action || step?.type || '').toLowerCase();
    const target =
        step?.elementName ||
        step?.target ||
        step?.selector ||
        step?.css ||
        step?.xpath ||
        step?.id ||
        undefined;

    const description = step?.description || step?.text || step?.label || step?.name || undefined;
    const url = step?.url ? String(step.url) : undefined;

    const value = action === 'input' || action === 'change' ? redactValue(step?.value) : undefined;

    // Keep only small, stable hints for the LLM (token-optimized).
    const out: Record<string, unknown> = {
        action: action || 'unknown',
        ...(target ? { target: String(target) } : {}),
        ...(description ? { description: String(description) } : {}),
        ...(url ? { url } : {}),
        ...(value ? { value } : {}),
    };
    return out;
}

function normalizeBddSteps(steps: string[]): string[] {
    const cleaned = steps
        .map(s => String(s || '').trim())
        .filter(Boolean)
        .map(s => s.replace(/\s+/g, ' '))
        .map(s => s.replace(/^[-*]\s+/, ''));

    // Enforce strict BDD keywords at the start of each step.
    return cleaned
        .map(s => {
            const m = s.match(/^(Given|When|Then|And|But)\b/i);
            if (m) {
                const kw = m[1].slice(0, 1).toUpperCase() + m[1].slice(1).toLowerCase();
                return kw + s.slice(m[0].length);
            }
            // If the model forgot the keyword, default to "And" to keep the plan valid.
            return `And ${s}`;
        });
}

function parseBddPlan(raw: string): { steps: string[]; targetRuleId?: string } {
    const trimmed = String(raw || '').trim();
    // Strategy 1: direct JSON parse
    try {
        const json = JSON.parse(trimmed);
        const validated = BddPlanSchema.safeParse(json);
        if (validated.success) {
            return { 
                steps: normalizeBddSteps(validated.data.steps),
                targetRuleId: validated.data.targetRuleId 
            };
        }
    } catch { /* ignore */ }

    // Strategy 2: extract JSON object from a noisy response
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
        try {
            const json = JSON.parse(match[0]);
            const validated = BddPlanSchema.safeParse(json);
            if (validated.success) {
                return { 
                    steps: normalizeBddSteps(validated.data.steps),
                    targetRuleId: validated.data.targetRuleId
                };
            }
        } catch { /* ignore */ }
    }

    // Strategy 3: parse as line-based plan (Legacy/Fallback)
    const lines = trimmed
        .replace(/```[\s\S]*?```/g, '')
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);

    const bddLines = lines
        .map(l => l.replace(/^\d+\.\s+/, ''))
        .filter(l => /^(Given|When|Then|And|But)\b/i.test(l));

    if (bddLines.length > 0) {
        return { steps: normalizeBddSteps(bddLines) };
    }

    // Final fallback: return a minimal plan.
    return {
        steps: [
            'Given I am on the login page for the target tenant',
            'When I perform the recorded user actions to reach the failing flow',
            'Then I should observe the reported issue and capture evidence',
        ],
    };
}

function ensureHasGwt(steps: string[]): boolean {
    const joined = steps.join('\n');
    return /\bGiven\b/.test(joined) && /\bWhen\b/.test(joined) && /\bThen\b/.test(joined);
}

function extractJiraText(desc: any): string {
    if (!desc) return '';
    if (typeof desc === 'string') return desc;
    
    // Handle Jira ADF (Atlassian Document Format)
    if (desc.type === 'doc' && Array.isArray(desc.content)) {
        return desc.content
            .map((node: any) => {
                if (node.type === 'paragraph' && Array.isArray(node.content)) {
                    return node.content.map((c: any) => c.text || '').join('');
                }
                return '';
            })
            .filter(Boolean)
            .join('\n');
    }
    return '';
}

export class ReproductionPlanService {
    static async generateBddPlan(req: ReproductionPlanRequest): Promise<{ steps: string[]; targetRuleId?: string; aiModel: string }> {
        // Cache Key: summarize the inputs that affect the plan structure
        const cacheParams = {
            jiraId: req.jiraId,
            summary: req.ticket?.summary,
            description: req.ticket?.description,
            sanitizedSteps: req.sanitizedSteps,
            detectedForms: req.detectedForms,
            detectedRules: req.detectedRules,
            userLevel: req.userLevel
        };

        const cached = AiCachingService.getCache<{ steps: string[]; targetRuleId?: string; aiModel: string }>(cacheParams, 'plan');
        if (cached) return cached;

        const summary = String(req.ticket?.summary || '').slice(0, 250);
        const description = String(extractJiraText(req.ticket?.description)).slice(0, 1500);

        const compactSteps = (req.sanitizedSteps || []).slice(0, 50).map(sanitizeForPlan);
        const compactForms = (req.detectedForms || []).slice(0, 10);
        
        // Provide rule IDs to the AI so it can tag the plan
        const compactRules = (req.detectedRules || []).slice(0, 10).map((r: any) => ({
            id: r.id,
            module: r.Module,
            rule: r.FormulaRule,
            behavior: r.ExpectedUIBehavior
        }));
// NEW: Provide real UI element context to make the AI "UI-Aware"
const allElements = await ElementRepositoryService.getAll();
const relevantElements = allElements
    .filter((el: any) => {
        const terms = [summary, description, ...compactRules.map((r: any) => r.module || '')];
        return terms.some(term =>
            el.page.toLowerCase().includes(term.toLowerCase()) ||
            el.elementName.toLowerCase().includes(term.toLowerCase()) ||
            el.relatedModule?.toLowerCase().includes(term.toLowerCase())
        );
    })
    .slice(0, 30)
    .map((el: any) => ({ name: el.elementName, type: el.type, page: el.page }));

        const humanInputs = {
            url: req.url,
            customerId: req.customerId,
            env: req.environmentType,
            idNumber: req.idNumber,
            username: req.username,
            userLevel: req.userLevel
        };

        const prompt = ContextManager.trimContext(`
You are generating a Phase 2 Reproduction Plan in strict BDD format.
CRITICAL: You must also detect ANOMALIES (mismatches between Jira instructions and UI_REPOSITORY).

${req.userInstructions ? `### HIGH PRIORITY USER INSTRUCTIONS (MANDATORY):
- ${req.userInstructions}
- THE ABOVE RULE OVERRIDES ALL OTHER JIRA OR SYSTEM DATA.` : ''}

Output STRICT JSON only (no markdown, no commentary):
{
  "steps": ["Given ...", "When ...", "Then ...", "And ..."],
  "targetRuleId": "ID_OF_THE_RULE_BEING_VERIFIED",
  "hasAnomaly": boolean,
  "anomalyReason": "Description of conflict between Jira and UI reality"
}

ANOMALY DETECTION RULES:
- If Jira mentions a field (e.g. 'Short Code') but the UI_REPOSITORY shows a different name (e.g. 'Code'), set hasAnomaly: true.
- If Jira mentions a button that is not in the UI_REPOSITORY, set hasAnomaly: true.
- If hasAnomaly is true, still attempt to generate steps using the UI_REPOSITORY reality, but explain why in anomalyReason.

Rules:
- Every step string MUST start with exactly one of: Given, When, Then, And, But
- The overall plan MUST contain at least one Given, one When, and one Then
- Use ONLY the sanitized data below; do NOT invent credentials or real usernames/passwords
- Use the human-provided context (Customer ID, User Level) to refine the "Given" preconditions
- Keep steps human-readable, deterministic, and free of volatile/hardcoded values
- If a step requires credentials, refer to them generically ("test username", "test password")
- Select the most relevant ID from 'Detected rules' and set it as 'targetRuleId'.

HUMAN INPUTS (Global Context):
${JSON.stringify(humanInputs, null, 2)}

JIRA DATA:
- ID: ${req.jiraId}
- Summary: ${summary || '(none)'}
- Description: ${description || '(none)'}
- Recent Comments (Check for Rovo AI insights): ${JSON.stringify((req.ticket as any)?.comments || [])}

AI HINT: If you see comments from "Atlassian Intelligence" or "Rovo AI", prioritize their analysis as they have internal Jira context.

CRITICAL INSTRUCTION: The Jira Summary or Description may contain Burmese (Myanmar) language. 
1. Accurately interpret the Burmese text to understand the bug (e.g., "disable ဖြစ်နေ" means "is disabled", "ထပ်နေ" means "overlapping").
2. Synthesize BDD steps in English that specifically target the logic described in the Burmese text.
3. If the user provides "Myanmar plain text" instructions, treat them as high-priority reproduction steps.

SANITIZED RECORDING (token-optimized):
- Steps (hints): ${compactSteps.length > 0 ? JSON.stringify(compactSteps) : '(None provided - rely on Jira and domain knowledge)'}
- Detected forms: ${compactForms.length > 0 ? JSON.stringify(compactForms) : '(None detected)'}
- Detected rules (pick the target ID from here): ${compactRules.length > 0 ? JSON.stringify(compactRules) : '(None detected)'}

UI_REPOSITORY (Known valid elements for this module):
${relevantElements.length > 0 ? JSON.stringify(relevantElements) : '(No pre-mapped elements found)'}

INSTRUCTION: If 'Steps (hints)' are missing or empty, use the Jira Summary/Description and the UI_REPOSITORY to synthesize a logical reproduction path. 
Prefer using element names found in the UI_REPOSITORY for button clicks and form inputs.
        `.trim(), 7000);

        const routed = await MultiAgentRouter.route('INVESTIGATOR', prompt, true);
        const parsed = parseBddPlan(routed.response);

        const finalSteps = normalizeBddSteps(parsed.steps).slice(0, 60);

        if (!ensureHasGwt(finalSteps)) {
            // One quick repair pass with minimal context.
            const repairPrompt = ContextManager.trimContext(`
Fix the following plan to strict BDD JSON with Given/When/Then.
Output ONLY JSON: {"steps":[...], "targetRuleId": "..."}

Current:
${JSON.stringify({ steps: finalSteps, targetRuleId: parsed.targetRuleId })}
            `.trim(), 2000);
            const repaired = await MultiAgentRouter.route('INVESTIGATOR', repairPrompt, true);
            const repairedParsed = parseBddPlan(repaired.response);
            const repairedSteps = normalizeBddSteps(repairedParsed.steps).slice(0, 60);
            return { steps: repairedSteps, targetRuleId: repairedParsed.targetRuleId || parsed.targetRuleId, aiModel: routed.model };
        }

        const result = { steps: finalSteps, targetRuleId: parsed.targetRuleId, aiModel: routed.model };
        AiCachingService.setCache(cacheParams, 'plan', result);
        return result;
    }
}

