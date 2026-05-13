import { Page } from '@playwright/test';

export type ErrorType = 'Timeout' | 'NotFound' | 'NotVisible' | 'Assertion' | 'Unknown';

export interface DiagnosticResult {
  errorType: ErrorType;
  possibleCauses: string[];
  suggestedFix: string;
  confidence: number;
  checks: {
    elementExists: boolean;
    elementVisible: boolean;
    iframeDetected: boolean;
    modalOpen: boolean;
    networkError: boolean;
    angularStable: boolean;
  };
}

export class AutoDiagnosticService {
  /**
   * Automatically check for common failure causes
   */
  static async diagnose(page: Page, selector: string, error: string): Promise<DiagnosticResult> {
    const [
      elementExists,
      elementVisible,
      iframeDetected,
      modalOpen,
      networkError,
      angularStable
    ] = await Promise.all([
      this.checkElementExists(page, selector),
      this.checkElementVisible(page, selector),
      this.checkIframeDetected(page),
      this.checkModalOpen(page),
      this.checkNetworkError(page),
      this.checkAngularStable(page)
    ]);

    const errorType = this.classifyError(error);
    const possibleCauses = this.generatePossibleCauses({
        elementExists,
        elementVisible,
        iframeDetected,
        modalOpen,
        networkError,
        angularStable
      });
    
    const suggestedFix = this.generateSuggestedFix({
        elementExists,
        elementVisible,
        iframeDetected,
        modalOpen,
        networkError
      });

    const confidence = this.calculateConfidence({
        elementExists,
        elementVisible,
        iframeDetected,
        modalOpen,
        networkError,
        angularStable
      });

    return {
      errorType,
      possibleCauses,
      suggestedFix,
      confidence,
      checks: {
        elementExists,
        elementVisible,
        iframeDetected,
        modalOpen,
        networkError,
        angularStable
      }
    };
  }

  private static async checkElementExists(page: Page, selector: string) {
    if (!selector || !selector.trim()) return false;
    try {
      const count = await page.locator(selector).count();
      return count > 0;
    } catch {
      return false;
    }
  }

  private static async checkElementVisible(page: Page, selector: string) {
    if (!selector || !selector.trim()) return false;
    try {
      return await page.locator(selector).isVisible();
    } catch {
      return false;
    }
  }

  private static async checkIframeDetected(page: Page) {
    try {
        const iframes = await page.locator('iframe').count();
        return iframes > 0;
    } catch {
        return false;
    }
  }

  private static async checkModalOpen(page: Page) {
    try {
        const modals = await page.locator('[role="dialog"], .modal').count();
        return modals > 0;
    } catch {
        return false;
    }
  }

  private static async checkNetworkError(page: Page) {
    // In a real implementation, we would track this via page.on('requestfailed')
    return false;
  }

  private static async checkAngularStable(page: Page) {
    try {
      return await page.evaluate(() => {
        return !(window as any).zone || (window as any).zone.isStable;
      });
    } catch {
      return true; // Not an Angular app or can't check
    }
  }

  private static classifyError(error: string): ErrorType {
    if (error.includes('Timeout')) return 'Timeout';
    if (error.includes('not found') || error.includes('Unable to find')) return 'NotFound';
    if (error.includes('visible')) return 'NotVisible';
    if (error.includes('expect') || error.includes('Assertion')) return 'Assertion';
    return 'Unknown';
  }

  private static generatePossibleCauses(checks: any): string[] {
    const causes: string[] = [];

    if (!checks.elementExists) {
      causes.push('Element does not exist in DOM');
    }
    if (checks.elementExists && !checks.elementVisible) {
      causes.push('Element exists but is hidden');
    }
    if (checks.iframeDetected) {
      causes.push('Element may be inside an iframe (TinyMCE detected)');
    }
    if (checks.modalOpen) {
      causes.push('Modal dialog may be covering the element (Bootstrap detected)');
    }
    if (!checks.angularStable) {
      causes.push('Angular rendering may not be complete (Zone.js not stable)');
    }

    return causes;
  }

  private static generateSuggestedFix(checks: any): string {
    if (!checks.elementExists) {
      return 'Verify the selector is correct. Check if element ID or class has changed in this build.';
    }
    if (checks.elementExists && !checks.elementVisible) {
      return 'Wait for element to become visible: await element.waitFor({ state: "visible" })';
    }
    if (checks.iframeDetected) {
      return 'Switch to iframe first: await page.frameLocator("iframe").locator("...").click()';
    }
    if (checks.modalOpen) {
      return 'Close the active modal first or wait for it to disappear.';
    }
    return 'Review the Playwright error message and retry the test manually.';
  }

  private static calculateConfidence(checks: any): number {
    let confidence = 0.5;
    if (!checks.elementExists) confidence += 0.2;
    if (checks.iframeDetected) confidence += 0.1;
    if (checks.modalOpen) confidence += 0.1;
    return Math.min(confidence, 1.0);
  }
}
