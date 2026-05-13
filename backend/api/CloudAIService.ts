import { MultiAgentRouter } from './MultiAgentRouter';
import { config } from './config';

/**
 * CloudAIService — Refactored to use MultiAgentRouter.
 * This service now acts as a high-level wrapper to ensure backward compatibility
 * while leveraging the powerful multi-agent fallback logic of the router.
 */
export class CloudAIService {
    
    /**
     * General generation (typically for reasoning/logic).
     * Routes to 'REASONING' role in agent_profiles.json.
     */
    static async generate(prompt: string, timeoutMs?: number): Promise<string> {
        const result = await MultiAgentRouter.route('REASONING', prompt, false, timeoutMs);
        return result.response;
    }

    /**
     * HTTP fallback via OpenRouter.
     * Routes to 'ANALYST' role in agent_profiles.json.
     */
    static async generateViaOpenRouter(prompt: string, timeoutMs?: number): Promise<string> {
        const result = await MultiAgentRouter.route('ANALYST', prompt, false, timeoutMs);
        return result.response;
    }

    /**
     * High-speed generation via Groq.
     * Routes to 'QUICK' role in agent_profiles.json.
     */
    static async generateViaGroq(prompt: string, timeoutMs?: number): Promise<string> {
        const result = await MultiAgentRouter.route('QUICK', prompt, false, timeoutMs);
        return result.response;
    }

    /**
     * Multimodal generation (Vision + Text) using OpenAI-standard content blocks.
     * Routes to 'VISION' role in agent_profiles.json.
     */
    static async generateWithImage(
        prompt: string, 
        imageBase64: string, 
        mimeType: string = 'image/png',
        timeoutMs: number = 60000
    ): Promise<string> {
        // Construct the multi-modal payload as a JSON string for MultiAgentRouter
        const payload = JSON.stringify([
            { type: 'text', text: prompt },
            {
                type: 'image_url',
                image_url: {
                    url: `data:${mimeType};base64,${imageBase64}`
                }
            }
        ]);

        const result = await MultiAgentRouter.route('VISION', payload, false, timeoutMs);
        return result.response;
    }

    /**
     * Groq-specific vision fallback.
     * Still routes to 'VISION' role but can be used for explicit targeting if needed.
     */
    static async generateWithGroqVision(
        prompt: string,
        imageBase64: string,
        timeoutMs: number = 60000
    ): Promise<string> {
        // In the new system, we just route to the VISION role which handles fallback logic
        return this.generateWithImage(prompt, imageBase64, 'image/png', timeoutMs);
    }

    /**
     * The Chief Investigator: High-level reasoning for final audit.
     * Routes to 'INVESTIGATOR' role in agent_profiles.json.
     */
    static async conductFinalAudit(
        anomalySummary: string,
        policyContent: string,
        timeoutMs: number = 45000
    ): Promise<string> {
        const prompt = `
            # Role: Chief Forensic Investigator
            # Task: Issue a final verdict on a suspected software bug.

            ## EVIDENCE SUMMARY:
            ${anomalySummary}

            ## BUSINESS POLICY:
            ${policyContent}

            ## INSTRUCTION:
            1. Analyze if the anomalies violate the business policy.
            2. Issue a Verdict: [GUILTY] (Confirmed Bug) or [CLEAR] (Pass).
            3. Provide a human-readable explanation in a 'Digital Detective' tone.
            4. If GUILTY, point out the exact policy paragraph that was violated.
            5. IMPORTANT: Provide the entire explanation in BOTH English and Burmese (🇲🇲 မြန်မာဘာသာ).
        `;

        const result = await MultiAgentRouter.route('INVESTIGATOR', prompt, false, timeoutMs);
        return result.response;
    }

    /**
     * Embedding helper. (Still uses official Gemini API for now as it's specialized).
     */
    static async embed(text: string): Promise<number[]> {
        const apiKey = config.ai.geminiApiKey;
        if (!apiKey) throw new Error('GEMINI_API_KEY required for Embeddings');

        const url = `https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: "models/embedding-001",
                content: { parts: [{ text }] }
            })
        });

        const data = await response.json() as any;
        if (data.error) throw new Error(`Embedding Error: ${data.error.message}`);
        return data.embedding.values;
    }
}
