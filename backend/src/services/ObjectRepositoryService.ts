/**
 * ObjectRepositoryService — Enhanced
 *
 * Centralized UI element selector repository with versioning,
 * verification tracking, and multi-source selector resolution.
 */

import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { appLogger } from '../utils/logger';

export interface SelectorVersion {
    previousSelector: string;
    newSelector: string;
    changedAt: string;
    changedBy: string;
    reason?: string;
}

export interface ElementVerification {
    timestamp: string;
    status: 'pass' | 'fail';
    executionId?: string;
    errorMessage?: string;
}

export interface RepoStatistics {
    totalElements: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    verifiedCount: number;
    lastVerified?: string;
}

export interface PageElement {
    id: string;
    page: string;
    elementName: string;
    selector: string;
    /** Alternative selectors for fallback */
    altSelectors?: string[];
    /** Other selector alternatives (legacy or AI suggested) */
    selectorAlternatives?: string[];
    type: 'button' | 'input' | 'dropdown' | 'select' | 'link' | 'text' | 'grid' | 'tab' | 'other' | 'textarea' | 'checkbox' | 'file' | 'table';
    confidence: number;
    /** Section of the page where this element is located */
    section?: string;
    /** Business context hint for AI script generation */
    businessLogicHint?: string;
    /** Which HR module this element belongs to */
    relatedModule?: string;
    /** Current status of the selector */
    status: 'verified' | 'pending_verification' | 'suggested' | 'deprecated';
    /** When this element was first discovered */
    discoveredAt: string;
    /** Last time this selector was verified in actual test execution */
    lastVerifiedAt?: string;
    /** Last time this element was healed by AI */
    lastHealedAt?: string;
    /** Version history of selector changes */
    versionHistory?: SelectorVersion[];
    /** Per-execution verification results */
    verificationHistory?: ElementVerification[];
}

export class ObjectRepositoryService {
    private static repoPath = path.join(process.cwd(), 'local_storage', 'object-repository.json');

    /**
     * Get all elements from the repository.
     */
    static async getAll(): Promise<PageElement[]> {
        if (!fs.existsSync(this.repoPath)) {
            return [];
        }
        try {
            const data = await fsPromises.readFile(this.repoPath, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            appLogger.error('[ObjectRepo] Failed to read repository', { error: e });
            return [];
        }
    }

    /**
     * Add elements with deduplication.
     * Deduplicates by (page + selector) OR (page + elementName).
     * Updates existing entries instead of creating duplicates.
     */
    static async addElements(elements: (Omit<PageElement, 'id' | 'discoveredAt' | 'status'> & { status?: PageElement['status'] })[]): Promise<void> {
        const existing = await this.getAll();
        const newEntries: PageElement[] = elements.map(e => ({
            ...e,
            id: uuidv4(),
            status: e.status || 'suggested',
            discoveredAt: new Date().toISOString(),
        } as PageElement));

        const combined = [...existing];

        for (const entry of newEntries) {
            const index = combined.findIndex(ex => 
                (ex.page === entry.page && ex.selector === entry.selector) ||
                (ex.page === entry.page && ex.elementName.toLowerCase() === entry.elementName.toLowerCase())
            );

            if (index > -1) {
                // Update existing
                combined[index] = {
                    ...combined[index],
                    ...entry,
                    id: combined[index].id, // Keep original ID
                    discoveredAt: combined[index].discoveredAt // Keep original discovery date
                };
            } else {
                combined.push(entry);
            }
        }

        await this._save(combined);
    }

    /**
     * Update an element.
     */
    static async updateElement(id: string, updates: Partial<PageElement>): Promise<PageElement | null> {
        const all = await this.getAll();
        const index = all.findIndex(e => e.id === id);
        if (index === -1) return null;

        const el = all[index];
        
        // Track selector change
        if (updates.selector && updates.selector !== el.selector) {
            const history = el.versionHistory || [];
            history.push({
                previousSelector: el.selector,
                newSelector: updates.selector,
                changedAt: new Date().toISOString(),
                changedBy: 'system', // or userId if passed
                reason: 'API Update'
            });
            updates.versionHistory = history;
        }

        all[index] = { ...el, ...updates };
        await this._save(all);
        return all[index];
    }

    /**
     * Delete an element.
     */
    static async deleteElement(id: string): Promise<boolean> {
        const all = await this.getAll();
        const initialLength = all.length;
        const filtered = all.filter(e => e.id !== id);
        
        if (filtered.length === initialLength) return false;
        
        await this._save(filtered);
        return true;
    }

    /**
     * Get statistics about the repository.
     */
    static async getStatistics(): Promise<RepoStatistics> {
        const all = await this.getAll();
        const stats: RepoStatistics = {
            totalElements: all.length,
            byStatus: {},
            byType: {},
            verifiedCount: 0
        };

        for (const el of all) {
            stats.byStatus[el.status] = (stats.byStatus[el.status] || 0) + 1;
            stats.byType[el.type] = (stats.byType[el.type] || 0) + 1;
            if (el.status === 'verified') stats.verifiedCount++;
            
            if (el.lastVerifiedAt) {
                if (!stats.lastVerified || new Date(el.lastVerifiedAt) > new Date(stats.lastVerified)) {
                    stats.lastVerified = el.lastVerifiedAt;
                }
            }
        }

        return stats;
    }

    /**
     * Record verification result for an element.
     */
    static async recordVerification(data: { elementId: string; success: boolean; executionId?: string; failureReason?: string }): Promise<void> {
        const all = await this.getAll();
        const index = all.findIndex(e => e.id === data.elementId);
        if (index === -1) return;

        const el = all[index];
        const verification: ElementVerification = {
            timestamp: new Date().toISOString(),
            status: data.success ? 'pass' : 'fail',
            executionId: data.executionId,
            errorMessage: data.failureReason
        };

        const history = el.verificationHistory || [];
        history.push(verification);
        
        all[index] = {
            ...el,
            lastVerifiedAt: verification.timestamp,
            verificationHistory: history.slice(-50) // Keep last 50
        };

        // Auto-demote if it fails too many times? (optional)

        await this._save(all);
    }

    /**
     * Bulk import elements.
     */
    static async bulkImport(elements: any[]): Promise<void> {
        await this.addElements(elements);
    }

    /**
     * Export all elements as JSON.
     */
    static async exportAll(): Promise<string> {
        const all = await this.getAll();
        return JSON.stringify(all, null, 2);
    }

    /**
     * Search for elements by name or selector.
     */
    static async searchByName(query: string): Promise<PageElement[]> {
        const all = await this.getAll();
        const lower = query.toLowerCase();
        return all.filter(e => 
            e.elementName.toLowerCase().includes(lower) || 
            e.selector.toLowerCase().includes(lower) ||
            e.page.toLowerCase().includes(lower)
        );
    }

    /**
     * Approve a pending heal, promoting it to 'verified'.
     */
    static async approveHeal(id: string, userId: string): Promise<PageElement | null> {
        const all = await this.getAll();
        const index = all.findIndex(e => e.id === id);
        if (index === -1) return null;

        const el = all[index];
        const previousStatus = el.status;
        
        all[index] = {
            ...el,
            status: 'verified',
            lastVerifiedAt: new Date().toISOString(),
            versionHistory: [
                ...(el.versionHistory || []),
                {
                    previousSelector: el.selector,
                    newSelector: el.selector,
                    changedBy: userId,
                    changedAt: new Date().toISOString(),
                    reason: `Manual approval: ${previousStatus} -> verified`
                }
            ]
        };

        await this._save(all);
        return all[index];
    }

    /**
     * Get a single element by ID (alias for getElementById).
     */
    static async getById(id: string): Promise<PageElement | undefined> {
        return this.getElementById(id);
    }

    /**
     * Get a single element by ID.
     */
    static async getElementById(id: string): Promise<PageElement | undefined> {
        const all = await this.getAll();
        return all.find(e => e.id === id);
    }

    /**
     * Resolve an element name to a primary selector and list of fallbacks.
     * Prioritizes verified and high-confidence selectors.
     */
    static async resolveSelector(elementName: string, pageName?: string): Promise<{ primary: string; fallbacks: string[] } | null> {
        const all = await this.getAll();
        const lowerName = elementName.toLowerCase().replace(/\s+/g, ' ').trim();
        
        // Filter candidates by name (and page if provided)
        let candidates = all.filter(e => 
            e.elementName.toLowerCase().replace(/\s+/g, ' ').trim() === lowerName &&
            (!pageName || e.page === pageName)
        );

        if (candidates.length === 0) {
            // If no exact name match, try partial match in elementName
            candidates = all.filter(e => 
                e.elementName.toLowerCase().includes(lowerName) &&
                (!pageName || e.page === pageName)
            );
        }

        if (candidates.length === 0) return null;

        // Sort candidates
        candidates.sort((a, b) => {
            if (a.status === 'verified' && b.status !== 'verified') return -1;
            if (a.status !== 'verified' && b.status === 'verified') return 1;

            if (a.lastVerifiedAt && !b.lastVerifiedAt) return -1;
            if (!a.lastVerifiedAt && b.lastVerifiedAt) return 1;
            if (a.lastVerifiedAt && b.lastVerifiedAt) {
                return new Date(b.lastVerifiedAt).getTime() - new Date(a.lastVerifiedAt).getTime();
            }

            return b.confidence - a.confidence;
        });

        const best = candidates[0];
        const fallbacks = new Set<string>();
        
        if (Array.isArray(best.altSelectors)) {
            best.altSelectors.forEach((s: string) => fallbacks.add(s));
        }
        if (Array.isArray(best.selectorAlternatives)) {
            best.selectorAlternatives.forEach((s: string) => fallbacks.add(s));
        }

        candidates.slice(1).forEach(c => fallbacks.add(c.selector));

        return {
            primary: best.selector,
            fallbacks: Array.from(fallbacks).filter(s => s !== best.selector)
        };
    }

    /**
     * Find elements for a specific page.
     */
    static async getElementsByPage(pageName: string): Promise<PageElement[]> {
        const all = await this.getAll();
        return all.filter(e => e.page === pageName);
    }

    /**
     * Internal: Save elements to disk.
     */
    private static async _save(elements: PageElement[]): Promise<void> {
        const dir = path.dirname(this.repoPath);
        await fsPromises.mkdir(dir, { recursive: true });
        await fsPromises.writeFile(this.repoPath, JSON.stringify(elements, null, 2), 'utf8');
    }
}
