/**
 * MenuDiscoveryService
 *
 * Calls the GetUserLevelMenuData API after login to discover:
 * - Real menu structure (Main Menu → Sub Menu)
 * - Actual UI routes/URLs for each menu item
 * - Navigation path to reach a specific module
 *
 * This replaces guessing URLs — uses the real API response that
 * determines what menus each user level can access.
 *
 * Flow:
 * 1. Backend logs into GlobalHR via Playwright (performLogin)
 * 2. Extract auth cookies/tokens from browser context
 * 3. POST /v2_2api/api/UserLevel/GetUserLevelMenuData with those cookies
 * 4. Parse response → build menu index
 * 5. Match draft module names against menu items
 * 6. Store confirmed navigation paths in ModuleRegistry
 *
 * Can also be called with pre-existing cookies or auth headers.
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { ModuleRegistry } from '../shared/ModuleRegistry';
import { appLogger } from '../../utils/logger';

export interface MenuItem {
    menuName: string;
    menuId?: number;
    parentId?: number;
    route?: string;
    url?: string;
    controllerName?: string;
    parentMenu?: string;
    permission?: string;
    level?: number;
    sortOrder?: number;
    icon?: string;
    children?: MenuItem[];
}

export interface MenuDiscoveryResult {
    totalMenus: number;
    matchedModules: number;
    confirmedPaths: ConfirmedModulePath[];
}

export interface ConfirmedModulePath {
    ticketId: string;
    moduleName: string;
    menuName: string;
    parentMenu: string;
    fullNavigationPath: string;  // e.g., "Employee Self-Service > My Performance Journal"
    url: string;                 // e.g., "/#/app.performance-journal"
    route?: string;
}

export class MenuDiscoveryService {
    private static readonly MENU_API_PATH = '/v2_2api/api/UserLevel/GetUserLevelMenuData';
    private static readonly CACHE_PATH = path.join(__dirname, '..', 'local_storage', 'menu-discovery-cache.json');
    private static _cache: MenuItem[] | null = null;

    /**
     * Main entry: Discover menus and match against draft modules
     *
     * @param baseUrl - e.g., "https://test.globalhr.com.mm/ook"
     * @param cookies - Browser cookies after login (for session auth)
     * @returns Discovery results with confirmed module paths
     */
    static async discoverAndMatch(baseUrl: string, cookies: string): Promise<MenuDiscoveryResult> {
        appLogger.info('[MenuDiscovery] Starting menu discovery');

        // Step 1: Fetch menu data using browser cookies
        const menus = await this.fetchUserMenu(baseUrl, cookies);
        appLogger.info(`[MenuDiscovery] Fetched ${menus.length} menu items`);

        // Step 2: Get draft modules waiting for confirmation
        const drafts = ModuleRegistry.getAllDrafts();
        if (drafts.length === 0) {
            appLogger.info('[MenuDiscovery] No draft modules to match');
            return { totalMenus: menus.length, matchedModules: 0, confirmedPaths: [] };
        }

        // Step 3: Match draft modules against menu items
        const confirmedPaths = this.matchDraftsToMenus(drafts, menus);
        appLogger.info(`[MenuDiscovery] Matched ${confirmedPaths.length} draft modules to real menus`);

        // Step 4: Store confirmed paths
        for (const confirmed of confirmedPaths) {
            ModuleRegistry.confirmFromDiscovery({
                ticketId: confirmed.ticketId,
                moduleName: confirmed.moduleName,
                menuName: confirmed.menuName,
                parentMenu: confirmed.parentMenu,
                uiRoute: confirmed.url,
                fullNavigationPath: confirmed.fullNavigationPath,
            });
        }

        return {
            totalMenus: menus.length,
            matchedModules: confirmedPaths.length,
            confirmedPaths,
        };
    }

    /**
     * Fetch user menu data from the API using browser cookies
     */
    private static async fetchUserMenu(baseUrl: string, cookies: string): Promise<MenuItem[]> {
        // Check cache first
        if (this._cache) return this._cache;

        const cacheData = this.loadCache();
        if (cacheData && cacheData.length > 0) {
            appLogger.info('[MenuDiscovery] Using cached menu data');
            this._cache = cacheData;
            return cacheData;
        }

        try {
            const url = baseUrl.replace(/\/+$/, '') + this.MENU_API_PATH;
            appLogger.info('[MenuDiscovery] Fetching menu data', { url });

            // Parse cookies into header format
            const cookieHeader = cookies.split(';').map(c => c.trim()).join('; ');

            const response = await axios.post(url, {}, {
                headers: {
                    'Cookie': cookieHeader,
                    'Content-Type': 'application/json',
                },
                timeout: 30000,
            });

            const menuData = this.parseMenuResponse(response.data);
            this._cache = menuData;
            this.saveCache(menuData);

            return menuData;
        } catch (error: any) {
            appLogger.error('[MenuDiscovery] Failed to fetch menu data', {
                error: error.message,
                status: error.response?.status,
            });
            return [];
        }
    }

    /**
     * Fetch menu data with explicit auth headers (alternative method)
     */
    static async discoverWithAuthHeaders(baseUrl: string, authHeaders: Record<string, string>): Promise<MenuDiscoveryResult> {
        appLogger.info('[MenuDiscovery] Starting menu discovery (auth headers)');

        if (this._cache) {
            const menus = this._cache;
            const drafts = ModuleRegistry.getAllDrafts();
            if (drafts.length === 0) {
                return { totalMenus: menus.length, matchedModules: 0, confirmedPaths: [] };
            }
            const confirmedPaths = this.matchDraftsToMenus(drafts, menus);
            for (const confirmed of confirmedPaths) {
                ModuleRegistry.confirmFromDiscovery({
                    ticketId: confirmed.ticketId,
                    moduleName: confirmed.moduleName,
                    menuName: confirmed.menuName,
                    parentMenu: confirmed.parentMenu,
                    uiRoute: confirmed.url,
                    fullNavigationPath: confirmed.fullNavigationPath,
                });
            }
            return { totalMenus: menus.length, matchedModules: confirmedPaths.length, confirmedPaths };
        }

        const cacheData = this.loadCache();
        if (cacheData && cacheData.length > 0) {
            this._cache = cacheData;
            return this.discoverWithAuthHeaders(baseUrl, authHeaders);
        }

        try {
            const url = baseUrl.replace(/\/+$/, '') + this.MENU_API_PATH;
            appLogger.info('[MenuDiscovery] Fetching menu data', { url });

            const response = await axios.post(url, {}, {
                headers: {
                    ...authHeaders,
                    'Content-Type': 'application/json',
                },
                timeout: 30000,
            });

            const menuData = this.parseMenuResponse(response.data);
            this._cache = menuData;
            this.saveCache(menuData);

            const drafts = ModuleRegistry.getAllDrafts();
            if (drafts.length === 0) {
                return { totalMenus: menuData.length, matchedModules: 0, confirmedPaths: [] };
            }

            const confirmedPaths = this.matchDraftsToMenus(drafts, menuData);
            for (const confirmed of confirmedPaths) {
                ModuleRegistry.confirmFromDiscovery({
                    ticketId: confirmed.ticketId,
                    moduleName: confirmed.moduleName,
                    menuName: confirmed.menuName,
                    parentMenu: confirmed.parentMenu,
                    uiRoute: confirmed.url,
                    fullNavigationPath: confirmed.fullNavigationPath,
                });
            }

            return { totalMenus: menuData.length, matchedModules: confirmedPaths.length, confirmedPaths };
        } catch (error: any) {
            appLogger.error('[MenuDiscovery] Failed to fetch menu data', {
                error: error.message,
                status: error.response?.status,
            });
            return { totalMenus: 0, matchedModules: 0, confirmedPaths: [] };
        }
    }

    /**
     * Parse the GetUserLevelMenuData API response
     * Structure:
     * - MainMenu: ParentID=0, ControllerName="#" (no route)
     * - SubMenu: ParentID=38, ControllerName="app.grade" → route: /#/app.grade
     */
    private static parseMenuResponse(data: any): MenuItem[] {
        const rawArray = Array.isArray(data) ? data :
                        data?.data ?? data?.result ?? data?.menus ?? [];

        if (!Array.isArray(rawArray)) {
            appLogger.warn('[MenuDiscovery] Unexpected menu response format');
            return [];
        }

        // Build lookup map for parent menu names
        const menuById = new Map<number, { name: string; controller: string }>();
        for (const item of rawArray) {
            const id = item.MenuID ?? item.menuId ?? 0;
            menuById.set(id, {
                name: item.MenuName || item.menuName || item.Name || 'Unknown',
                controller: item.ControllerName || item.controllerName || '#',
            });
        }

        // Flatten with parent resolution
        const result: MenuItem[] = [];
        for (const item of rawArray) {
            const menuName = item.MenuName || item.menuName || item.Name || 'Unknown';
            const controllerName = item.ControllerName || item.controllerName || '#';
            const parentId = item.ParentID ?? item.parentId ?? 0;
            const menuId = item.MenuID ?? item.menuId ?? 0;

            // Route comes from ControllerName (if not "#")
            // Format: #/app.grade (NO leading slash — app URL is domain/ook#/route)
            const route = controllerName !== '#' && controllerName ? `#/${controllerName}` : undefined;

            // Find parent menu name
            const parentInfo = parentId !== 0 ? menuById.get(parentId) : undefined;

            result.push({
                menuName,
                menuId,
                parentId,
                route,
                url: route, // Alias
                controllerName,
                parentMenu: parentInfo?.name,
                permission: item.Permission || '',
            });
        }

        return result;
    }

    /**
     * Match draft module names against fetched menu items
     */
    private static matchDraftsToMenus(
        drafts: Array<{ ticketId: string; moduleName: string; menuName?: string; requirements?: string[] }>,
        menus: MenuItem[]
    ): ConfirmedModulePath[] {
        const confirmed: ConfirmedModulePath[] = [];

        for (const draft of drafts) {
            const match = this.findMenuMatch(draft.moduleName, draft.menuName, menus);
            if (match) {
                confirmed.push({
                    ticketId: draft.ticketId,
                    moduleName: draft.moduleName,
                    menuName: match.menuName,
                    parentMenu: match.parentMenu || 'Unknown',
                    fullNavigationPath: match.parentMenu ? `${match.parentMenu} > ${match.menuName}` : match.menuName,
                    url: this.normalizeUrl(match.url || match.route),
                    route: match.route,
                });
                appLogger.info('[MenuDiscovery] Matched draft to menu', {
                    draft: draft.moduleName,
                    matched: match.menuName,
                    parent: match.parentMenu,
                    url: match.url || match.route,
                });
            } else {
                appLogger.warn('[MenuDiscovery] No menu match for draft', { draft: draft.moduleName });
            }
        }

        return confirmed;
    }

    /**
     * Find best matching menu item for a draft module
     * Uses fuzzy matching: module name, menu name, keywords
     */
    private static findMenuMatch(moduleName: string, menuName: string | undefined, menus: MenuItem[]): MenuItem | null {
        const searchTerms: string[] = [
            moduleName.toLowerCase(),
            ...(menuName ? [menuName.toLowerCase()] : []),
            // Extract keywords from module name
            ...moduleName.split(/[\s\-_]+/).map(w => w.toLowerCase()).filter(w => w.length > 3),
        ];

        let bestMatch: MenuItem | null = null;
        let bestScore = 0;

        for (const menu of menus) {
            const menuText = `${menu.menuName} ${menu.parentMenu || ''} ${menu.route || ''} ${menu.url || ''}`.toLowerCase();
            let score = 0;

            for (const term of searchTerms) {
                if (menuText.includes(term)) {
                    // Score based on specificity
                    if (term.length > 5) score += 3;
                    else if (term.length > 3) score += 2;
                    else score += 1;
                }
            }

            // Bonus for exact menu name match
            if (menuName && menu.menuName.toLowerCase() === menuName.toLowerCase()) {
                score += 10;
            }

            if (score > bestScore) {
                bestScore = score;
                bestMatch = menu;
            }
        }

        // Require minimum confidence
        return bestScore >= 3 ? bestMatch : null;
    }

    /**
     * Normalize URL to Playwright-compatible format
     */
    private static normalizeUrl(raw?: string): string {
        if (!raw) return '';

        // Already has hash route
        if (raw.includes('#/')) return raw;

        // Route without hash
        if (raw.startsWith('/')) return raw;

        // Add hash prefix
        return `/#/${raw.replace(/^\/+/, '')}`;
    }

    /**
     * Load cached menu data
     */
    private static loadCache(): MenuItem[] | null {
        try {
            if (fs.existsSync(this.CACHE_PATH)) {
                const raw = fs.readFileSync(this.CACHE_PATH, 'utf8');
                const data = JSON.parse(raw);
                // Invalidate cache after 24 hours
                if (data.fetchedAt && Date.now() - new Date(data.fetchedAt).getTime() < 24 * 60 * 60 * 1000) {
                    return data.menus;
                }
            }
        } catch {
            // Ignore cache errors
        }
        return null;
    }

    /**
     * Save menu data to cache
     */
    private static saveCache(menus: MenuItem[]): void {
        try {
            const dir = path.dirname(this.CACHE_PATH);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.CACHE_PATH, JSON.stringify({
                fetchedAt: new Date().toISOString(),
                menus,
            }, null, 2), 'utf8');
        } catch (error: any) {
            appLogger.warn('[MenuDiscovery] Failed to save menu cache', { error: error.message });
        }
    }

    /**
     * Clear in-memory cache (for testing)
     */
    static clearCache(): void {
        this._cache = null;
        try {
            if (fs.existsSync(this.CACHE_PATH)) {
                fs.unlinkSync(this.CACHE_PATH);
            }
        } catch {
            // Ignore
        }
    }
}
