/**
 * SelectorEnrichmentService.ts
 * 
 * Enriches JSON test specifications with stable selectors from the Element Repository.
 * This service bridges the gap between AI-generated business field names and actual UI selectors.
 */

import {
  TestSpecification,
  TestScenario,
  ActionStep,
  FillStep,
  ClickStep,
  SelectOptionStep,
  CheckStep,
  UploadFileStep,
} from '../generation/TestSpecSchema';
import {
  resolveFieldSelector,
  resolveElementSelector,
  generateFallbackSelector,
  generateElementFallbackSelector,
} from '../ElementServiceQuery';
import { DiscoveryCacheService } from '../discovery/DiscoveryCacheService';

/**
 * Selector mapping for common business fields
 * This should be populated from ElementRepositoryService or database
 */
export interface SelectorMapping {
  /** Business field name (e.g., "username", "category") */
  fieldName: string;
  /** Module this field belongs to */
  module: string;
  /** Primary stable selector */
  primarySelector: string;
  /** Fallback selectors if primary fails */
  fallbackSelectors: string[];
  /** Field type for special handling */
  fieldType: 'input' | 'dropdown' | 'kendo-dropdown' | 'button' | 'checkbox' | 'file';
  /** Whether this field requires Angular wait */
  requiresAngularWait: boolean;
}

/**
 * Predefined selector mappings for common fields
 * In production, this would be loaded from ElementRepositoryService
 */
const SELECTOR_MAPPINGS: Record<string, SelectorMapping[]> = {
  // Authentication fields
  'username': [{
    fieldName: 'username',
    module: 'auth',
    primarySelector: 'input[name="username"], [ng-reflect-name="username"], #username',
    fallbackSelectors: ['input[placeholder*="username"]', 'input[type="text"]:first-child'],
    fieldType: 'input',
    requiresAngularWait: true,
  }],
  'password': [{
    fieldName: 'password',
    module: 'auth',
    primarySelector: 'input[type="password"], input[name="password"], #password',
    fallbackSelectors: ['input[placeholder*="password"]'],
    fieldType: 'input',
    requiresAngularWait: true,
  }],
  'idnumber': [{
    fieldName: 'idnumber',
    module: 'auth',
    primarySelector: 'input[name="idnumber"], [ng-reflect-name="idnumber"], #idnumber',
    fallbackSelectors: ['input[placeholder*="ID"]', 'input[placeholder*="id"]'],
    fieldType: 'input',
    requiresAngularWait: true,
  }],

  // Common action buttons
  'save': [{
    fieldName: 'save',
    module: 'common',
    primarySelector: 'button:has-text("Save"), .k-button:has-text("Save"), button[type="submit"]',
    fallbackSelectors: ['button.btn-primary', '.btn-success'],
    fieldType: 'button',
    requiresAngularWait: true,
  }],
  'add': [{
    fieldName: 'add',
    module: 'common',
    // Icon-only buttons may have no text — include CSS class and attribute selectors as primary
    primarySelector: '.k-button-add, button[title*="Add" i], button[aria-label*="Add" i], button:has-text("Add"), .k-button:has-text("Add")',
    fallbackSelectors: ['button:has-text("Add New")', '.btn-primary:has-text("Add")', '.action-btn.addNew', 'button:has(svg)'],
    fieldType: 'button',
    requiresAngularWait: true,
  }],
  'edit': [{
    fieldName: 'edit',
    module: 'common',
    // Edit buttons are often icon-only (pencil icon)
    primarySelector: 'button[title*="Edit" i], button[aria-label*="Edit" i], .k-button-edit, button:has-text("Edit"), .k-button:has-text("Edit")',
    fallbackSelectors: ['button:has-text("Edit Item")', '.btn-warning', 'button:has(svg)'],
    fieldType: 'button',
    requiresAngularWait: true,
  }],
  'delete': [{
    fieldName: 'delete',
    module: 'common',
    // Delete buttons are often icon-only (trash icon)
    primarySelector: 'button[title*="Delete" i], button[aria-label*="Delete" i], .k-button-delete, button:has-text("Delete"), .k-button:has-text("Delete")',
    fallbackSelectors: ['button:has-text("Delete Item")', '.btn-danger', 'button:has(svg)'],
    fieldType: 'button',
    requiresAngularWait: true,
  }],
  'cancel': [{
    fieldName: 'cancel',
    module: 'common',
    primarySelector: 'button:has-text("Cancel"), .k-button:has-text("Cancel")',
    fallbackSelectors: ['button:has-text("Close")', '.btn-secondary'],
    fieldType: 'button',
    requiresAngularWait: true,
  }],

  // Journal Entry fields
  'title': [{
    fieldName: 'title',
    module: 'journal-entry',
    primarySelector: 'input[name="title"], input[formcontrolname="title"], #title',
    fallbackSelectors: ['input[placeholder*="title"]', 'input[type="text"]:first-child'],
    fieldType: 'input',
    requiresAngularWait: true,
  }],
  'category': [{
    fieldName: 'category',
    module: 'journal-entry',
    primarySelector: 'kendo-dropdownlist[aria-label*="category"], [data-testid="category-dropdown"]',
    fallbackSelectors: ['select[name="category"]', 'input[role="combobox"][aria-label*="category"]'],
    fieldType: 'kendo-dropdown',
    requiresAngularWait: true,
  }],
  'description': [{
    fieldName: 'description',
    module: 'journal-entry',
    primarySelector: 'textarea[name="description"], textarea[formcontrolname="description"], #description',
    fallbackSelectors: ['textarea[placeholder*="description"]', 'div[contenteditable="true"]'],
    fieldType: 'input',
    requiresAngularWait: true,
  }],
  'attachment': [{
    fieldName: 'attachment',
    module: 'journal-entry',
    primarySelector: 'input[type="file"], input[accept*="image"], input[accept*="pdf"]',
    fallbackSelectors: ['button:has-text("Upload")', 'button:has-text("Attach")'],
    fieldType: 'file',
    requiresAngularWait: false,
  }],
};

/**
 * Selector Enrichment Service
 * Maps business field names to stable selectors
 */
export class SelectorEnrichmentService {
  private moduleContext: string = '';

  /**
   * Set the module context for selector lookup
   */
  setModuleContext(module: string) {
    this.moduleContext = module.toLowerCase();
  }

  /**
   * Get selector for a business field name
   */
  getSelectorForField(fieldName: string): { selector: string; fallbacks: string[]; fieldType: string } | null {
    const normalizedField = fieldName.toLowerCase().trim();
    
    // Look up in predefined mappings
    const mappings = SELECTOR_MAPPINGS[normalizedField];
    if (mappings && mappings.length > 0) {
      // Prefer mappings for current module
      const moduleMapping = mappings.find(m => m.module === this.moduleContext);
      const mapping = moduleMapping || mappings[0];
      
      return {
        selector: mapping.primarySelector,
        fallbacks: mapping.fallbackSelectors,
        fieldType: mapping.fieldType,
      };
    }

    // Generate selector from field name
    return this.generateSelectorFromFieldName(normalizedField);
  }

  /**
   * Generate selector from field name (fallback when no mapping exists)
   */
  private generateSelectorFromFieldName(fieldName: string): { selector: string; fallbacks: string[]; fieldType: string } {
    const fieldLower = fieldName.toLowerCase().replace(/\s+/g, '-');
    
    // Common selector patterns
    const primarySelector = [
      `[data-testid="${fieldLower}"]`,
      `[name="${fieldLower}"]`,
      `[formcontrolname="${fieldLower}"]`,
      `[ng-reflect-name="${fieldLower}"]`,
      `#${fieldLower}`,
    ].join(', ');

    const fallbackSelectors = [
      `label:has-text("${fieldName}"): + input`,
      `label:has-text("${fieldName}") ~ input`,
      `input[placeholder*="${fieldName}"]`,
      `textarea[placeholder*="${fieldName}"]`,
    ];

    return {
      selector: primarySelector,
      fallbacks: fallbackSelectors,
      fieldType: 'input',
    };
  }

  /**
   * Enrich a single step with selector information (async version).
   * Queries ElementRepositoryService + selectors file before falling
   * back to predefined mappings and intelligent heuristics.
   */
  async enrichStepAsync(step: ActionStep): Promise<ActionStep> {
    const fieldBasedSteps: string[] = ['fill', 'selectOption', 'check', 'uploadFile'];
    const elementBasedSteps: string[] = ['click'];

    const hasSelectorHint = 'selectorHint' in step;

    if (fieldBasedSteps.includes(step.type) && !hasSelectorHint) {
      const fieldStep = step as FillStep | SelectOptionStep | CheckStep | UploadFileStep;

      // Try ElementRepositoryService + selectors file first
      const resolved = await resolveFieldSelector(fieldStep.field, this.moduleContext || undefined);
      if (resolved) {
        return { ...step, selectorHint: resolved } as ActionStep;
      }

      const discovered = DiscoveryCacheService.lookupElementDefinition(fieldStep.field, this.moduleContext || undefined);
      if (discovered) {
        return { ...step, selectorHint: discovered.selector } as ActionStep;
      }

      // Fall back to predefined mappings
      const selectorInfo = this.getSelectorForField(fieldStep.field);
      if (selectorInfo) {
        return { ...step, selectorHint: selectorInfo.selector } as ActionStep;
      }
    }

    if (elementBasedSteps.includes(step.type) && !hasSelectorHint) {
      const clickStep = step as ClickStep;

      // Try ElementRepositoryService first
      const resolved = await resolveElementSelector(clickStep.element, this.moduleContext || undefined);
      if (resolved) {
        return { ...step, selectorHint: resolved } as ActionStep;
      }

      const discovered = DiscoveryCacheService.lookupElementDefinition(clickStep.element, this.moduleContext || undefined);
      if (discovered) {
        return { ...step, selectorHint: discovered.selector } as ActionStep;
      }

      // Fall back to predefined mappings
      const selectorInfo = this.getSelectorForElement(clickStep.element);
      if (selectorInfo) {
        return { ...step, selectorHint: selectorInfo.selector } as ActionStep;
      }
    }

    return step;
  }

  /**
   * Enrich a single step with selector information (sync fallback).
   * Uses predefined mappings only.
   */
  enrichStep(step: ActionStep): ActionStep {
    // Only enrich steps that need selectors
    const fieldBasedSteps: string[] = ['fill', 'selectOption', 'check', 'uploadFile'];
    const elementBasedSteps: string[] = ['click'];

    // Check if step has selectorHint property
    const hasSelectorHint = 'selectorHint' in step;

    if (fieldBasedSteps.includes(step.type) && !hasSelectorHint) {
      const fieldStep = step as FillStep | SelectOptionStep | CheckStep | UploadFileStep;
      const selectorInfo = this.getSelectorForField(fieldStep.field);

      if (selectorInfo) {
        return {
          ...step,
          selectorHint: selectorInfo.selector,
        } as ActionStep;
      }
    }

    if (elementBasedSteps.includes(step.type) && !hasSelectorHint) {
      const clickStep = step as ClickStep;
      const selectorInfo = this.getSelectorForElement(clickStep.element);

      if (selectorInfo) {
        return {
          ...step,
          selectorHint: selectorInfo.selector,
        } as ActionStep;
      }
    }

    return step;
  }

  /**
   * Enrich all steps in a scenario (async version)
   */
  async enrichScenarioAsync(scenario: TestScenario): Promise<TestScenario> {
    const enrichedSteps: ActionStep[] = [];
    for (const step of scenario.steps) {
      enrichedSteps.push(await this.enrichStepAsync(step as ActionStep));
    }
    return { ...scenario, steps: enrichedSteps };
  }

  /**
   * Enrich an entire test specification (async version)
   */
  async enrichSpecificationAsync(specification: TestSpecification): Promise<TestSpecification> {
    this.setModuleContext(specification.module);
    const enrichedScenarios: TestScenario[] = [];
    for (const scenario of specification.scenarios) {
      enrichedScenarios.push(await this.enrichScenarioAsync(scenario));
    }
    return { ...specification, scenarios: enrichedScenarios };
  }

  /**
   * Get selector for a button/element name
   */
  getSelectorForElement(elementName: string): { selector: string; fallbacks: string[] } | null {
    const normalizedElement = elementName.toLowerCase().trim();
    
    // Normalize common button text
    const normalizedText = normalizedElement
      .replace(/add new/g, 'add')
      .replace(/create new/g, 'create')
      .replace(/save changes/g, 'save')
      .replace(/delete item/g, 'delete')
      .replace(/edit item/g, 'edit');

    // Check if we have a mapping for this normalized name
    const mapping = SELECTOR_MAPPINGS[normalizedText];
    if (mapping && mapping.length > 0) {
      return {
        selector: mapping[0].primarySelector,
        fallbacks: mapping[0].fallbackSelectors,
      };
    }

    // Generate selector from element name
    const capitalizedText = normalizedText.charAt(0).toUpperCase() + normalizedText.slice(1);
    const selector = `button:has-text("${capitalizedText}"), .k-button:has-text("${capitalizedText}")`;
    const fallbacks = [
      `button:has-text("${normalizedText}")`,
      `a:has-text("${capitalizedText}")`,
      `.btn:has-text("${capitalizedText}")`,
    ];

    return { selector, fallbacks };
  }

  /**
   * Enrich all steps in a scenario
   */
  enrichScenario(scenario: TestScenario): TestScenario {
    const enrichedSteps = scenario.steps.map((step: any) => this.enrichStep(step));
    
    return {
      ...scenario,
      steps: enrichedSteps,
    };
  }

  /**
   * Enrich an entire test specification
   */
  enrichSpecification(specification: TestSpecification): TestSpecification {
    // Set module context
    this.setModuleContext(specification.module);

    // Enrich all scenarios
    const enrichedScenarios = specification.scenarios.map((scenario: any) => 
      this.enrichScenario(scenario)
    );

    return {
      ...specification,
      scenarios: enrichedScenarios,
    };
  }

  /**
   * Add custom selector mapping (for runtime additions)
   */
  addCustomMapping(mapping: SelectorMapping) {
    const fieldName = mapping.fieldName.toLowerCase();
    if (!SELECTOR_MAPPINGS[fieldName]) {
      SELECTOR_MAPPINGS[fieldName] = [];
    }
    SELECTOR_MAPPINGS[fieldName].push(mapping);
  }

  /**
   * Get all mappings for a module
   */
  getMappingsForModule(module: string): SelectorMapping[] {
    const moduleLower = module.toLowerCase();
    const mappings: SelectorMapping[] = [];
    
    for (const fieldMappings of Object.values(SELECTOR_MAPPINGS)) {
      for (const mapping of fieldMappings) {
        if (mapping.module === moduleLower) {
          mappings.push(mapping);
        }
      }
    }
    
    return mappings;
  }
}

// Singleton instance
export const selectorEnrichment = new SelectorEnrichmentService();

/**
 * Quick enrichment function
 */
export function enrichTestSpec(specification: TestSpecification): TestSpecification {
  return selectorEnrichment.enrichSpecification(specification);
}
