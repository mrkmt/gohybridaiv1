import crypto from 'crypto';
import { RedisService } from './RedisService';
import { FrontendTechnology } from './FrontendTechnologyDetector';

export interface SelectorConfidenceResult {
  score: number;
  alternatives: string[];
  keyFactors: string[];
}

export interface SelectorScorableElement {
  name: string;
  type: string;
  selector: string;
  altSelectors: string[];
  attributes: Record<string, string>;
}

export class SelectorConfidenceModel {
  private readonly redis: RedisService;

  constructor(private readonly redisKeyPrefix: string = 'selector_conf:v1') {
    this.redis = new RedisService();
  }

  async analyzeAll(
    elements: SelectorScorableElement[],
    primaryTech: FrontendTechnology,
    correlationKey: string = 'global'
  ): Promise<Record<string, SelectorConfidenceResult>> {
    const out: Record<string, SelectorConfidenceResult> = {};

    await Promise.all(elements.map(async (el) => {
      const cacheKey = this.buildCacheKey(primaryTech, correlationKey, el);
      const cached = await this.safeGet(cacheKey);
      if (cached) {
        out[el.selector] = cached;
        return;
      }

      const computed = this.compute(el, primaryTech);
      out[el.selector] = computed;
      void this.safeSet(cacheKey, computed, 60 * 60 * 24 * 7);
    }));

    return out;
  }

  private compute(element: SelectorScorableElement, primaryTech: FrontendTechnology): SelectorConfidenceResult {
    const keyFactors: string[] = [];
    const selector = element.selector || '';
    const selectorLower = selector.toLowerCase();
    const attributes = element.attributes || {};

    const hasDataTest = Object.keys(attributes).some(k => {
      const lk = k.toLowerCase();
      return lk === 'data-testid' || lk === 'data-test' || lk.startsWith('data-test');
    });
    const hasAriaLabel = typeof attributes['aria-label'] === 'string' && attributes['aria-label'].trim().length > 0;
    const hasName = typeof attributes.name === 'string' && attributes.name.trim().length > 0;
    const hasStableId = selector.startsWith('#') && !selector.slice(1).startsWith('k-');
    const hasFormControl = Object.keys(attributes).some(k => k.toLowerCase() === 'formcontrolname');
    const hasNgReflect = selectorLower.includes('ng-reflect') || Object.keys(attributes).some(k => k.toLowerCase().startsWith('ng-reflect'));

    const isComplex = selector.includes(':nth-child(') || selector.includes(' > ') || selector.includes('xpath=');
    const usesTextSelector = selectorLower.includes(':has-text(') || selectorLower.includes('text=');

    let score = 0.7;

    if (hasDataTest) {
      score = Math.max(score, 0.93);
      keyFactors.push('data-test');
    }
    if (hasStableId) {
      score = Math.max(score, 0.88);
      keyFactors.push('stable-id');
    }
    if (hasAriaLabel) {
      score = Math.max(score, 0.85);
      keyFactors.push('aria-label');
    }
    if (hasName) {
      score = Math.max(score, 0.82);
      keyFactors.push('name-attr');
    }
    if (primaryTech === 'angular' && (hasFormControl || hasNgReflect)) {
      score = Math.max(score, 0.86);
      keyFactors.push('angular-form');
    }

    if (usesTextSelector) {
      score = Math.max(score, 0.78);
      keyFactors.push('text-aware');
    }

    if (isComplex && !hasDataTest && !hasStableId) {
      score = Math.min(score, 0.72);
      keyFactors.push('complex-selector');
    }

    const alternatives = this.generateAlternatives(element, primaryTech, keyFactors);

    return {
      score: SelectorConfidenceModel.clamp(score, 0.35, 0.99),
      alternatives,
      keyFactors,
    };
  }

  private generateAlternatives(
    element: SelectorScorableElement,
    primaryTech: FrontendTechnology,
    keyFactors: string[]
  ): string[] {
    const alts = new Set<string>();
    for (const alt of element.altSelectors || []) {
      if (alt && alt.trim()) alts.add(alt.trim());
    }

    const attributes = element.attributes || {};
    const name = (attributes.name || element.name || '').trim();
    const aria = (attributes['aria-label'] || '').trim();
    const type = (element.type || '').toLowerCase();

    const addIfValid = (s: string) => {
      const v = s.trim();
      if (!v) return;
      if (v.length > 200) return;
      alts.add(v);
    };

    if (Object.keys(attributes).some(k => k.toLowerCase() === 'data-testid')) {
      const key = Object.keys(attributes).find(k => k.toLowerCase() === 'data-testid')!;
      addIfValid(`[data-testid="${attributes[key]}"]`);
    }

    if (Object.keys(attributes).some(k => k.toLowerCase() === 'data-test')) {
      const key = Object.keys(attributes).find(k => k.toLowerCase() === 'data-test')!;
      addIfValid(`[data-test="${attributes[key]}"]`);
    }

    if (aria) {
      addIfValid(`[aria-label="${aria.replace(/"/g, '\\"')}"]`);
      addIfValid(`role=${type.includes('button') ? 'button' : 'textbox'}[name="${aria.replace(/"/g, '\\"')}"]`);
      keyFactors.push('alt:aria');
    }

    if (name) {
      addIfValid(`[name="${name.replace(/"/g, '\\"')}"]`);
      keyFactors.push('alt:name');
    }

    const formControlNameKey = Object.keys(attributes).find(k => k.toLowerCase() === 'formcontrolname');
    if (primaryTech === 'angular' && formControlNameKey) {
      addIfValid(`[formControlName="${attributes[formControlNameKey].replace(/"/g, '\\"')}"]`);
      keyFactors.push('alt:formControlName');
    }

    if (type.includes('button') && element.name && element.name.trim() && element.name.trim() !== '-') {
      const safe = element.name.trim().replace(/"/g, '\\"');
      addIfValid(`role=button[name="${safe}"]`);
      addIfValid(`button:has-text("${safe}")`);
      keyFactors.push('alt:button-text');
    }

    return Array.from(alts);
  }

  private buildCacheKey(primaryTech: FrontendTechnology, correlationKey: string, el: SelectorScorableElement): string {
    const fingerprint = `${primaryTech}|${correlationKey}|${el.type}|${el.name}|${el.selector}|${Object.keys(el.attributes || {}).sort().join(',')}`;
    const digest = crypto.createHash('sha1').update(fingerprint).digest('hex');
    return `${this.redisKeyPrefix}:${primaryTech}:${digest}`;
  }

  private async safeGet(key: string): Promise<SelectorConfidenceResult | null> {
    try {
      const v = await this.redis.getDetectionCache(key);
      if (!v) return null;
      if (typeof v.score !== 'number' || !Array.isArray(v.alternatives) || !Array.isArray(v.keyFactors)) return null;
      return v as SelectorConfidenceResult;
    } catch {
      return null;
    }
  }

  private async safeSet(key: string, value: SelectorConfidenceResult, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.setDetectionCache(key, value, ttlSeconds);
    } catch {
      // Best-effort caching only.
    }
  }

  private static clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}

