import { LocalAIService } from './LocalAIService';
import { ObjectRepoService } from './ObjectRepoService';
import { DbClient } from './app';
import { CircuitBreakerRegistry } from '../src/utils/CircuitBreaker';
import { VectorKnowledgeService } from '../src/services/VectorKnowledgeService';
import { appLogger } from '../src/utils/logger';

export interface HealingResult {
    originalSelector: string;
    newSelector: string;
    confidence: number;
    explanation: string;
}

/**
 * Pre-populated fallback map built from common UI patterns.
 */
const SAFE_FALLBACK_MAP: Record<string, string[]> = {
    "input[name='username']": ["#username", "input[type='email']", "[data-testid='username']"],
    "input[name='password']": ["#password", "input[type='password']", "[data-testid='password']"],
    "button:has-text('Save')": ["button[type='submit']", ".k-button:has-text('Save')", "button[title*='Save' i]"],
    "button:has-text('Add')": [".k-button-add", "button[title*='Add' i]", "button[aria-label*='Add' i]"],
    "button:has-text('Edit')": [".k-button-edit", "button[title*='Edit' i]"],
    "button:has-text('Delete')": [".k-button-delete", "button[title*='Delete' i]"],
    "button:has-text('Cancel')": [".k-button:has-text('Cancel')", "button:has-text('Close')"],
};

export class SelfHealingService {
    /**
     * AI-driven Selector Repair: Suggests a new selector based on DOM context.
     * Tiered recovery: 1. Rules, 2. RAG, 3. Local AI, 4. Vision
     */
    static async suggestRepair(
        objectId: string,
        brokenSelector: string,
        domSnapshot: string
    ): Promise<HealingResult | null> {
        console.log(`[Detective - SelfHealing] Investigating: ${objectId} (${brokenSelector})`);

        // TIER 1: Rule-based fallbacks
        const commonFallbacks = SAFE_FALLBACK_MAP[brokenSelector];
        if (commonFallbacks && domSnapshot) {
            for (const fallback of commonFallbacks) {
                if (domSnapshot.includes(fallback.split('[')[0].replace(/#|\./g, ''))) {
                    return {
                        originalSelector: brokenSelector,
                        newSelector: fallback,
                        confidence: 0.95,
                        explanation: `Matched known stable fallback.`
                    };
                }
            }
        }

        // TIER 2: Semantic RAG Search
        try {
            const matches = await VectorKnowledgeService.search(`Broken selector: ${brokenSelector}`, 'healed_selector', 1);
            if (matches.length > 0 && matches[0].similarity > 0.85) {
                return {
                    originalSelector: brokenSelector,
                    newSelector: matches[0].metadata?.newSelector || matches[0].content,
                    confidence: 0.90,
                    explanation: `Semantic match from past successful heals.`
                };
            }
        } catch (e) {}

        // TIER 3: Local AI DOM Analysis
        const breaker = CircuitBreakerRegistry.selfHealing();
        try {
            const repairJson = await breaker.execute(async () => {
                return await LocalAIService.repairSelector(brokenSelector, domSnapshot);
            });
            const data = JSON.parse(repairJson);
            if (data.bestSelector && data.bestSelector !== brokenSelector) {
                return {
                    originalSelector: brokenSelector,
                    newSelector: data.bestSelector,
                    confidence: data.confidence || 0.7,
                    explanation: data.reasoning || 'Local AI analysis.'
                };
            }
        } catch (e) {}

        return null;
    }

    /**
     * Heals the object, updates DB, and indexes for RAG learning.
     */
    static async healAndRegister(
        pool: DbClient,
        objectId: string,
        brokenSelector: string,
        domSnapshot: string
    ): Promise<string> {
        const repair = await this.suggestRepair(objectId, brokenSelector, domSnapshot);

        if (repair && repair.confidence > 0.7) {
            appLogger.info(`[SelfHealing] HEALED: ${brokenSelector} -> ${repair.newSelector}`);

            // 1. Update DB with 'pending_verification' status (Governance)
            try {
                await pool.query(
                    `UPDATE object_repository 
                     SET selector_primary = $1, 
                         status = 'pending_verification',
                         confidence = $2,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = $3`,
                    [repair.newSelector, repair.confidence, objectId]
                );
            } catch (e) {}

            // 2. CLOSED-LOOP LEARNING: Index this success into Vector Knowledge
            try {
                await VectorKnowledgeService.addKnowledge(
                    `Resolved broken selector ${brokenSelector} with ${repair.newSelector}`,
                    'healed_selector',
                    { originalSelector: brokenSelector, newSelector: repair.newSelector, healedAt: new Date().toISOString() }
                );
            } catch (e) {}

            return repair.newSelector;
        }

        return brokenSelector;
    }
}
