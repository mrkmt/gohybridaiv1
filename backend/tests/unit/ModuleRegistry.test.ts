import { ModuleRegistry, ModuleInfo } from '../../src/services/ModuleRegistry';
import * as fs from 'fs';
import * as path from 'path';

// Path where ModuleRegistry stores its data
const REGISTRY_PATH = path.join(__dirname, '..', '..', 'src', 'local_storage', 'module-registry.json');

describe('ModuleRegistry', () => {
  beforeEach(() => {
    // Clear in-memory cache before each test
    ModuleRegistry.clearCache();
    // Remove persisted file to ensure test isolation
    if (fs.existsSync(REGISTRY_PATH)) {
      fs.unlinkSync(REGISTRY_PATH);
    }
  });

  afterAll(() => {
    // Cleanup: remove test artifacts
    if (fs.existsSync(REGISTRY_PATH)) {
      fs.unlinkSync(REGISTRY_PATH);
    }
  });

  describe('storeDraft', () => {
    it('stores a new draft module from a dev ticket', () => {
      ModuleRegistry.storeDraft('ATT-22', {
        moduleName: 'Department',
        menuName: 'Department Setup',
        uiRoute: '/#/app.department',
        apiRoute: '/api/department',
        requirements: ['Short Code max 5 chars', 'Name is required'],
      });

      const resolved = ModuleRegistry.resolve('ATT-22');
      expect(resolved).not.toBeNull();
      expect(resolved!.ticketId).toBe('ATT-22');
      expect(resolved!.moduleName).toBe('Department');
      expect(resolved!.confirmed).toBe(false);
      expect(resolved!.source).toBe('dev-ticket');
      expect(resolved!.requirements).toContain('Short Code max 5 chars');
    });

    it('updates an existing draft without overwriting confirmed uiRoute', () => {
      // Store initial draft
      ModuleRegistry.storeDraft('ATT-15', {
        moduleName: 'Performance Journal',
        uiRoute: '/#/app.guess',
      });

      // Simulate a confirmed route from live discovery
      const existing = ModuleRegistry.resolve('ATT-15');
      expect(existing!.uiRoute).toBe('/#/app.guess');
      expect(existing!.confirmed).toBe(false);

      // Now manually confirm it
      ModuleRegistry.confirmModule('ATT-15', {
        moduleName: 'Performance Journal',
        menuName: 'My Performance Journal',
        uiRoute: '/#/app.myperformancejournal',
      });

      // Update draft — should NOT overwrite confirmed uiRoute
      ModuleRegistry.storeDraft('ATT-15', {
        moduleName: 'Performance Journal Updated',
        uiRoute: '/#/app.wrong',
      });

      const updated = ModuleRegistry.resolve('ATT-15');
      expect(updated!.moduleName).toBe('Performance Journal Updated');
      expect(updated!.uiRoute).toBe('/#/app.myperformancejournal'); // preserved
      expect(updated!.confirmed).toBe(true);
    });

    it('creates a new entry when ticketId does not exist', () => {
      ModuleRegistry.storeDraft('ATT-99', {
        moduleName: 'New Module',
      });
      const drafts = ModuleRegistry.getAllDrafts();
      const found = drafts.find(d => d.ticketId === 'ATT-99');
      expect(found).toBeDefined();
      expect(found!.moduleName).toBe('New Module');
    });
  });

  describe('confirmModule', () => {
    it('confirms an existing draft module', () => {
      ModuleRegistry.storeDraft('ATT-22', {
        moduleName: 'Department',
        uiRoute: '/#/app.guess',
      });

      ModuleRegistry.confirmModule('ATT-22', {
        moduleName: 'Department',
        menuName: 'Department Setup',
        uiRoute: '/#/app.department',
      });

      const resolved = ModuleRegistry.resolve('ATT-22');
      expect(resolved).not.toBeNull();
      expect(resolved!.confirmed).toBe(true);
      expect(resolved!.source).toBe('live-discovery');
      expect(resolved!.uiRoute).toBe('/#/app.department');
      expect(resolved!.menuName).toBe('Department Setup');
      expect(resolved!.confirmedAt).toBeDefined();
    });

    it('creates a new confirmed module when no draft exists', () => {
      ModuleRegistry.confirmModule('ATT-50', {
        moduleName: 'Label Setup',
        menuName: 'Labels',
        uiRoute: '/#/app.label',
      });

      const resolved = ModuleRegistry.resolve('ATT-50');
      expect(resolved).not.toBeNull();
      expect(resolved!.confirmed).toBe(true);
      expect(resolved!.source).toBe('live-discovery');
    });
  });

  describe('confirmFromDiscovery', () => {
    it('confirms a module from browser discovery results', () => {
      ModuleRegistry.storeDraft('ATT-18', {
        moduleName: 'Designation',
        requirements: ['Title field required'],
      });

      ModuleRegistry.confirmFromDiscovery({
        ticketId: 'ATT-18',
        moduleName: 'Designation',
        menuName: 'Designation Setup',
        parentMenu: 'Master Data',
        uiRoute: '/#/app.designation',
        fullNavigationPath: 'Master Data > Designation Setup',
      });

      const resolved = ModuleRegistry.resolve('ATT-18');
      expect(resolved).not.toBeNull();
      expect(resolved!.confirmed).toBe(true);
      expect(resolved!.parentMenu).toBe('Master Data');
      expect(resolved!.fullNavigationPath).toBe('Master Data > Designation Setup');
      expect(resolved!.uiRoute).toBe('/#/app.designation');
    });

    it('creates a new entry when ticket is not in registry', () => {
      ModuleRegistry.confirmFromDiscovery({
        ticketId: 'ATT-NEW',
        moduleName: 'New Discovery',
        menuName: 'New Menu',
        parentMenu: 'Parent',
        uiRoute: '/#/app.new',
        fullNavigationPath: 'Parent > New Menu',
      });

      const resolved = ModuleRegistry.resolve('ATT-NEW');
      expect(resolved).not.toBeNull();
      expect(resolved!.confirmed).toBe(true);
    });
  });

  describe('resolve', () => {
    it('returns the module info for a known ticket', () => {
      ModuleRegistry.storeDraft('ATT-22', { moduleName: 'Department' });
      const result = ModuleRegistry.resolve('ATT-22');
      expect(result).not.toBeNull();
      expect(result!.ticketId).toBe('ATT-22');
    });

    it('returns null for unknown ticket', () => {
      const result = ModuleRegistry.resolve('ATT-UNKNOWN');
      expect(result).toBeNull();
    });
  });

  describe('getAllDrafts', () => {
    it('returns only unconfirmed modules', () => {
      ModuleRegistry.storeDraft('ATT-1', { moduleName: 'Draft One' });
      ModuleRegistry.storeDraft('ATT-2', { moduleName: 'Draft Two' });
      ModuleRegistry.confirmModule('ATT-1', {
        moduleName: 'Draft One',
        menuName: 'One',
        uiRoute: '/#/app.one',
      });

      const drafts = ModuleRegistry.getAllDrafts();
      expect(drafts.length).toBe(1);
      expect(drafts[0].ticketId).toBe('ATT-2');
    });

    it('returns empty array when no drafts exist', () => {
      expect(ModuleRegistry.getAllDrafts()).toEqual([]);
    });
  });

  describe('getAllConfirmed', () => {
    it('returns only confirmed modules', () => {
      ModuleRegistry.storeDraft('ATT-1', { moduleName: 'Draft One' });
      ModuleRegistry.confirmModule('ATT-2', {
        moduleName: 'Confirmed Two',
        menuName: 'Two',
        uiRoute: '/#/app.two',
      });

      const confirmed = ModuleRegistry.getAllConfirmed();
      expect(confirmed.length).toBe(1);
      expect(confirmed[0].ticketId).toBe('ATT-2');
      expect(confirmed[0].moduleName).toBe('Confirmed Two');
    });

    it('returns empty array when no confirmed modules exist', () => {
      expect(ModuleRegistry.getAllConfirmed()).toEqual([]);
    });
  });

  describe('findSimilar', () => {
    it('finds modules by name keyword', () => {
      ModuleRegistry.storeDraft('ATT-22', { moduleName: 'Department' });
      ModuleRegistry.confirmModule('ATT-15', {
        moduleName: 'Performance Journal',
        menuName: 'Journal',
        uiRoute: '/#/app.journal',
      });

      const results = ModuleRegistry.findSimilar('department');
      expect(results.length).toBe(1);
      expect(results[0].ticketId).toBe('ATT-22');
    });

    it('finds modules by route keyword', () => {
      ModuleRegistry.confirmModule('ATT-15', {
        moduleName: 'Performance Journal',
        menuName: 'Journal',
        uiRoute: '/#/app.myperformancejournal',
      });

      const results = ModuleRegistry.findSimilar('performancejournal');
      expect(results.length).toBe(1);
      expect(results[0].ticketId).toBe('ATT-15');
    });

    it('returns empty array when no matches', () => {
      ModuleRegistry.storeDraft('ATT-22', { moduleName: 'Department' });
      const results = ModuleRegistry.findSimilar('nonexistent');
      expect(results).toEqual([]);
    });

    it('is case-insensitive', () => {
      ModuleRegistry.storeDraft('ATT-22', { moduleName: 'Department' });
      const lower = ModuleRegistry.findSimilar('department');
      const upper = ModuleRegistry.findSimilar('DEPARTMENT');
      expect(lower).toEqual(upper);
    });
  });

  describe('clearCache', () => {
    it('resets the in-memory cache so next load reads from disk', () => {
      ModuleRegistry.storeDraft('ATT-1', { moduleName: 'Test' });
      ModuleRegistry.clearCache();

      // After clearCache, the next resolve should reload from disk
      const resolved = ModuleRegistry.resolve('ATT-1');
      expect(resolved).not.toBeNull();
    });
  });
});
