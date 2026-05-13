/**
 * SelectorValidatorService
 *
 * Static utility for building robust, multi-strategy CSS/Playwright selectors
 * for buttons, fields, and other UI elements.
 *
 * NOTE: This is a reconstructed stub replacing the original corrupted binary.
 */

export class SelectorValidatorService {
  /** Build a multi-strategy selector chain for a button identified by its text. */
  static buildButtonSelectorChain(buttonText: string): string {
    const esc = buttonText.replace(/'/g, "\'");
    return [
      `button:has-text('${esc}')`,
      `[role="button"]:has-text('${esc}')`,
      `input[value='${esc}']`,
    ].join(', ');
  }

  /** Return true if the selector likely targets an icon-only button. */
  static needsIconFallback(selector: string): boolean {
    return (
      selector.includes('[class*="icon"]') ||
      selector.includes('mat-icon') ||
      selector.includes('k-icon') ||
      selector.includes('fa-') ||
      (!selector.includes('has-text') && !selector.includes('text='))
    );
  }

  /** Resolve a CSS selector for an input field by name and type. */
  static resolveFieldSelector(fieldName: string, _fieldType = 'text'): string {
    const lower = fieldName.toLowerCase().replace(/\s+/g, '-');
    return [
      `input[formControlName="${lower}"]`,
      `input[name="${lower}"]`,
      `textarea[formControlName="${lower}"]`,
      `[data-testid="${lower}"]`,
    ].join(', ');
  }

  /** Resolve a selector for a button by its label. */
  static resolveButtonSelector(buttonName: string): string {
    return `button:has-text('${buttonName}')`;
  }

  /** Validate that a selector string is syntactically plausible. */
  static isValidSelector(selector: string): boolean {
    return Boolean(selector && /^[\w\[\].#:*>~+,\s"'=-]/.test(selector.trim()));
  }
}
