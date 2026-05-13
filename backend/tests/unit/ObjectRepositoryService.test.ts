/**
 * ObjectRepositoryService — Unit Tests
 *
 * Tests for the centralized UI element selector repository.
 * Covers: CRUD, search, fallback resolution, verification, versioning.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    ObjectRepositoryService,
    PageElement,
    SelectorVersion,
    ElementVerification,
} from '../../src/services/ObjectRepositoryService';

// Test fixture path — isolated from production data
const TEST_REPO_PATH = path.join(process.cwd(), 'test-fixtures', 'test-object-repo.json');

describe('ObjectRepositoryService', () => {
    // Clean up test fixture before each test
    beforeEach(() => {
        const dir = path.dirname(TEST_REPO_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (fs.existsSync(TEST_REPO_PATH)) {
            fs.unlinkSync(TEST_REPO_PATH);
        }
        // Reset the service's repo path to test fixture
        (ObjectRepositoryService as any).repoPath = TEST_REPO_PATH;
    });

    afterEach(() => {
        if (fs.existsSync(TEST_REPO_PATH)) {
            fs.unlinkSync(TEST_REPO_PATH);
        }
    });

    // ─── CRUD Tests ─────────────────────────────────────────────

    describe('addElements', () => {
        it('adds new elements to empty repository', async () => {
            const elements = [
                {
                    page: 'login',
                    section: 'form',
                    elementName: 'username',
                    selector: 'input[name="username"]',
                    altSelectors: ['input[placeholder*="username"]'],
                    type: 'input' as const,
                    confidence: 0.9,
                    relatedModule: 'auth',
                },
            ];

            await ObjectRepositoryService.addElements(elements);
            const all = await ObjectRepositoryService.getAll();

            expect(all).toHaveLength(1);
            expect(all[0].elementName).toBe('username');
            expect(all[0].id).toBeDefined();
            expect(all[0].discoveredAt).toBeDefined();
        });

        it('deduplicates by page + selector — updates existing', async () => {
            const v1 = [
                {
                    page: 'login',
                    elementName: 'username',
                    selector: 'input[name="username"]',
                    type: 'input' as const,
                    confidence: 0.7,
                },
            ];
            await ObjectRepositoryService.addElements(v1);

            const v2 = [
                {
                    page: 'login',
                    elementName: 'username',
                    selector: 'input[name="username"]',
                    type: 'input' as const,
                    confidence: 0.95,
                    businessLogicHint: 'employee login field',
                },
            ];
            await ObjectRepositoryService.addElements(v2);

            const all = await ObjectRepositoryService.getAll();
            expect(all).toHaveLength(1);
            expect(all[0].confidence).toBe(0.95);
            expect(all[0].businessLogicHint).toBe('employee login field');
        });

        it('deduplicates by page + elementName — updates existing', async () => {
            const v1 = [
                {
                    page: 'dashboard',
                    elementName: 'save button',
                    selector: 'button:has-text("Save")',
                    type: 'button' as const,
                    confidence: 0.8,
                },
            ];
            await ObjectRepositoryService.addElements(v1);

            const v2 = [
                {
                    page: 'dashboard',
                    elementName: 'save button',
                    selector: 'button[title="Save"], .k-button:has-text("Save")',
                    type: 'button' as const,
                    confidence: 0.95,
                },
            ];
            await ObjectRepositoryService.addElements(v2);

            const all = await ObjectRepositoryService.getAll();
            expect(all).toHaveLength(1);
            expect(all[0].selector).toContain('button[title="Save"]');
        });

        it('preserves existing ID when updating', async () => {
            const v1 = [
                {
                    page: 'login',
                    elementName: 'password',
                    selector: 'input[type="password"]',
                    type: 'input' as const,
                    confidence: 0.8,
                },
            ];
            await ObjectRepositoryService.addElements(v1);
            const original = (await ObjectRepositoryService.getAll())[0];

            const v2 = [
                {
                    page: 'login',
                    elementName: 'password',
                    selector: 'input[type="password"], input[name="password"]',
                    type: 'input' as const,
                    confidence: 0.9,
                },
            ];
            await ObjectRepositoryService.addElements(v2);
            const updated = (await ObjectRepositoryService.getAll())[0];

            expect(updated.id).toBe(original.id);
        });
    });

    describe('updateElement', () => {
        it('updates an existing element by ID', async () => {
            await ObjectRepositoryService.addElements([
                {
                    page: 'login',
                    elementName: 'submit',
                    selector: 'button[type="submit"]',
                    type: 'button' as const,
                    confidence: 0.7,
                },
            ]);
            const existing = (await ObjectRepositoryService.getAll())[0];

            const updated = await ObjectRepositoryService.updateElement(existing.id, {
                selector: 'button[type="submit"], button:has-text("Login")',
                confidence: 0.95,
                lastVerifiedAt: new Date().toISOString(),
            });

            expect(updated).not.toBeNull();
            expect(updated!.selector).toContain('has-text("Login")');
            expect(updated!.confidence).toBe(0.95);
            expect(updated!.lastVerifiedAt).toBeDefined();
        });

        it('records version history on selector change', async () => {
            await ObjectRepositoryService.addElements([
                {
                    page: 'login',
                    elementName: 'submit',
                    selector: 'button[type="submit"]',
                    type: 'button' as const,
                    confidence: 0.7,
                },
            ]);
            const existing = (await ObjectRepositoryService.getAll())[0];

            await ObjectRepositoryService.updateElement(existing.id, {
                selector: 'button[type="submit"], .btn-primary',
            });

            const element = await ObjectRepositoryService.getById(existing.id);
            expect(element).not.toBeNull();
            expect(element!.versionHistory).toBeDefined();
            expect(element!.versionHistory!.length).toBeGreaterThanOrEqual(1);
            expect(element!.versionHistory![0].previousSelector).toBe('button[type="submit"]');
        });

        it('returns null if element not found', async () => {
            const result = await ObjectRepositoryService.updateElement('nonexistent-id', {
                selector: 'new-selector',
            });
            expect(result).toBeNull();
        });
    });

    describe('deleteElement', () => {
        it('removes an element by ID', async () => {
            await ObjectRepositoryService.addElements([
                {
                    page: 'login',
                    elementName: 'test',
                    selector: 'input.test',
                    type: 'input' as const,
                    confidence: 0.8,
                },
            ]);
            const existing = (await ObjectRepositoryService.getAll())[0];

            const deleted = await ObjectRepositoryService.deleteElement(existing.id);
            expect(deleted).toBe(true);

            const all = await ObjectRepositoryService.getAll();
            expect(all).toHaveLength(0);
        });

        it('returns false if element not found', async () => {
            const result = await ObjectRepositoryService.deleteElement('nonexistent-id');
            expect(result).toBe(false);
        });
    });

    // ─── Search & Lookup Tests ──────────────────────────────────

    describe('getByPage', () => {
        it('returns all elements for a given page', async () => {
            await ObjectRepositoryService.addElements([
                {
                    page: 'login',
                    elementName: 'username',
                    selector: 'input[name="username"]',
                    type: 'input' as const,
                    confidence: 0.9,
                },
                {
                    page: 'login',
                    elementName: 'password',
                    selector: 'input[type="password"]',
                    type: 'input' as const,
                    confidence: 0.9,
                },
                {
                    page: 'dashboard',
                    elementName: 'menu',
                    selector: '.sidebar-menu',
                    type: 'other' as const,
                    confidence: 0.8,
                },
            ]);

            const loginElements = await ObjectRepositoryService.getByPage('login');
            expect(loginElements).toHaveLength(2);
            expect(loginElements.every((e: PageElement) => e.page === 'login')).toBe(true);
        });

        it('returns empty array for unknown page', async () => {
            const result = await ObjectRepositoryService.getByPage('nonexistent-page');
            expect(result).toEqual([]);
        });
    });

    describe('getByPageAndSection', () => {
        it('filters elements by page and section', async () => {
            await ObjectRepositoryService.addElements([
                {
                    page: 'employee',
                    section: 'form',
                    elementName: 'name',
                    selector: 'input[name="name"]',
                    type: 'input' as const,
                    confidence: 0.9,
                },
                {
                    page: 'employee',
                    section: 'toolbar',
                    elementName: 'save',
                    selector: 'button:has-text("Save")',
                    type: 'button' as const,
                    confidence: 0.9,
                },
            ]);

            const formElements = await ObjectRepositoryService.getByPageAndSection('employee', 'form');
            expect(formElements).toHaveLength(1);
            expect(formElements[0].section).toBe('form');
        });
    });

    describe('searchByName', () => {
        it('finds elements by partial name match', async () => {
            await ObjectRepositoryService.addElements([
                {
                    page: 'dashboard',
                    elementName: 'save button',
                    selector: 'button.save',
                    type: 'button' as const,
                    confidence: 0.9,
                },
                {
                    page: 'dashboard',
                    elementName: 'save and close',
                    selector: 'button.save-close',
                    type: 'button' as const,
                    confidence: 0.8,
                },
                {
                    page: 'dashboard',
                    elementName: 'cancel button',
                    selector: 'button.cancel',
                    type: 'button' as const,
                    confidence: 0.9,
                },
            ]);

            const results = await ObjectRepositoryService.searchByName('save');
            expect(results).toHaveLength(2);
            expect(results.every((e: PageElement) => e.elementName.toLowerCase().includes('save'))).toBe(true);
        });

        it('is case-insensitive', async () => {
            await ObjectRepositoryService.addElements([
                {
                    page: 'login',
                    elementName: 'Username Field',
                    selector: 'input[name="username"]',
                    type: 'input' as const,
                    confidence: 0.9,
                },
            ]);

            const results = await ObjectRepositoryService.searchByName('USERNAME');
            expect(results).toHaveLength(1);
        });

        it('returns empty array when no match', async () => {
            await ObjectRepositoryService.addElements([
                {
                    page: 'login',
                    elementName: 'username',
                    selector: 'input[name="username"]',
                    type: 'input' as const,
                    confidence: 0.9,
                },
            ]);

            const results = await ObjectRepositoryService.searchByName('nonexistent');
            expect(results).toEqual([]);
        });
    });

    describe('resolveSelector', () => {
        it('returns primary selector for known element', async () => {
            await ObjectRepositoryService.addElements([
                {
                    page: 'login',
                    elementName: 'username',
                    selector: 'input[name="username"]',
                    altSelectors: ['input[placeholder*="username"]'],
                    type: 'input' as const,
                    confidence: 0.9,
                },
            ]);

            const result = await ObjectRepositoryService.resolveSelector('username', 'login');
            expect(result).not.toBeNull();
            expect(result!.primary).toBe('input[name="username"]');
            expect(result!.fallbacks).toContain('input[placeholder*="username"]');
        });

        it('searches globally when page not specified', async () => {
            await ObjectRepositoryService.addElements([
                {
                    page: 'login',
                    elementName: 'username',
                    selector: 'input[name="username"]',
                    type: 'input' as const,
                    confidence: 0.9,
                },
            ]);

            const result = await ObjectRepositoryService.resolveSelector('username');
            expect(result).not.toBeNull();
            expect(result!.primary).toBe('input[name="username"]');
        });

        it('returns null for unknown element', async () => {
            const result = await ObjectRepositoryService.resolveSelector('nonexistent-element');
            expect(result).toBeNull();
        });

        it('prefers verified selectors (confidence >= 0.8 or lastVerifiedAt)', async () => {
            await ObjectRepositoryService.addElements([
                {
                    page: 'login',
                    elementName: 'submit',
                    selector: 'button[type="submit"]',
                    type: 'button' as const,
                    confidence: 0.5,
                },
                {
                    page: 'login',
                    elementName: 'submit',
                    selector: 'button:has-text("Login"), .btn-primary',
                    type: 'button' as const,
                    confidence: 0.95,
                    lastVerifiedAt: new Date().toISOString(),
                },
            ]);

            const result = await ObjectRepositoryService.resolveSelector('submit', 'login');
            expect(result).not.toBeNull();
            expect(result!.primary).toContain('has-text("Login")');
        });
    });

    describe('getByModule', () => {
        it('returns elements filtered by related module', async () => {
            await ObjectRepositoryService.addElements([
                {
                    page: 'employee',
                    elementName: 'name',
                    selector: 'input[name="name"]',
                    type: 'input' as const,
                    confidence: 0.9,
                    relatedModule: 'hr',
                },
                {
                    page: 'payroll',
                    elementName: 'salary',
                    selector: 'input[name="salary"]',
                    type: 'input' as const,
                    confidence: 0.9,
                    relatedModule: 'payroll',
                },
            ]);

            const hrElements = await ObjectRepositoryService.getByModule('hr');
            expect(hrElements).toHaveLength(1);
            expect(hrElements[0].relatedModule).toBe('hr');
        });
    });

    // ─── Verification Tests ─────────────────────────────────────

    describe('recordVerification', () => {
        it('records a successful verification with metadata', async () => {
            await ObjectRepositoryService.addElements([
                {
                    page: 'login',
                    elementName: 'username',
                    selector: 'input[name="username"]',
                    type: 'input' as const,
                    confidence: 0.7,
                },
            ]);
            const element = (await ObjectRepositoryService.getAll())[0];

            await ObjectRepositoryService.recordVerification({
                elementId: element.id,
                success: true,
                jiraTicket: 'GT-123',
                environment: 'testing',
                executionId: 'exec-001',
            });

            const updated = await ObjectRepositoryService.getById(element.id);
            expect(updated).not.toBeNull();
            expect(updated!.lastVerifiedAt).toBeDefined();
            expect(updated!.verificationHistory).toHaveLength(1);
            expect(updated!.verificationHistory![0].jiraTicket).toBe('GT-123');
        });

        it('records a failed verification', async () => {
            await ObjectRepositoryService.addElements([
                {
                    page: 'login',
                    elementName: 'old-button',
                    selector: 'button.old-class',
                    type: 'button' as const,
                    confidence: 0.7,
                },
            ]);
            const element = (await ObjectRepositoryService.getAll())[0];

            await ObjectRepositoryService.recordVerification({
                elementId: element.id,
                success: false,
                failureReason: 'selector not found',
                jiraTicket: 'GT-456',
                environment: 'testing',
                executionId: 'exec-002',
            });

            const updated = await ObjectRepositoryService.getById(element.id);
            expect(updated).not.toBeNull();
            expect(updated!.verificationHistory).toHaveLength(1);
            expect(updated!.verificationHistory![0].success).toBe(false);
            expect(updated!.verificationHistory![0].failureReason).toBe('selector not found');
        });
    });

    // ─── Bulk Operations Tests ──────────────────────────────────

    describe('bulkImport', () => {
        it('imports multiple elements at once', async () => {
            const elements: Omit<PageElement, 'id' | 'discoveredAt'>[] = [
                {
                    page: 'page1',
                    elementName: 'el1',
                    selector: '.el1',
                    type: 'button' as const,
                    confidence: 0.9,
                },
                {
                    page: 'page1',
                    elementName: 'el2',
                    selector: '.el2',
                    type: 'input' as const,
                    confidence: 0.8,
                },
                {
                    page: 'page2',
                    elementName: 'el3',
                    selector: '.el3',
                    type: 'select' as const,
                    confidence: 0.7,
                },
            ];

            await ObjectRepositoryService.bulkImport(elements);
            const all = await ObjectRepositoryService.getAll();
            expect(all).toHaveLength(3);
        });
    });

    describe('exportAll', () => {
        it('exports all elements as JSON string', async () => {
            await ObjectRepositoryService.addElements([
                {
                    page: 'test',
                    elementName: 'test-el',
                    selector: '.test',
                    type: 'button' as const,
                    confidence: 0.9,
                },
            ]);

            const exported = await ObjectRepositoryService.exportAll();
            expect(typeof exported).toBe('string');
            const parsed = JSON.parse(exported);
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed).toHaveLength(1);
        });
    });

    // ─── Statistics Tests ───────────────────────────────────────

    describe('getStatistics', () => {
        it('returns accurate statistics', async () => {
            await ObjectRepositoryService.addElements([
                {
                    page: 'login',
                    elementName: 'verified-el',
                    selector: '.verified',
                    type: 'input' as const,
                    confidence: 0.9,
                    lastVerifiedAt: new Date().toISOString(),
                },
                {
                    page: 'login',
                    elementName: 'unverified-el',
                    selector: '.unverified',
                    type: 'button' as const,
                    confidence: 0.5,
                },
                {
                    page: 'dashboard',
                    elementName: 'another-verified',
                    selector: '.another',
                    type: 'select' as const,
                    confidence: 0.85,
                    lastVerifiedAt: new Date().toISOString(),
                },
            ]);

            const stats = await ObjectRepositoryService.getStatistics();
            expect(stats.totalElements).toBe(3);
            expect(stats.verifiedElements).toBe(2);
            expect(stats.pages).toContain('login');
            expect(stats.pages).toContain('dashboard');
            expect(stats.avgConfidence).toBeGreaterThan(0);
        });
    });

    // ─── Edge Cases ─────────────────────────────────────────────

    describe('edge cases', () => {
        it('handles empty repository gracefully', async () => {
            const all = await ObjectRepositoryService.getAll();
            expect(all).toEqual([]);

            const stats = await ObjectRepositoryService.getStatistics();
            expect(stats.totalElements).toBe(0);
        });

        it('handles malformed JSON file', async () => {
            fs.writeFileSync(TEST_REPO_PATH, 'not valid json');
            const all = await ObjectRepositoryService.getAll();
            expect(all).toEqual([]);
        });

        it('handles missing JSON file', async () => {
            const all = await ObjectRepositoryService.getAll();
            expect(all).toEqual([]);
        });

        it('deduplicates across multiple addElements calls with different field orders', async () => {
            await ObjectRepositoryService.addElements([
                {
                    page: 'login',
                    elementName: 'submit',
                    selector: 'button[type="submit"]',
                    type: 'button' as const,
                    confidence: 0.7,
                },
            ]);

            // Same element, different order of properties
            await ObjectRepositoryService.addElements([
                {
                    elementName: 'submit',
                    page: 'login',
                    type: 'button' as const,
                    selector: 'button[type="submit"]',
                    confidence: 0.8,
                },
            ]);

            const all = await ObjectRepositoryService.getAll();
            expect(all).toHaveLength(1);
        });
    });
});
