import * as fs from 'fs';
import * as path from 'path';
import { LocalAIService } from '../../api/LocalAIService';
import { CloudAIService } from '../../api/CloudAIService';
import { config } from '../../api/config';
import { MultiAgentRouter } from '../../api/MultiAgentRouter';
import { AiControllerService } from './shared/AiControllerService';
import { appLogger } from '../utils/logger';

export interface ForensicDiagnostic {
    reason: string;
    suggestedFix: string;
    confidence: number;
    isUiChange: boolean;
    newSelector?: string;
    screenshotAnalyzed?: string;
}

export class VisualForensicsService {
    /**
     * Analyze a test failure using AI forensics
     * @param error - The error message from Playwright
     * @param lastStep - The description of the step that failed
     * @param screenshotPath - Path to the failure screenshot
     * @returns A diagnostic with suggested fix
     */
    static async diagnoseFailure(
        error: string,
        lastStep: string,
        screenshotPath?: string,
        domSnapshotPath?: string,
        a11ySnapshotPath?: string
    ): Promise<ForensicDiagnostic> {
        appLogger.info(`[VisualForensics] Analyzing failure for step: "${lastStep}"...`);

        // If screenshot exists, we would ideally pass it to a Vision model.
        // For now, we use the error context and step description for advanced reasoning.
        const screenshotExists = screenshotPath && fs.existsSync(screenshotPath);
        
        // Read DOM snippet to provide visual context and prevent hallucination
        let domSnippet = '';
        if (domSnapshotPath && fs.existsSync(domSnapshotPath)) {
            const rawHtml = fs.readFileSync(domSnapshotPath, 'utf-8');
            domSnippet = rawHtml.length > 20000 ? rawHtml.substring(0, 20000) + '\\n...[DOM TRUNCATED]' : rawHtml;
        }

        // Read Accessibility Tree for structural context
        let a11ySnippet = '';
        if (a11ySnapshotPath && fs.existsSync(a11ySnapshotPath)) {
            try {
                const rawA11y = fs.readFileSync(a11ySnapshotPath, 'utf-8');
                a11ySnippet = rawA11y.length > 10000 ? rawA11y.substring(0, 10000) + '\\n...[A11Y TRUNCATED]' : rawA11y;
            } catch (e) {}
        }

        const prompt = `
# Role: Senior QA Automation Expert & AI Forensic Investigator
# Task: Diagnose a Playwright test failure and suggest a permanent fix.

## FAILURE CONTEXT
- **Failed Step:** "${lastStep}"
- **Error Message:** ${error}
- **Screenshot Available:** ${screenshotExists ? 'Yes' : 'No'}
- **DOM Snapshot Available:** ${domSnippet ? 'Yes' : 'No'}
- **A11y Tree Available:** ${a11ySnippet ? 'Yes' : 'No'}

## UI STACK
- Angular 19+ (Zone.js)
- TinyMCE 5 (Rich Text)
- Kendo UI Components
- Bootstrap (Modals/Dropdowns)

${domSnippet ? `## DOM CONTEXT
\`\`\`html
${domSnippet}
\`\`\`
` : ''}

${a11ySnippet ? `## ACCESSIBILITY TREE CONTEXT
\`\`\`json
${a11ySnippet}
\`\`\`
` : ''}

## DIAGNOSTIC REQUIREMENTS
1. Analyze why the failure occurred.
2. Verify if the selector exists in the DOM.
3. Suggest a "Healed" approach using **VALID PLAYWRIGHT JAVASCRIPT CODE**.
4. **CRITICAL**: The "suggestedFix" field MUST contain ONLY valid, executable JavaScript code. DO NOT use numbered lists, bullet points, or explanations in this field.
5. If you need to perform multiple actions (e.g. click a parent menu first), include both lines of code.
6. Use "await page.locator(...).click({ force: true })" for resilient clicks.

## OUTPUT FORMAT (STRICT JSON ONLY)
{
    "reason": "Clear explanation of why it failed (Human readable)",
    "suggestedFix": "await page.locator('...').waitFor({state:'visible'}); await page.locator('...').click();",
    "confidence": 0.0 to 1.0,
    "isUiChange": true/false,
    "newSelector": "null or suggested CSS/XPath"
}
`.trim();

        try {
            let response: string;

            // Primary: use AiControllerService (CLI-only, Gemini for INVESTIGATOR)
            try {
                response = await AiControllerService.diagnoseFailure(prompt);
            } catch (aiCtrlErr: any) {
                appLogger.warn(`[VisualForensics] AiControllerService failed, trying MultiAgentRouter fallback: ${aiCtrlErr.message}`);

                if (process.env.ENABLE_AUTO_ROUTING === 'true') {
                    // Fallback: Use the intelligent Multi-Agent router (CLI agents)
                    const routeResult = await MultiAgentRouter.route('INVESTIGATOR', prompt, true);
                    response = routeResult.response;
                } else {
                    // Legacy fixed-model routing
                    const model = config.ai.defaultModel;
                    if (model.includes('gemini') || model.includes('gpt')) {
                        response = await CloudAIService.conductFinalAudit(prompt, "Return ONLY valid JSON.");
                    } else {
                        response = await LocalAIService.simpleGenerate(prompt, model);
                    }
                }
            }

            const diagnostic = this.parseDiagnostic(response);
            if (screenshotPath) diagnostic.screenshotAnalyzed = path.basename(screenshotPath);
            
            appLogger.info(`[VisualForensics] Diagnostic complete. Confidence: ${diagnostic.confidence}`);
            return diagnostic;
        } catch (err: any) {
            appLogger.error(`[VisualForensics] Diagnostic failed: ${err.message}`);
            return {
                reason: 'Diagnostic engine failed to analyze the error.',
                suggestedFix: 'Increase wait time or check if the element is inside a new container/iframe.',
                confidence: 0,
                isUiChange: false
            };
        }
    }

    private static parseDiagnostic(response: string): ForensicDiagnostic {
        try {
            // Strategy 1: Direct JSON parse
            const cleaned = response.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(cleaned);
            return {
                reason: parsed.reason || 'Unknown failure reason',
                suggestedFix: parsed.suggestedFix || 'No fix suggested',
                confidence: parsed.confidence || 0.5,
                isUiChange: !!parsed.isUiChange,
                newSelector: parsed.newSelector
            };
        } catch {
            // Strategy 2: Extract JSON from markdown code blocks
            try {
                const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[1].trim());
                    return {
                        reason: parsed.reason || 'Unknown failure reason',
                        suggestedFix: parsed.suggestedFix || 'No fix suggested',
                        confidence: parsed.confidence || 0.3,
                        isUiChange: !!parsed.isUiChange,
                        newSelector: parsed.newSelector
                    };
                }
            } catch { /* fall through */ }

            // Strategy 3: Extract first JSON object from text (brace matching)
            try {
                const firstBrace = response.indexOf('{');
                if (firstBrace !== -1) {
                    let depth = 0;
                    let jsonEnd = firstBrace;
                    for (let i = firstBrace; i < response.length; i++) {
                        if (response[i] === '{') depth++;
                        if (response[i] === '}') depth--;
                        if (depth === 0) { jsonEnd = i; break; }
                    }
                    const jsonText = response.substring(firstBrace, jsonEnd + 1);
                    const parsed = JSON.parse(jsonText);
                    return {
                        reason: parsed.reason || 'Unknown failure reason',
                        suggestedFix: parsed.suggestedFix || 'No fix suggested',
                        confidence: parsed.confidence || 0.2,
                        isUiChange: !!parsed.isUiChange,
                        newSelector: parsed.newSelector
                    };
                }
            } catch { /* fall through */ }

            // Strategy 4: Extract structured fields from plain text
            const reasonMatch = response.match(/(?:reason|cause|failure)[:\s]+(.+?)(?=\n|$)/i);
            const fixMatch = response.match(/(?:fix|solution|suggested)[:\s]+(.+?)(?=\n|$)/i);
            const confMatch = response.match(/(?:confidence|score)[:\s]+([0-9.]+)/i);
            const selectorMatch = response.match(/(?:selector|newSelector|css)[:\s]+(`[^`]+`|"[^"]+"|'[^']+')/i);

            if (reasonMatch || fixMatch) {
                return {
                    reason: reasonMatch?.[1]?.trim() || response.substring(0, 200),
                    suggestedFix: fixMatch?.[1]?.trim() || 'Increase wait time or verify selector',
                    confidence: confMatch ? parseFloat(confMatch[1]) : 0.1,
                    isUiChange: /ui\s*change|redesign|css\s*change|element\s*(not\s*)?found|selector/i.test(response),
                    newSelector: selectorMatch?.[1]?.replace(/[`"']/g, '').trim()
                };
            }

            // Strategy 5: Complete failure — return structured fallback
            throw new Error('Failed to parse diagnostic JSON');
        }
    }
}
