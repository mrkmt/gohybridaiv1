import { KnowledgeService } from '../../../api/KnowledgeService';
import { LocalAIService } from '../../../api/LocalAIService';
import { CliAgentService } from '../../../api/CliAgentService';
import { BusinessRule, BusinessRulesService } from './BusinessRulesService';

interface SourceCitation {
    type: 'matrix' | 'document';
    id: string;
    text_snippet: string;
}

export interface VerificationResponse {
    answer: string;
    sources: SourceCitation[];
}

export class VerificationEngine {
    private static pool: any;

    static setPool(dbPool: any) {
        this.pool = dbPool;
    }

    /**
     * Responds to natural language queries by searching both Semantic Memory and Business Logic Matrix.
     */
    static async query(question: string): Promise<VerificationResponse> {
        console.log(`[Verification Engine] Query: "${question}"`);

        // Step A: Perform keyword search on the Business Logic Matrix (PostgreSQL)
        const matrixRules = await this.searchMatrixDB(question);

        // Step B: Perform semantic search on the Vector DB (RAG)
        let semanticDocs: any[] = [];
        try {
            semanticDocs = await KnowledgeService.findSemanticDocs(question, 2);
        } catch (e: any) {
            console.warn('[Verification Engine] Semantic search failed:', e.message);
        }

        // Step C: Synthesize answer using LLM
        const contextParts: string[] = [];
        const sources: SourceCitation[] = [];

        // Add Matrix context (PRIORITY)
        if (matrixRules.length > 0) {
            contextParts.push("### [HIGH PRIORITY] BUSINESS LOGIC MATRIX RULES ###");
            matrixRules.forEach((rule) => {
                contextParts.push(`RULE ID: ${rule.id}\nModule: ${rule.module}\nFormula: ${rule.formulaRule}\nBehavior: ${rule.expectedUIBehavior}`);
                sources.push({
                    type: 'matrix',
                    id: rule.id || 'unknown',
                    text_snippet: `${rule.module}: ${rule.formulaRule}`
                });
            });
            contextParts.push("### END MATRIX RULES ###");
        }

        // Add RAG context
        if (semanticDocs.length > 0) {
            contextParts.push("### [REFERENCE] DOCUMENT CONTEXT ###");
            semanticDocs.forEach((doc: any) => {
                const title = doc.title || doc.fileName;
                const snippet = doc.snippet || doc.content?.substring(0, 200) || '';
                const docPath = doc.path || doc.filePath;
                contextParts.push(`DOCUMENT: ${title}\nCONTENT: ${snippet}`);
                sources.push({
                    type: 'document',
                    id: docPath,
                    text_snippet: snippet.substring(0, 100) + "..."
                });
            });
            contextParts.push("### END DOCUMENT CONTEXT ###");
        }

        const context = contextParts.join('\n\n');

        // Check if query is complex
        const isComplex = question.toLowerCase().match(/(explain|why|how|what is the process|reason|policy)/);

        const prompt = `
        You are the "Go-Hybrid AI" Verification Assistant.
        Answer the user's question based ONLY on the provided context.

        ### CONTEXT:
        ${context}

        ### QUESTION:
        ${question}

        ### STICKT RULES:
        1. PRIORITIZE Matrix Rules. If a rule exists there, it is the ABSOLUTE TRUTH.
        2. BE CONCISE. Use bullet points for steps.
        3. DO NOT output more than 300 words.
        4. If you cannot find the answer, say "I don't have enough information in my knowledge base."

        ANSWER:
        `;

        try {
            // PRIMARY: Route through MultiAgentRouter (Gemini CLI / Qwen CLI)
            let answer = await LocalAIService.simpleGenerate(prompt);

            // FALLBACK: Gemini CLI directly if primary returned empty
            if (!answer || answer.trim() === "" || answer.length < 50) {
                console.log("[Verification Engine] Primary AI insufficient. Falling back to Gemini CLI...");
                try {
                    const cloudAnswer = await CliAgentService.generateFromCli(prompt, 'gemini');
                    if (cloudAnswer && cloudAnswer.trim() !== "") {
                        answer = cloudAnswer;
                    }
                } catch (cliErr: any) {
                    console.error("[Verification Engine] Gemini CLI also failed:", cliErr.message);
                }
            }

            // FINAL TRIMMING & CLEANUP
            answer = this.cleanAIResponse(answer || "");

            if (!answer || answer.trim() === "") {
                return this.generateDiagnosticReport(question, sources);
            }

            return {
                answer: answer.trim(),
                sources
            };
        } catch (err: any) {
            console.error(`[Verification Engine] AI Pipeline crashed:`, err.message);
            return this.generateDiagnosticReport(question, sources, err.message);
        }
    }

    /**
     * Cleans common LLM artifacts (markdown blocks, leading/trailing noise)
     */
    private static cleanAIResponse(text: string): string {
        return text
            .replace(/```[a-z]*\n/gi, '')
            .replace(/```/g, '')
            .replace(/^ANSWER:\s*/i, '')
            .trim();
    }

    /**
     * Generates a structural fallback report when AI synthesis fails
     */
    private static generateDiagnosticReport(question: string, sources: SourceCitation[], error?: string): VerificationResponse {
        const reportParts = [
            "⚠️ **AI Synthesis Unavailable**",
            "I couldn't generate a natural language response, but I found the following relevant data points in the knowledge base:",
            ""
        ];

        if (sources.length > 0) {
            sources.forEach(s => {
                const typeLabel = s.type === 'matrix' ? "Matrix Rule" : "Document Snippet";
                reportParts.push(`- **${typeLabel} (${s.id})**: ${s.text_snippet}`);
            });
        } else {
            reportParts.push("_No direct matches found in either the Rule Matrix or Documentation._");
        }

        if (error) {
            reportParts.push("", `*Diagnostic Detail: ${error}*`);
        }

        return {
            answer: reportParts.join('\n'),
            sources
        };
    }

    /**
     * Simple keyword match against the PostgreSQL business_rules table
     */
    private static async searchMatrixDB(query: string): Promise<BusinessRule[]> {
        if (!this.pool) return [];

        try {
            const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
            if (terms.length === 0) return await BusinessRulesService.getAll(this.pool);

            // Search by text match in DB
            const textMatches = await BusinessRulesService.searchByText(this.pool, query);

            // Also search by keywords
            let keywordMatches: BusinessRule[] = [];
            try {
                keywordMatches = await BusinessRulesService.searchByKeywords(this.pool, terms);
            } catch { }

            // Deduplicate
            const seen = new Set<string>();
            const deduped: BusinessRule[] = [];
            for (const rule of [...textMatches, ...keywordMatches]) {
                if (!seen.has(rule.id)) {
                    seen.add(rule.id);
                    deduped.push(rule);
                }
            }
            return deduped.slice(0, 5);
        } catch (e: any) {
            console.warn(`[Verification Engine] DB search failed:`, e.message);
            return [];
        }
    }
}
