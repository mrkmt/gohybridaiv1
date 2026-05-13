import { ElementInfo, PageInventory } from './discovery/PageElementDiscoveryService';
import { FrontendTechnologyReport } from './FrontendTechnologyDetector';

export type InteractionKind =
  | 'click'
  | 'fill'
  | 'select'
  | 'toggle'
  | 'navigate-tab'
  | 'grid-action'
  | 'edit-rich-text'
  | 'modal-action'
  | 'assert-visible';

export interface InteractionStrategy {
  kind: InteractionKind;
  framework: string;
  method: string;
  waits: string[];
  verification: string[];
  notes: string[];
}

export class InteractionStrategyResolver {
  static resolveElement(element: ElementInfo, tech: FrontendTechnologyReport): InteractionStrategy {
    const primaryTech = tech.primary;
    const selector = element.selector.toLowerCase();
    const type = element.type.toLowerCase();
    const name = element.name.toLowerCase();

    if (this.isRichText(element)) {
      return {
        kind: 'edit-rich-text',
        framework: selector.includes('tox') || name.includes('tinymce') ? 'tinymce' : 'ckeditor',
        method: 'detect editor container, switch iframe/content root, set content through editor-safe path',
        waits: ['wait editor visible', 'wait editor ready'],
        verification: ['read editor content', 'verify persisted value after blur/save'],
        notes: ['Do not treat rich text editor as a normal input'],
      };
    }

    if (type.includes('dropdown') || type === 'select' || selector.includes('combobox')) {
      return {
        kind: 'select',
        framework: primaryTech,
        method: primaryTech === 'kendo-ui'
          ? 'open detached popup, then select list item from overlay container'
          : 'use native selectOption or click option flow',
        waits: primaryTech === 'kendo-ui'
          ? ['wait dropdown trigger visible', 'wait overlay option list visible']
          : ['wait control visible'],
        verification: ['verify selected text/value'],
        notes: primaryTech === 'kendo-ui'
          ? ['Kendo dropdown options are often detached under body']
          : [],
      };
    }

    if (type.includes('checkbox') || type.includes('radio')) {
      return {
        kind: 'toggle',
        framework: primaryTech,
        method: 'prefer label-aware click, then verify checked state',
        waits: ['wait control visible'],
        verification: ['verify checked/unchecked state'],
        notes: [],
      };
    }

    if (type.includes('grid')) {
      return {
        kind: 'grid-action',
        framework: primaryTech,
        method: 'target grid container first, then row/cell/toolbar action',
        waits: ['wait grid visible', 'wait data rows or empty-state rendered'],
        verification: ['verify row count, cell text, or toolbar state'],
        notes: ['Grid container visibility alone is not enough; data readiness matters'],
      };
    }

    if (this.isModalElement(element, selector)) {
      return {
        kind: 'modal-action',
        framework: primaryTech,
        method: 'act only after modal/dialog container is visible and stable',
        waits: ['wait modal visible', 'wait modal controls ready'],
        verification: ['verify modal closes or expected modal state changes'],
        notes: [],
      };
    }

    if (type.includes('tab')) {
      return {
        kind: 'navigate-tab',
        framework: primaryTech,
        method: 'activate tab header, then wait tab content to render',
        waits: ['wait tab header clickable', 'wait tab content visible'],
        verification: ['verify active tab state and unique tab content'],
        notes: [],
      };
    }

    if (this.isInputLike(type, selector)) {
      return {
        kind: 'fill',
        framework: primaryTech,
        method: primaryTech === 'angular' || primaryTech === 'kendo-ui'
          ? 'fill value, blur field, wait for change detection/stabilization'
          : 'fill value directly',
        waits: primaryTech === 'kendo-ui'
          ? ['wait field visible', 'wait Kendo stabilization after input']
          : ['wait field visible'],
        verification: ['verify input value', 'verify validation state if relevant'],
        notes: primaryTech === 'angular'
          ? ['Prefer stable form-control selectors over deep CSS chains']
          : [],
      };
    }

    return {
      kind: 'click',
      framework: primaryTech,
      method: this.isIconOnly(element)
        ? 'use structural or attribute-based selector, not visible-text lookup'
        : 'prefer role/text-aware click with selector fallback',
      waits: ['wait target visible', 'wait post-click UI stabilization'],
      verification: ['verify expected state transition, URL, modal, toast, or DOM change'],
      notes: this.isIconOnly(element)
        ? ['Icon-only controls need verified selector fallback']
        : [],
    };
  }

  static resolveInventory(inventory: PageInventory, tech: FrontendTechnologyReport): Record<string, InteractionStrategy> {
    const allElements = [
      ...inventory.buttons,
      ...inventory.inputs,
      ...inventory.dropdowns,
      ...inventory.checkboxes,
      ...inventory.radios,
      ...inventory.other,
    ];

    const strategies: Record<string, InteractionStrategy> = {};
    for (const el of allElements) {
      strategies[`${el.type}:${el.name}:${el.selector}`] = this.resolveElement(el, tech);
    }
    return strategies;
  }

  private static isInputLike(type: string, selector: string): boolean {
    return type.includes('input') || type.includes('textarea') || selector.includes('[contenteditable');
  }

  private static isModalElement(element: ElementInfo, selector: string): boolean {
    return element.type.toLowerCase().includes('dialog') || selector.includes('dialog') || selector.includes('modal');
  }

  private static isRichText(element: ElementInfo): boolean {
    const selector = element.selector.toLowerCase();
    const name = element.name.toLowerCase();
    return selector.includes('tox') ||
      selector.includes('mce-') ||
      selector.includes('ck-editor') ||
      name.includes('tinymce') ||
      name.includes('ckeditor') ||
      element.attributes.contenteditable === 'true';
  }

  private static isIconOnly(element: ElementInfo): boolean {
    const textSignals = [element.name, element.attributes['aria-label'], element.attributes['title']]
      .map(v => (v || '').trim())
      .filter(Boolean);
    return textSignals.length === 0;
  }
}
