/**
 * DiscoveryCacheService
 *
 * Stores and queries cached page discovery results.
 * Prevents redundant browser launches: discovery runs once per module,
 * and cached results are reused for all tickets targeting that module.
 *
 * IMPROVED:
 * 1. Directory creation with { recursive: true }
 * 2. Robust module name normalization with alias map
 * 3. Consistent normalization in get() and save()
 * 4. Env-aware cache directory (LOCAL_STORAGE_PATH)
 */

import * as fs from 'fs';
import * as path from 'path';
import { PageInventory } from './PageElementDiscoveryService';
import { UniversalPageModel, UniversalPageModelService } from '../UniversalPageModelService';
import { appLogger } from '../../utils/logger';

export interface CachedDiscovery {
    moduleName: string;
    hashRoute: string;
    inventory: PageInventory;
    discoveredAt: string;
    usedByTickets: string[];
    version: number;
}

export class DiscoveryCacheService {
    private static TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

    private static readonly MODULE_ALIASES: Record<string, string> = {
        // HR Setup
        designation: 'Designation', designations: 'Designation',
        department: 'Department', departments: 'Department',
        grade: 'Grade', grades: 'Grade',
        section: 'Section', division: 'Division',
        group: 'Group', 'cost center': 'Cost Center', costcenter: 'Cost Center',
        location: 'Location', company: 'Company Profile', 'company profile': 'Company Profile',
        team: 'Team Setup', teamsetup: 'Team Setup', 'team setup': 'Team Setup',
        label: 'Label Setup', labelsetup: 'Label Setup', 'label setup': 'Label Setup',
        keyword: 'Keyword', keywords: 'Keyword',
        holiday: 'Public Holiday', 'public holiday': 'Public Holiday',
        gps: 'GPS Location', 'gps location': 'GPS Location',
        shift: 'Shift', 'alternative work day': 'Alternative Work Day',

        // Employee
        employee: 'Employee', employees: 'Employee',
        'bank info': 'Bank Info', bankinfo: 'Bank Info',
        transfer: 'Transfer',
        'contract employee': 'Contract Employee', contractemployee: 'Contract Employee',
        'employee policy': 'Employee Policy', employeepolicy: 'Employee Policy',

        // Leave
        leavetype: 'Leave Type', 'leave type': 'Leave Type',
        leavepolicy: 'Leave Policy', 'leave policy': 'Leave Policy',
        'group policy': 'Group Policy', grouppolicy: 'Group Policy',
        'leave request': 'Leave Request', leaverequest: 'Leave Request',
        'leave approve': 'Leave Approve', leaveapprove: 'Leave Approve',
        'generate leave': 'Generate Leave',
        'opening leave balance': 'Opening Leave Balance', 'openingleavebalance': 'Opening Leave Balance',
        'leave balance report': 'Leave Balance Report', 'leave balance': 'Leave Balance Report',
        'balance report': 'Leave Balance Report',

        // Attendance
        time: 'Time Attendance', 'time attendance': 'Time Attendance', myattendance: 'Time Attendance',
        'attendance rule': 'Attendance Rule',
        'attendance request': 'Attendance Request',
        'attendance approve': 'Attendance Approve',
        'attendance editor': 'Attendance Editor',
        'attendance calculate': 'Attendance Calculate',
        'manual attendance': 'Manual Attendance',
        'duty roster': 'Duty Roster', dutyroster: 'Duty Roster',
        'ot request': 'OT Request', otrequest: 'OT Request',
        'ot approve': 'OT Approve',

        // Payroll
        'payment title': 'Payment Title', paymenttitle: 'Payment Title',
        'payment definition': 'Payment Definition',
        'payroll rule': 'Payroll Rule', payrollrule: 'Payroll Rule',
        'salary scale': 'Salary Scale', salaryscale: 'Salary Scale',
        'salary adjustment': 'Salary Adjustment',
        'addition & deduction': 'Addition & Deduction', 'addition deduction': 'Addition & Deduction',
        'payment calculation': 'Payment Calculation',
        'payment approve': 'Payment Approve',
        'loan advance saving': 'Loan Advance Saving',

        // Appraisal
        appraisal: 'Appraisal Dashboard', 'appraisal cycles': 'Appraisal Cycles',
        'appraisal templates': 'Appraisal Templates', 'appraisal status': 'Appraisal Status',
        kpi: 'KPI Metric', 'kpi metric': 'KPI Metric',

        // User & Access
        'user level': 'User Level', userlevel: 'User Level',
        'user level assignment': 'User Level Assignment',
        menu: 'Menu Permission', 'menu permission': 'Menu Permission',
        'approver setting': 'Approver Setting', 'approver assign': 'Approver Assign',

        // Reports & Other
        performance: 'Performance Journal', journal: 'Performance Journal',
        'performance journal': 'Performance Journal', 'my performance journal': 'Performance Journal',
        announcement: 'Announcement',
        'custom field': 'Custom Field', customfield: 'Custom Field',
    };

    private static getCacheDir(): string {
        const base = process.env.LOCAL_STORAGE_PATH
            ? path.resolve(process.env.LOCAL_STORAGE_PATH)
            : path.join(__dirname, '..', '..', '..', 'local_storage');
        return path.join(base, 'discovery', 'cache');
    }

    private static ensureCacheDir(): void {
        const dir = this.getCacheDir();
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    private static getCacheFilePath(moduleName: string): string {
        const canonical = this.normalizeModuleName(moduleName);
        const safeName = canonical.replace(/[^a-zA-Z0-9-]/g, '_').toLowerCase();
        return path.join(this.getCacheDir(), `${safeName}.json`);
    }

    /**
     * Scan free-text (usually a Jira summary) and return the canonical module
     * name if any known alias appears. Longest-match wins so "Performance
     * Journal" beats "Journal". Returns null if nothing matches.
     *
     * Used by TestingJiraService to derive ticket.module from the summary
     * instead of the naive `summary.split(' ')[0]` which produced garbage
     * like "My" / "Test" for tickets titled "My performance journal..." or
     * "Test Bug: Department...".
     */
    static detectModuleFromText(text: string): string | null {
        if (!text) return null;
        const lower = text.toLowerCase();

        // Longest keys first so multi-word aliases win over single-word ones.
        const keys = Object.keys(this.MODULE_ALIASES).sort((a, b) => b.length - a.length);
        for (const key of keys) {
            // Word-boundary match so "team" doesn't match "teammate".
            const pattern = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i');
            if (pattern.test(lower)) {
                return this.MODULE_ALIASES[key];
            }
        }
        return null;
    }

    static normalizeModuleName(moduleName: string): string {
        const cleaned = (moduleName || '').trim();
        if (!cleaned) return 'unknown';

        const normalizedKey = cleaned.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
        const aliasHit = this.MODULE_ALIASES[normalizedKey];
        if (aliasHit) return aliasHit;

        const squashedKey = normalizedKey.replace(/\s+/g, '');
        const squashedHit = this.MODULE_ALIASES[squashedKey];
        if (squashedHit) return squashedHit;

        return cleaned;
    }

    static get(moduleName: string): CachedDiscovery | null {
        this.ensureCacheDir();
        const cacheFile = this.getCacheFilePath(moduleName);

        if (!fs.existsSync(cacheFile)) return null;

        try {
            const cache: CachedDiscovery = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
            const age = Date.now() - new Date(cache.discoveredAt).getTime();

            if (age > this.TTL_MS) {
                try { fs.unlinkSync(cacheFile); } catch {}
                return null;
            }

            // Check for permission flags and warn
            if (cache.inventory?.permissionFlags && cache.inventory.permissionFlags.length > 0) {
                const addFlag = cache.inventory.permissionFlags.find(f => f.action === 'ADD');
                if (addFlag) {
                    appLogger.warn(`[DiscoveryCache] Cache has permission flag for ADD on ${moduleName}: ${addFlag.reason}`);
                }
                const deleteFlag = cache.inventory.permissionFlags.find(f => f.action === 'DELETE');
                if (deleteFlag) {
                    appLogger.warn(`[DiscoveryCache] Cache has permission flag for DELETE on ${moduleName}: ${deleteFlag.reason}`);
                }
            }

            return cache;
        } catch {
            try { fs.unlinkSync(cacheFile); } catch {}
            return null;
        }
    }

    static save(inventory: PageInventory, hashRoute: string, ticketId?: string, moduleNameOverride?: string): CachedDiscovery {
        this.ensureCacheDir();
        const raw = moduleNameOverride || inventory.pageTitle || 'unknown';
        const moduleName = this.normalizeModuleName(raw);
        const cacheFile = this.getCacheFilePath(moduleName);

        const existing = this.get(moduleName);
        const version = existing ? existing.version + 1 : 1;

        const cache: CachedDiscovery = {
            moduleName,
            hashRoute,
            inventory,
            discoveredAt: new Date().toISOString(),
            usedByTickets: existing
                ? [...new Set([...existing.usedByTickets, ...(ticketId ? [ticketId] : [])])]
                : ticketId ? [ticketId] : [],
            version,
        };

        fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), 'utf-8');
        appLogger.info(`[DiscoveryCache] Cached ${moduleName} v${version}`);
        return cache;
    }

    static isFresh(moduleName: string): boolean {
        return this.get(moduleName) !== null;
    }

    static getPageModel(moduleName: string): UniversalPageModel | null {
        const cache = this.get(moduleName);
        if (!cache) return null;
        return UniversalPageModelService.build(cache.inventory);
    }

    private static buildSkillSelectorsSection(moduleName: string): string {
        const lines: string[] = [];
        try {
            const skillPath = path.join(process.cwd(), 'skills', 'GlobalHR', 'forms', `${moduleName.toLowerCase().replace(/\s+/g, '-')}.json`);
            if (!fs.existsSync(skillPath)) return '';
            const skill = JSON.parse(fs.readFileSync(skillPath, 'utf8'));
            if (!skill.stableSelectors || Object.keys(skill.stableSelectors).length === 0) return '';

            lines.push(`\n## Known Stable Selectors (from skill file — USE THESE FIRST)`);
            lines.push(`For the "${moduleName}" module, these selectors are proven to work:`);
            for (const [field, selectors] of Object.entries(skill.stableSelectors)) {
                const list = (selectors as string[]).map(s => `"${s}"`).join(', ');
                lines.push(`- ${field}: ${list}`);
            }
        } catch {
            // Non-fatal
        }
        return lines.join('\n');
    }

    static getPromptContext(moduleName: string, limit: number = 12): string | null {
        const cache = this.get(moduleName);
        if (!cache) return null;

        const pageModel = UniversalPageModelService.build(cache.inventory);
        if (!pageModel) return null;

        const lines: string[] = [];

        // S4-2: Permission constraints (CRITICAL for avoiding hallucinations)
        if (cache.inventory.permissionFlags && cache.inventory.permissionFlags.length > 0) {
            lines.push(`## Account Permission Limitations`);
            lines.push(`The following actions are NOT available for the current test account:`);
            for (const flag of cache.inventory.permissionFlags) {
                if (flag.likelyMissing) {
                    lines.push(`- [DISABLED] ${flag.action}: ${flag.reason}`);
                }
            }
            lines.push(`Constraint: You MUST NOT generate any test steps or scenarios that require these disabled actions.\n`);
        }

        lines.push(`## Frontend Technology Profile`);
        lines.push(`Primary: ${pageModel.technologies.primary}`);

        lines.push(`\n## Normalized Actionable Elements`);
        lines.push(
            `Each row can carry: \`required\` (fill before submit), \`role=submit|cancel|destructive|nav|search|control\`, ` +
            `\`triggers=modal|dropdown|navigation|submit\`, and \`state=<key>\`. ` +
            `Rules: fill every \`required\` field before clicking a \`role=submit\`; never click \`role=destructive\` in a happy-path scenario; ` +
            `only reference an element in a scenario that actually reaches its \`state=\`.`
        );
        const sorted = [...pageModel.elements].sort((a, b) => (b.confidence ?? 0.7) - (a.confidence ?? 0.7));
        for (const el of sorted.slice(0, limit)) {
            const confidence = (el.confidence ?? 0.7);
            const alternatives = (el.selectorAlternatives ?? [el.selector, ...(el.altSelectors || [])])
                .filter(Boolean)
                .slice(0, 3);

            // Format alternatives with backticks
            const altsString = alternatives.map(s => `"${s}"`).join(', ');
            const stateTag = el.stateKey ? ` | state=${el.stateKey}` : '';
            // S4-2: render semantic tags only when set — cold inventories skip these.
            const semanticTags: string[] = [];
            if (el.required === true) semanticTags.push('required');
            if (el.role && el.role !== 'other') semanticTags.push(`role=${el.role}`);
            if (el.triggers && el.triggers !== 'none') semanticTags.push(`triggers=${el.triggers}`);
            const semanticTag = semanticTags.length > 0 ? ` | ${semanticTags.join(' | ')}` : '';

            lines.push(
                `- ${el.name} [${el.type}] -> ${el.selector} | conf=${confidence.toFixed(2)} | alts=${altsString} | strategy=${el.interaction.kind} | framework=${el.interaction.framework}${semanticTag}${stateTag}`
            );

        }

        lines.push(this.buildSkillSelectorsSection(moduleName));

        return lines.join('\n');
    }

    static getStatus(moduleName: string): { 
        fresh: boolean; 
        discoveredAt?: string;
        age?: string;
        version?: number;
        elementCount?: number;
    } {
        const cache = this.get(moduleName);
        if (!cache) return { fresh: false };

        const discoveredAt = new Date(cache.discoveredAt).getTime();
        const ageMs = Date.now() - discoveredAt;
        const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
        const ageMinutes = Math.floor((ageMs % (1000 * 60 * 60)) / (1000 * 60));
        
        const inventory = cache.inventory;
        const elementCount = 
            (inventory.buttons?.length || 0) + 
            (inventory.inputs?.length || 0) + 
            (inventory.dropdowns?.length || 0) +
            (inventory.grids?.length || 0) +
            (inventory.tabs?.length || 0) +
            (inventory.modals?.length || 0) +
            (inventory.checkboxes?.length || 0) +
            (inventory.radios?.length || 0) +
            (inventory.menus?.length || 0);

        return {
            fresh: true,
            discoveredAt: cache.discoveredAt,
            age: `${ageHours}h ${ageMinutes}m`,
            version: cache.version,
            elementCount
        };
    }

    static getSeededPromptContext(moduleName: string): string | null {
        return [
            `## Frontend Technology Profile`,
            `Primary: Angular 19 + Zone.js`,
            `- Kendo UI (100%): .k-grid, .k-popup, .k-dialog, .k-button`,
            ``,
            `## Normalized Actionable Elements (common GlobalHR patterns)`,
            `- Add New button [icon-button] -> button[title="Add New"], .k-button.k-button-icontext .k-icon | strategy=click | framework=kendo-ui`,
            `- Save button [button] -> button:has-text("Save"), [title="Save"] | strategy=click | framework=kendo-ui`,
            `- Grid [data-grid] -> .k-grid, kendo-grid | strategy=grid-action | framework=kendo-ui`,
        ].join('\n');
    }

    static lookupSelector(elementName: string): { selector: string; moduleName: string } | null {
        const target = elementName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const dir = this.getCacheDir();
        if (!fs.existsSync(dir)) return null;

        const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
        for (const file of files) {
            try {
                const cache: CachedDiscovery = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
                for (const btn of cache.inventory.buttons) {
                    if (btn.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(target)) return { selector: btn.selector, moduleName: cache.moduleName };
                }
                for (const inp of cache.inventory.inputs) {
                    if (inp.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(target)) return { selector: inp.selector, moduleName: cache.moduleName };
                }
            } catch { continue; }
        }
        return null;
    }

    static lookupElementDefinition(elementName: string, moduleName?: string): any | null {
        const target = elementName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const modules = moduleName ? [this.normalizeModuleName(moduleName)] : []; // simplified for now
        
        for (const mod of modules) {
            const pageModel = this.getPageModel(mod);
            if (!pageModel) continue;
            for (const el of pageModel.elements) {
                if (el.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(target)) {
                    return {
                        selector: el.selector,
                        moduleName: mod,
                        type: el.type,
                        strategyKind: el.interaction.kind,
                        framework: el.interaction.framework,
                        stateKey: el.stateKey,
                    };
                }
            }
        }
        return null;
    }

    static getElementSelectorMap(moduleName: string): Map<string, string> {
        const cache = this.get(moduleName);
        const map = new Map<string, string>();
        if (!cache) return map;

        for (const btn of cache.inventory.buttons) map.set(btn.name, btn.selector);
        for (const inp of cache.inventory.inputs) map.set(inp.name, inp.selector);
        for (const dd of cache.inventory.dropdowns) map.set(dd.name, dd.selector);
        return map;
    }

    static listAll(): any[] {
        const dir = this.getCacheDir();
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => ({
            moduleName: f.replace('.json', ''),
            status: { fresh: true }
        }));
    }

    static getCacheStats(): any {
        return { hits: {}, misses: {} };
    }
}


