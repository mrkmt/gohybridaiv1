/**
 * ModuleRegistry
 *
 * Stores and resolves module mappings from Jira tickets.
 * Two types of modules:
 * 1. **Draft**: Extracted from dev tickets (APIs, routes, component names)
 * 2. **Confirmed**: Verified by live browser discovery
 *
 * Flow:
 * - Testing ticket → extract draft module from linked dev tickets
 * - Live discovery → confirms actual URL/navigation
 * - Store confirmed mapping for future use
 */

import * as fs from 'fs';
import * as path from 'path';
import { appLogger } from '../../utils/logger';

export interface ModuleInfo {
    ticketId: string;
    moduleName: string;
    menuName?: string;
    uiRoute?: string;       // e.g., "/#/app.performance-journal"
    apiRoute?: string;      // e.g., "/api/journal-entry"
    confirmed: boolean;     // true if verified by live discovery
    confirmedAt?: string;   // ISO timestamp
    source: string;         // "dev-ticket" | "live-discovery"
    requirements?: string[]; // extracted features/requirements from dev tickets
    parentMenu?: string;    // e.g., "Employee Self-Service"
    fullNavigationPath?: string; // e.g., "Employee Self-Service > My Performance Journal"
}

export interface ModuleRegistryData {
    modules: ModuleInfo[];
}

const REGISTRY_PATH = path.join(__dirname, '..', '..', '..', 'local_storage', 'module-registry.json');

export class ModuleRegistry {
    private static _cache: ModuleRegistryData | null = null;

    /**
     * Load registry from disk (with caching)
     */
    private static load(): ModuleRegistryData {
        if (this._cache) return this._cache;

        try {
            if (fs.existsSync(REGISTRY_PATH)) {
                this._cache = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
            } else {
                this._cache = { modules: [] };
            }
        } catch (err) {
            appLogger.warn('[ModuleRegistry] Failed to load registry, using empty', { error: (err as Error).message });
            this._cache = { modules: [] };
        }

        return this._cache!;
    }

    /**
     * Save registry to disk and invalidate cache
     */
    private static save(): void {
        try {
            const dir = path.dirname(REGISTRY_PATH);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(REGISTRY_PATH, JSON.stringify(this._cache, null, 2), 'utf8');
            appLogger.info('[ModuleRegistry] Saved', { count: this._cache?.modules.length || 0 });
        } catch (err) {
            appLogger.error('[ModuleRegistry] Failed to save', { error: (err as Error).message });
        }
    }

    /**
     * Store a draft module extracted from dev tickets
     */
    static storeDraft(ticketId: string, info: { moduleName: string; menuName?: string; uiRoute?: string; apiRoute?: string; requirements?: string[] }): void {
        const registry = this.load();

        // Check if already exists for this ticket
        const existing = registry.modules.find(m => m.ticketId === ticketId);
        if (existing) {
            appLogger.info('[ModuleRegistry] Updating draft for ' + ticketId, { module: info.moduleName });
            existing.moduleName = info.moduleName;
            existing.menuName = info.menuName;
            if (info.apiRoute) existing.apiRoute = info.apiRoute;
            existing.requirements = info.requirements;
            // Don't overwrite confirmed uiRoute from live discovery with draft guess
            if (!existing.confirmed) {
                existing.uiRoute = info.uiRoute;
            }
            existing.source = 'dev-ticket';
        } else {
            registry.modules.push({
                ticketId,
                moduleName: info.moduleName,
                menuName: info.menuName,
                uiRoute: info.uiRoute,
                apiRoute: info.apiRoute,
                requirements: info.requirements,
                confirmed: false,
                source: 'dev-ticket',
            });
        }

        this._cache = registry;
        this.save();
    }

    /**
     * Confirm a module after live discovery
     */
    static confirmModule(ticketId: string, confirmedInfo: { moduleName: string; menuName: string; uiRoute: string }): void {
        const registry = this.load();

        const existing = registry.modules.find(m => m.ticketId === ticketId);
        if (existing) {
            existing.confirmed = true;
            existing.confirmedAt = new Date().toISOString();
            existing.moduleName = confirmedInfo.moduleName;
            existing.menuName = confirmedInfo.menuName;
            existing.uiRoute = confirmedInfo.uiRoute;
            existing.source = 'live-discovery';
        } else {
            registry.modules.push({
                ticketId,
                moduleName: confirmedInfo.moduleName,
                menuName: confirmedInfo.menuName,
                uiRoute: confirmedInfo.uiRoute,
                confirmed: true,
                confirmedAt: new Date().toISOString(),
                source: 'live-discovery',
            });
        }

        this._cache = registry;
        this.save();
        appLogger.info('[ModuleRegistry] Confirmed module for ' + ticketId, { module: confirmedInfo.moduleName, route: confirmedInfo.uiRoute });
    }

    /**
     * Get all draft modules waiting for confirmation
     */
    static getAllDrafts(): Array<{ ticketId: string; moduleName: string; menuName?: string; requirements?: string[] }> {
        const registry = this.load();
        return registry.modules
            .filter(m => !m.confirmed)
            .map(m => ({
                ticketId: m.ticketId,
                moduleName: m.moduleName,
                menuName: m.menuName,
                requirements: m.requirements,
            }));
    }

    /**
     * Confirm a module from menu discovery results
     */
    static confirmFromDiscovery(info: {
        ticketId: string;
        moduleName: string;
        menuName: string;
        parentMenu: string;
        uiRoute: string;
        fullNavigationPath: string;
    }): void {
        const registry = this.load();

        const existing = registry.modules.find(m => m.ticketId === info.ticketId);
        if (existing) {
            existing.confirmed = true;
            existing.confirmedAt = new Date().toISOString();
            existing.parentMenu = info.parentMenu;
            existing.fullNavigationPath = info.fullNavigationPath;
            existing.uiRoute = info.uiRoute;
            existing.source = 'live-discovery';
        } else {
            registry.modules.push({
                ticketId: info.ticketId,
                moduleName: info.moduleName,
                menuName: info.menuName,
                parentMenu: info.parentMenu,
                fullNavigationPath: info.fullNavigationPath,
                uiRoute: info.uiRoute,
                confirmed: true,
                confirmedAt: new Date().toISOString(),
                source: 'live-discovery',
            });
        }

        this._cache = registry;
        this.save();
        appLogger.info('[ModuleRegistry] Confirmed from discovery', {
            ticket: info.ticketId,
            module: info.moduleName,
            path: info.fullNavigationPath,
        });
    }

    /**
     * Resolve module for a ticket (confirmed preferred, then draft)
     */
    static resolve(ticketId: string): ModuleInfo | null {
        const registry = this.load();
        return registry.modules.find(m => m.ticketId === ticketId) || null;
    }

    /**
     * Find module by similar name or route (for tickets without direct mapping)
     */
    static findSimilar(keyword: string): ModuleInfo[] {
        const registry = this.load();
        const lower = keyword.toLowerCase();

        return registry.modules.filter(m =>
            m.moduleName.toLowerCase().includes(lower) ||
            (m.uiRoute && m.uiRoute.toLowerCase().includes(lower)) ||
            (m.apiRoute && m.apiRoute.toLowerCase().includes(lower))
        );
    }

    /**
     * Get all confirmed modules
     */
    static getAllConfirmed(): ModuleInfo[] {
        const registry = this.load();
        return registry.modules.filter(m => m.confirmed);
    }

    /**
     * Clear cache (for testing)
     */
    static clearCache(): void {
        this._cache = null;
    }
}
