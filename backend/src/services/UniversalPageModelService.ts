import { ElementInfo, PageInventory } from './discovery/PageElementDiscoveryService';
import { FrontendTechnologyDetector, FrontendTechnologyReport } from './FrontendTechnologyDetector';
import { InteractionStrategy, InteractionStrategyResolver } from './InteractionStrategyResolver';
import { ElementConfidenceScorer } from './ElementConfidenceScorer';
import { SelectorConfidenceModel } from './SelectorConfidenceModel';
import { RedisService } from './RedisService';

export interface UniversalPageElement {
  name: string;
  type: string;
  selector: string;
  altSelectors: string[];
  frameworkHints: string[];
  semantics: string[];
  interaction: InteractionStrategy;
  attributes: Record<string, string>;
  confidence: number;
  keyFactors: string[];
  selectorAlternatives: string[];
  /** S4-1: propagated from ElementInfo.stateKey. */
  stateKey?: string;
  /** S4-2: semantic tags populated by DiscoveryEnricher. */
  required?: boolean;
  role?: 'submit' | 'cancel' | 'destructive' | 'nav' | 'input' | 'control' | 'search' | 'other';
  triggers?: 'modal' | 'dropdown' | 'navigation' | 'submit' | 'none';
}

export interface UniversalPageModel {
  url: string;
  pageTitle: string;
  discoveredAt: string;
  technologies: FrontendTechnologyReport;
  summary: string;
  elements: UniversalPageElement[];
  counts: {
    buttons: number;
    inputs: number;
    dropdowns: number;
    grids: number;
    modals: number;
    tabs: number;
  };
}

export class UniversalPageModelService {
  static build(inventory: PageInventory): UniversalPageModel {
    const technologies = FrontendTechnologyDetector.detect(inventory);
    const elements = this.normalizeElements(inventory, technologies);

    return {
      url: inventory.url,
      pageTitle: inventory.pageTitle,
      discoveredAt: inventory.discoveredAt,
      technologies,
      summary: inventory.summary,
      elements,
      counts: {
        buttons: inventory.buttons.length,
        inputs: inventory.inputs.length,
        dropdowns: inventory.dropdowns.length,
        grids: inventory.grids.length,
        modals: inventory.modals.length,
        tabs: inventory.tabs.length,
      },
    };
  }

  static async buildEnhanced(inventory: PageInventory): Promise<UniversalPageModel> {
    const model = this.build(inventory);
    const selectorModel = new SelectorConfidenceModel();

    // Redis cache key for selector confidence
    const cacheKey = `selector_confidence:${inventory.hash}`;
    const redisService = new RedisService();
    const cached = await redisService.getDetectionCache(cacheKey);

    let selectorScores;
    if (cached) {
      selectorScores = JSON.parse(cached);
    } else {
      selectorScores = await selectorModel.analyzeAll(
        model.elements,
        model.technologies.primary,
        inventory.url
      );
      // Cache for 1 hour
      await redisService.setDetectionCache(cacheKey, JSON.stringify(selectorScores), 3600);
    }

    const elements = model.elements.map(el => {
      const selectorScore = selectorScores[el.selector];
      if (!selectorScore) return el;

      const mergedAlternatives = Array.from(new Set([
        ...el.selectorAlternatives,
        ...selectorScore.alternatives,
      ]));

      const mergedKeyFactors = Array.from(new Set([
        ...el.keyFactors,
        ...selectorScore.keyFactors.map((k: string) => `selector:${k}`),
      ]));

      const confidence = Math.max(
        0.35,
        Math.min(0.99, el.confidence * 0.55 + selectorScore.score * 0.45)
      );

      return {
        ...el,
        confidence,
        keyFactors: mergedKeyFactors,
        selectorAlternatives: mergedAlternatives,
      };
    });

    return { ...model, elements };
  }

  private static normalizeElements(
    inventory: PageInventory,
    technologies: FrontendTechnologyReport
  ): UniversalPageElement[] {
    const scorer = new ElementConfidenceScorer(technologies);
    const elementSources: ElementInfo[] = [
      ...inventory.buttons,
      ...inventory.inputs,
      ...inventory.dropdowns,
      ...inventory.checkboxes,
      ...inventory.radios,
      ...inventory.other,
    ];

    return elementSources.map(element => {
      const { confidence, keyFactors } = scorer.score(element);
      return {
        name: element.name,
        type: element.type,
        selector: element.selector,
        altSelectors: element.altSelectors,
        frameworkHints: this.inferFrameworkHints(element, technologies),
        semantics: this.inferSemantics(element),
        interaction: InteractionStrategyResolver.resolveElement(element, technologies),
        attributes: element.attributes,
        confidence,
        keyFactors,
        selectorAlternatives: Array.from(new Set([element.selector, ...(element.altSelectors || [])])),
        stateKey: element.stateKey,
        required: element.required,
        role: element.role,
        triggers: element.triggers,
      };
    });
  }

  private static inferFrameworkHints(element: ElementInfo, technologies: FrontendTechnologyReport): string[] {
    const hints = new Set<string>();
    const selector = element.selector.toLowerCase();
    const type = element.type.toLowerCase();

    for (const detected of technologies.detected) {
      hints.add(detected.technology);
    }

    if (selector.includes('k-') || selector.includes('kendo-') || type.includes('kendo')) hints.add('kendo-ui');
    if (selector.includes('formcontrolname') || type.includes('angular-')) hints.add('angular');
    if (selector.includes('.btn') || selector.includes('modal')) hints.add('bootstrap');
    if (selector.includes('tox') || selector.includes('mce-')) hints.add('tinymce');
    if (selector.includes('ck-editor')) hints.add('ckeditor');

    return Array.from(hints);
  }

  private static inferSemantics(element: ElementInfo): string[] {
    const semantics = new Set<string>();
    const type = element.type.toLowerCase();
    const name = element.name.toLowerCase();
    const selector = element.selector.toLowerCase();

    if (type.includes('button')) semantics.add('action-control');
    if (type.includes('input') || type.includes('textarea')) semantics.add('data-entry');
    if (type.includes('dropdown') || type === 'select') semantics.add('choice-control');
    if (type.includes('checkbox') || type.includes('radio')) semantics.add('boolean-choice');
    if (selector.includes('search') || name.includes('search')) semantics.add('search-control');
    if (name.includes('save') || name.includes('submit')) semantics.add('commit-action');
    if (name.includes('add') || name.includes('new') || name.includes('create')) semantics.add('create-action');
    if (name.includes('edit') || name.includes('update')) semantics.add('update-action');
    if (name.includes('delete') || name.includes('remove')) semantics.add('destructive-action');

    return Array.from(semantics);
  }
}
