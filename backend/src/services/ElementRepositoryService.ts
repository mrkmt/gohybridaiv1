/**
 * ElementRepositoryService — Legacy Proxy
 *
 * This service is now a legacy wrapper that delegates to ObjectRepositoryService.
 * Consolidated per Qwen audit to prevent dual-repository fragmentation.
 *
 * All new code should use ObjectRepositoryService directly.
 */

import { ObjectRepositoryService, PageElement } from './ObjectRepositoryService';

export { PageElement };

export class ElementRepositoryService {
    /**
     * Proxy: Add elements to the consolidated repository.
     * Supports both (page, elements[]) and (elements[]) signatures.
     */
    static async addElements(pageOrElements: string | any[], elements?: any[]): Promise<void> {
        if (Array.isArray(pageOrElements)) {
            // New usage: just pass pre-formatted elements
            await ObjectRepositoryService.addElements(pageOrElements as any);
            return;
        }

        const page = pageOrElements as string;
        const els = elements || [];

        console.log(`[ElementRepositoryService] Proxying addElements to ObjectRepositoryService for page: ${page}`);
        // Map simplified element format to PageElement if necessary
        const mapped: Partial<PageElement>[] = els.map(el => ({
            page,
            elementName: el.name || el.elementName,
            selector: el.selector,
            type: el.type || 'other',
            confidence: el.confidence || 0.7,
            section: el.section,
            discoveredAt: new Date().toISOString(),
            relatedModule: el.module || el.relatedModule
        }));

        await ObjectRepositoryService.addElements(mapped as any);
    }

    /**
     * Legacy proxy: Get all elements.
     */
    static async getAll(): Promise<PageElement[]> {
        return ObjectRepositoryService.getAll();
    }

    /**
     * Legacy proxy: Find elements for a page.
     */
    static async getElementsByPage(page: string): Promise<PageElement[]> {
        return ObjectRepositoryService.getElementsByPage(page);
    }

    /**
     * Legacy proxy: Find element by name and page.
     */
    static async getElement(page: string, elementName: string): Promise<PageElement | undefined> {
        const elements = await ObjectRepositoryService.getElementsByPage(page);
        return elements.find(el => el.elementName === elementName);
    }

    /**
     * Legacy proxy: Search across all elements.
     */
    static async searchElements(query: string): Promise<PageElement[]> {
        const all = await ObjectRepositoryService.getAll();
        const lowerQuery = query.toLowerCase();
        return all.filter((el: PageElement) =>
            el.elementName.toLowerCase().includes(lowerQuery) ||
            (el.page && el.page.toLowerCase().includes(lowerQuery)) ||
            (el.relatedModule && el.relatedModule.toLowerCase().includes(lowerQuery))
        );
    }}
