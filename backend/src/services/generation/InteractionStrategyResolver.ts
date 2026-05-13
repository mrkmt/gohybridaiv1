/**
 * InteractionStrategyResolver
 * Resolves the best Playwright interaction strategy for a given UI element.
 */

export type InteractionKind =
  | 'click'
  | 'fill'
  | 'select'
  | 'check'
  | 'uncheck'
  | 'hover'
  | 'press'
  | 'upload'
  | 'drag'
  | 'scroll';

export interface InteractionStrategy {
  kind: InteractionKind;
  selector: string;
  value?: string;
  options?: Record<string, unknown>;
}

export class InteractionStrategyResolver {
  /**
   * Resolve the best interaction strategy for a step action + target.
   */
  static resolve(action: string, selector: string, value?: string): InteractionStrategy {
    const kind = InteractionStrategyResolver.actionToKind(action);
    return { kind, selector, value };
  }

  private static actionToKind(action: string): InteractionKind {
    const a = (action || '').toLowerCase();
    if (a.includes('fill') || a.includes('type') || a.includes('input')) return 'fill';
    if (a.includes('select') || a.includes('choose')) return 'select';
    if (a.includes('check')) return 'check';
    if (a.includes('uncheck')) return 'uncheck';
    if (a.includes('hover')) return 'hover';
    if (a.includes('press') || a.includes('key')) return 'press';
    if (a.includes('upload')) return 'upload';
    if (a.includes('drag')) return 'drag';
    if (a.includes('scroll')) return 'scroll';
    return 'click';
  }
}
