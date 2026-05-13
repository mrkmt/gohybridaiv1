import * as fs from 'fs';
import { PageElement } from './ElementRepositoryService';

export class HarvesterParserService {
    static parseHtmlReport(html: string): Omit<PageElement, 'id' | 'discoveredAt'>[] {
        const elements: Omit<PageElement, 'id' | 'discoveredAt'>[] = [];

        // 1. Extract Page URL
        const urlMatch = html.match(/<div class="url-badge"[^>]*>📄 (.*?)<\/div>/);
        const pageUrl = urlMatch ? urlMatch[1].trim() : 'Unknown Page';

        // 2. Extract Table Rows (Simple Regex for now, as it's a fixed format)
        // We look for rows in the "Primary" table first.
        const rowRegex = /<tr>\s*<td>(\d+)<\/td>\s*<td><span class="tag">(.*?)<\/span><\/td>\s*<td><strong>(.*?)<\/strong><\/td>\s*<td class="code">(.*?)<\/td>\s*<td class="code">(.*?)<\/td>/g;

        let match;
        while ((match = rowRegex.exec(html)) !== null) {
            const [, , typeStr, name, selector, xpath] = match;

            elements.push({
                page: pageUrl,
                elementName: name === '-' ? `Element at ${xpath}` : name,
                selector: selector.replace(/&quot;/g, '"'),
                type: this.mapType(typeStr),
                confidence: 90, // Manual scans are usually high confidence
                status: 'verified', // Manual import is considered verified
                businessLogicHint: 'Manually imported via Harvester Extension',
                relatedModule: 'Other', // Could be refined by AI later
                altSelectors: [xpath]
            });
        }

        return elements;
    }

    private static mapType(type: string): PageElement['type'] {
        const t = type.toLowerCase();
        if (t.includes('button')) return 'button';
        if (t.includes('input') || t.includes('textbox')) return 'input';
        if (t.includes('checkbox') || t.includes('select') || t.includes('dropdown')) return 'select';
        if (t.includes('link') || t === 'a') return 'link';
        return 'other';
    }
}
