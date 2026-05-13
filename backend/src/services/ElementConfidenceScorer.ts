import { ElementInfo } from './discovery/PageElementDiscoveryService';
import { FrontendTechnologyReport } from './FrontendTechnologyDetector';

export interface ElementConfidenceResult {
  confidence: number;
  keyFactors: string[];
}

export class ElementConfidenceScorer {
  constructor(private readonly technologyReport: FrontendTechnologyReport) {}

  score(element: ElementInfo): ElementConfidenceResult {
    const keyFactors: string[] = [];

    const techConfidence = this.getTechSpecificConfidence(element, keyFactors);
    const occurrenceConfidence = this.estimateOccurrenceFrequency(element, keyFactors);
    const stabilityConfidence = this.analyzeStableAttributes(element, keyFactors);
    const stateConfidence = this.scoreElementState(element, keyFactors);

    const combined =
      techConfidence * 0.35 +
      occurrenceConfidence * 0.2 +
      stabilityConfidence * 0.35 +
      stateConfidence * 0.1;

    return {
      confidence: ElementConfidenceScorer.clamp(combined, 0.35, 0.99),
      keyFactors,
    };
  }

  private getTechSpecificConfidence(element: ElementInfo, keyFactors: string[]): number {
    const attributeKeys = Object.keys(element.attributes || {});
    const selector = (element.selector || '').toLowerCase();

    switch (this.technologyReport.primary) {
      case 'react': {
        const hit = attributeKeys.some(k => k.toLowerCase().startsWith('data-react-id')) ||
          selector.includes('__react');
        keyFactors.push(hit ? 'react:marker' : 'react:weak-signal');
        return hit ? 0.9 : 0.7;
      }
      case 'vue': {
        const hit = attributeKeys.some(k => k.toLowerCase().startsWith('data-v-'));
        keyFactors.push(hit ? 'vue:data-v' : 'vue:weak-signal');
        return hit ? 0.85 : 0.65;
      }
      case 'angular': {
        const hit = selector.includes('ng-reflect') ||
          attributeKeys.some(k => k.toLowerCase().startsWith('ng-reflect')) ||
          attributeKeys.some(k => k.toLowerCase() === 'formcontrolname' || k.toLowerCase() === 'formcontrol');
        keyFactors.push(hit ? 'angular:ng-reflect/form' : 'angular:weak-signal');
        return hit ? 0.8 : 0.6;
      }
      default: {
        const offset = this.detectOffset(element);
        keyFactors.push(`selector:offset=${offset}`);
        return offset < 3 ? 0.8 : 0.6;
      }
    }
  }

  private estimateOccurrenceFrequency(element: ElementInfo, keyFactors: string[]): number {
    const hasAlternatives = (element.altSelectors || []).length > 0;
    const nameQuality = (element.name || '').trim() && element.name.trim() !== '-' ? 1 : 0;
    const selectorComplexityPenalty = this.selectorComplexityPenalty(element.selector);

    const score =
      (hasAlternatives ? 0.8 : 0.6) * 0.55 +
      (nameQuality ? 0.8 : 0.55) * 0.45;

    const adjusted = score - selectorComplexityPenalty * 0.25;
    keyFactors.push(hasAlternatives ? 'alts:present' : 'alts:none');
    keyFactors.push(nameQuality ? 'name:present' : 'name:weak');
    if (selectorComplexityPenalty > 0) keyFactors.push('selector:complex');

    return ElementConfidenceScorer.clamp(adjusted, 0.45, 0.9);
  }

  private analyzeStableAttributes(element: ElementInfo, keyFactors: string[]): number {
    const selector = element.selector || '';
    const attributes = element.attributes || {};

    const hasNameAttr = typeof attributes.name === 'string' && attributes.name.trim().length > 0;
    const hasDataTest = Object.keys(attributes).some(k => k.toLowerCase() === 'data-test' || k.toLowerCase() === 'data-testid');
    const hasAriaLabel = typeof attributes['aria-label'] === 'string' && attributes['aria-label'].trim().length > 0;
    const hasFormControlName = typeof (attributes.formControlName || (attributes as any).formcontrolname) === 'string';
    const hasNgReflect = Object.keys(attributes).some(k => k.toLowerCase().startsWith('ng-reflect'));
    const hasStableId = selector.startsWith('#') && !selector.slice(1).startsWith('k-');

    let score = 0.55;

    if (hasDataTest) {
      score = Math.max(score, 0.92);
      keyFactors.push('attr:data-test');
    }
    if (hasAriaLabel) {
      score = Math.max(score, 0.85);
      keyFactors.push('attr:aria-label');
    }
    if (hasNameAttr) {
      score = Math.max(score, 0.82);
      keyFactors.push('attr:name');
    }
    if (hasFormControlName || hasNgReflect) {
      score = Math.max(score, 0.86);
      keyFactors.push('attr:angular-form');
    }
    if (hasStableId) {
      score = Math.max(score, 0.88);
      keyFactors.push('selector:stable-id');
    }

    const complexityPenalty = this.selectorComplexityPenalty(selector);
    if (complexityPenalty > 0) {
      score -= complexityPenalty * 0.2;
    }

    return ElementConfidenceScorer.clamp(score, 0.4, 0.96);
  }

  private scoreElementState(element: ElementInfo, keyFactors: string[]): number {
    if (element.isVisible && element.isEnabled) {
      keyFactors.push('state:visible+enabled');
      return 0.9;
    }
    if (element.isVisible) {
      keyFactors.push('state:visible');
      return 0.75;
    }
    keyFactors.push('state:not-visible');
    return 0.55;
  }

  private detectOffset(element: ElementInfo): number {
    const selector = element.selector || '';
    const depth = selector.split(' > ').length - 1;
    const nthCount = (selector.match(/:nth-child\(/g) || []).length;
    return depth + nthCount;
  }

  private selectorComplexityPenalty(selector: string | undefined): number {
    if (!selector) return 0;
    const depth = selector.split(' > ').length - 1;
    const hasNth = selector.includes(':nth-child(');
    const hasLongChain = depth >= 3;
    if (hasLongChain && hasNth) return 1;
    if (hasLongChain || hasNth) return 0.6;
    return 0;
  }

  private static clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}

