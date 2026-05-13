/**
 * Stage 3: Skill Form Matcher
 * Matches normalized selectors from recordings against form skill files.
 * Pure code logic — NO AI calls.
 *
 * Flow:
 * 1. Load all form skill files from skills/GlobalHR/forms/
 * 2. Compare recording selectors with each form's objectSignature
 * 3. Return matched forms + their prerequisiteData requirements
 * 4. Also match business-logic rules based on keywords/URL patterns
 */

import * as fs from 'fs';
import * as path from 'path';

export interface FormMatch {
    formName: string;
    menuPath: string;
    matchScore: number;         // 0-1: how many signature objects matched
    matchedSelectors: string[]; // which selectors matched
    prerequisiteData: string[]; // what data is needed
    fields: any;                // form field definitions
    relatedForms?: string[];
}

export interface RuleMatch {
    ruleType: string;           // LOGIN_FAILED, PERMISSION_DENIED, etc.
    confidence: number;
    matchedKeywords: string[];
    checks: any[];              // pre-defined checklist (no AI needed)
}

export interface MatchResult {
    detectedForms: FormMatch[];
    detectedRules: RuleMatch[];
    allRequirements: string[];  // merged prerequisiteData from all matched forms
    issueType: string | null;   // top-matched rule type
}

export class SkillFormMatcher {
    private static formsDir = path.join(__dirname, '..', 'skills', 'GlobalHR', 'forms');
    private static rulesDir = path.join(__dirname, '..', 'skills', 'GlobalHR', 'business-logic');
    private static formCache: Map<string, any> = new Map();
    private static ruleCache: Map<string, any> = new Map();

    /**
     * Load all form skill files from disk (cached).
     */
    static loadForms(): Map<string, any> {
        if (this.formCache.size > 0) return this.formCache;
        try {
            if (!fs.existsSync(this.formsDir)) return this.formCache;
            const files = fs.readdirSync(this.formsDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                try {
                    const content = JSON.parse(fs.readFileSync(path.join(this.formsDir, file), 'utf-8'));
                    const key = file.replace('.json', '');
                    this.formCache.set(key, content);
                } catch (e) {
                    console.warn(`[SkillFormMatcher] Failed to load form: ${file}`);
                }
            }
            console.log(`[SkillFormMatcher] Loaded ${this.formCache.size} form skills`);
        } catch (e) {
            console.warn('[SkillFormMatcher] Forms directory not found');
        }
        return this.formCache;
    }

    /**
     * Load all business-logic rule files from disk (cached).
     */
    static loadRules(): Map<string, any> {
        if (this.ruleCache.size > 0) return this.ruleCache;
        try {
            if (!fs.existsSync(this.rulesDir)) return this.ruleCache;
            const files = fs.readdirSync(this.rulesDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                try {
                    const content = JSON.parse(fs.readFileSync(path.join(this.rulesDir, file), 'utf-8'));
                    this.ruleCache.set(content.ruleType, content);
                } catch (e) {
                    console.warn(`[SkillFormMatcher] Failed to load rule: ${file}`);
                }
            }
            console.log(`[SkillFormMatcher] Loaded ${this.ruleCache.size} business rules`);
        } catch (e) {
            console.warn('[SkillFormMatcher] Rules directory not found');
        }
        return this.ruleCache;
    }

    /**
     * Main entry: Match recording selectors + ticket text against skill files.
     * Returns detected forms, matched rules, and combined requirements.
     */
    static match(
        selectors: string[],
        ticketText: string = '',
        recordingUrl: string = '',
        menuNames: string[] = []
    ): MatchResult {
        const forms = this.loadForms();
        const rules = this.loadRules();

        // 1. Match forms by objectSignature AND menuNames
        const detectedForms: FormMatch[] = [];
        for (const [key, form] of forms) {
            // Priority 1: Exact menu name match (100% match)
            const exactMenuMatch = menuNames.some(m => 
                m.toLowerCase().trim() === form.formName.toLowerCase().trim()
            );

            // Priority 2: Selector matching
            const signature: string[] = form.objectSignature || [];
            const matchedSelectors = signature.filter(sig =>
                selectors.some(sel => this.selectorMatches(sel, sig))
            );

            const matchScore = exactMenuMatch ? 1.0 : (signature.length > 0
                ? matchedSelectors.length / signature.length
                : 0);

            if (matchScore >= 0.3 || exactMenuMatch) {
                detectedForms.push({
                    formName: form.formName,
                    menuPath: form.menuPath,
                    matchScore,
                    matchedSelectors,
                    prerequisiteData: form.prerequisiteData || [],
                    fields: form.fields,
                    relatedForms: form.relatedForms
                });
            }
        }

        // Sort by match score (highest first)
        detectedForms.sort((a, b) => b.matchScore - a.matchScore);

        // 2. Match business-logic rules by keywords + URL patterns
        const detectedRules: RuleMatch[] = [];
        const combinedText = `${ticketText} ${recordingUrl}`.toLowerCase();

        for (const [ruleType, rule] of rules) {
            const detection = rule.issueTypeDetection || {};
            const keywords: string[] = detection.keywords || [];
            const urlPatterns: string[] = detection.urlPatterns || [];

            const matchedKeywords = keywords.filter(kw =>
                combinedText.includes(kw.toLowerCase())
            );

            const matchedUrls = urlPatterns.filter(pat =>
                recordingUrl.toLowerCase().includes(pat.toLowerCase())
            );

            const totalMatches = matchedKeywords.length + matchedUrls.length;
            const totalPossible = keywords.length + urlPatterns.length;
            const confidence = totalPossible > 0 ? totalMatches / totalPossible : 0;

            if (confidence > 0) {
                detectedRules.push({
                    ruleType,
                    confidence,
                    matchedKeywords: [...matchedKeywords, ...matchedUrls],
                    checks: rule.checks || []
                });
            }
        }

        // Sort by confidence
        detectedRules.sort((a, b) => b.confidence - a.confidence);

        // 3. Merge all requirements
        const allRequirements = new Set<string>();
        for (const form of detectedForms) {
            for (const req of form.prerequisiteData) {
                allRequirements.add(req);
            }
        }

        const result: MatchResult = {
            detectedForms,
            detectedRules,
            allRequirements: Array.from(allRequirements),
            issueType: detectedRules.length > 0 ? detectedRules[0].ruleType : null
        };

        console.log(`[SkillFormMatcher] Matched ${detectedForms.length} forms, ${detectedRules.length} rules, ${allRequirements.size} requirements`);

        return result;
    }

    /**
     * Check if a recording selector matches a form signature selector.
     * Handles partial matches (class names, data attributes, ID fragments).
     */
    private static selectorMatches(recordingSel: string, signatureSel: string): boolean {
        // Exact match
        if (recordingSel === signatureSel) return true;

        // Both contain the same class name
        const recParts = recordingSel.split(/[.\s#\[\]>+~='"]+/).filter(Boolean);
        const sigParts = signatureSel.split(/[.\s#\[\]>+~='"]+/).filter(Boolean);

        // Check if any significant part matches
        for (const part of sigParts) {
            if (part.length < 3) continue; // skip tiny fragments
            if (recParts.some(rp => rp.includes(part) || part.includes(rp))) {
                return true;
            }
        }

        // Check contains relationship
        if (recordingSel.includes(signatureSel) || signatureSel.includes(recordingSel)) {
            return true;
        }

        return false;
    }

    /**
     * Clear caches (useful when skill files are updated at runtime).
     */
    static clearCache(): void {
        this.formCache.clear();
        this.ruleCache.clear();
    }
}
