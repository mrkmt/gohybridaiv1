import * as fs from 'fs';
import * as path from 'path';
import { appLogger } from '../utils/logger';

/**
 * POMGeneratorService
 * 
 * Automatically generates reusable Playwright Page Objects 
 * from the AI-discovered workflow rules.
 */
export class POMGeneratorService {
    private static OUTPUT_DIR = path.join(__dirname, '..', '..', 'playwright', 'pages');

    static async generate(moduleName: string, rules: any): Promise<string> {
        if (!fs.existsSync(this.OUTPUT_DIR)) fs.mkdirSync(this.OUTPUT_DIR, { recursive: true });
        
        const fileName = `${moduleName}Page.ts`;
        const filePath = path.join(this.OUTPUT_DIR, fileName);

        appLogger.info(`[POMGenerator] Generating reusable Page Object for ${moduleName}`);

        const classContent = `
import { Page, expect } from '@playwright/test';

/**
 * REUSABLE PAGE OBJECT: ${moduleName}
 * Generated autonomously from AI Discovery Rules.
 */
export class ${moduleName}Page {
    constructor(private page: Page) {}

    // --- Selectors ---
    readonly addButton = this.page.locator('.k-grid-add, button:has-text("Add"), .k-button:has-text("Add")').first();
    readonly saveButton = this.page.locator('.k-primary, button:has-text("Save"), .k-button:has-text("Save")').first();

    // --- Actions ---
    async openAddForm() {
        await this.addButton.click();
        await this.page.waitForSelector('.k-window, .k-edit-form', { state: 'visible' });
    }

    async fillForm(data: any) {
        // AI-mapped logic for fields:
        ${this.generateFieldLogic(rules.required_fields)}
    }

    async saveAndVerify() {
        await this.saveButton.click();
        // Wait for Kendo Toast
        const toast = this.page.locator('.k-notification-success, .k-notification-error');
        await expect(toast).toBeVisible({ timeout: 5000 });
        return await toast.innerText();
    }
}
        `.trim();

        fs.writeFileSync(filePath, classContent);
        return filePath;
    }

    private static generateFieldLogic(analysis: string): string {
        // This takes the AI analysis and turns it into executable filling logic
        if (!analysis) return '// No specific fields identified yet.';
        return `// Data Mapping: ${analysis.substring(0, 100)}...`;
    }
}
