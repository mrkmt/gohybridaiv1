/**
 * TestingDiscoveryService.test.ts
 *
 * Tests for the three bugs fixed in TestingDiscoveryService:
 *   1. Self-deadlock: runLiveBackground set inProgress then called runLive
 *      which also checked inProgress → 60s timeout, 0 elements discovered.
 *   2. Deduplication: concurrent runLiveBackground calls for same module
 *      should not launch two browser sessions.
 *   3. runLive foreground waits correctly when background already running.
 *
 * All Playwright / file-system dependencies are mocked.
 */

// ── Mocks (must come before imports) ──────────────────────────────────────────

jest.mock('../DiscoveryCacheService', () => ({
  DiscoveryCacheService: {
    normalizeModuleName: (name: string) => {
      if (!name || name.trim() === '') return 'unknown'; // sentinel — guard blocks this
      if (name.toLowerCase() === 'general') return 'General'; // sentinel — guard blocks this
      return name.trim();
    },
    getStatus: jest.fn(() => ({
      fresh: true,
      age: '0m',
      elementCount: 5,
      discoveredAt: new Date().toISOString(),
      version: 1,
    })),
    get: jest.fn(() => ({
      moduleName: 'Leave Policy',
      inventory: { buttons: [], inputs: [], dropdowns: [] },
      discoveredAt: new Date().toISOString(),
      version: 1,
    })),
    save: jest.fn(),
  },
}));

jest.mock('../../../utils/logger', () => ({
  appLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Spy target: _runLiveInternal must be called by runLiveBackground (not runLive)
const mockRunLiveInternal = jest.fn().mockResolvedValue({
  fresh: true,
  age: '0m',
  elementCount: 5,
  sampleSelectors: [],
});

// ── Subject ───────────────────────────────────────────────────────────────────

import { TestingDiscoveryService } from '../TestingDiscoveryService';

// Patch _runLiveInternal on the prototype so the spy is always active
const proto = TestingDiscoveryService.prototype as any;
const originalInternal = proto._runLiveInternal;
beforeAll(() => {
  proto._runLiveInternal = mockRunLiveInternal;
});
afterAll(() => {
  proto._runLiveInternal = originalInternal;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function clearLock(name: string) {
  // Access the static set directly to reset state between tests
  (TestingDiscoveryService as any).inProgress.delete(name);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TestingDiscoveryService — runLiveBackground', () => {
  let service: TestingDiscoveryService;

  beforeEach(() => {
    service = new TestingDiscoveryService();
    mockRunLiveInternal.mockClear();
    clearLock('Leave Policy');
    clearLock('Designation');
  });

  afterEach(() => {
    clearLock('Leave Policy');
    clearLock('Designation');
  });

  // ─── Bug fix: deadlock ──────────────────────────────────────────────────────

  it('calls _runLiveInternal directly — NOT runLive — to avoid self-deadlock', async () => {
    const runLiveSpy = jest.spyOn(service, 'runLive');

    service.runLiveBackground('Leave Policy');

    // Give micro-tasks a tick to start
    await new Promise(r => setImmediate(r));

    expect(mockRunLiveInternal).toHaveBeenCalledWith('Leave Policy');
    expect(runLiveSpy).not.toHaveBeenCalled();

    runLiveSpy.mockRestore();
  });

  it('resolves the lock after _runLiveInternal completes', async () => {
    let resolveInternal!: () => void;
    mockRunLiveInternal.mockImplementationOnce(
      () => new Promise<void>(res => { resolveInternal = res; })
    );

    service.runLiveBackground('Designation');
    await new Promise(r => setImmediate(r));

    // Lock should be held while internal is running
    expect((TestingDiscoveryService as any).inProgress.has('Designation')).toBe(true);

    resolveInternal();
    await new Promise(r => setImmediate(r));

    // Lock should be released after completion
    expect((TestingDiscoveryService as any).inProgress.has('Designation')).toBe(false);
  });

  // ─── Deduplication ─────────────────────────────────────────────────────────

  it('skips second call for same module — only one browser session launched', () => {
    service.runLiveBackground('Leave Policy');
    service.runLiveBackground('Leave Policy'); // duplicate

    // _runLiveInternal must be called exactly once despite two background calls
    expect(mockRunLiveInternal).toHaveBeenCalledTimes(1);
  });

  it('allows independent modules to run concurrently', () => {
    service.runLiveBackground('Leave Policy');
    service.runLiveBackground('Designation');

    expect(mockRunLiveInternal).toHaveBeenCalledTimes(2);
  });

  // ─── Guard conditions ───────────────────────────────────────────────────────

  it('returns immediately for empty module name', () => {
    service.runLiveBackground('');
    expect(mockRunLiveInternal).not.toHaveBeenCalled();
  });

  it('returns immediately for "General" module', () => {
    service.runLiveBackground('General');
    expect(mockRunLiveInternal).not.toHaveBeenCalled();
  });
});

describe('TestingDiscoveryService — runLive (foreground)', () => {
  let service: TestingDiscoveryService;

  beforeEach(() => {
    service = new TestingDiscoveryService();
    mockRunLiveInternal.mockClear();
    clearLock('Leave Policy');
  });

  afterEach(() => {
    clearLock('Leave Policy');
  });

  it('calls _runLiveInternal and returns result when no lock is held', async () => {
    const result = await service.runLive('Leave Policy');

    expect(mockRunLiveInternal).toHaveBeenCalledWith('Leave Policy');
    expect(result.fresh).toBe(true);
    expect(result.elementCount).toBe(5);
  });

  it('releases inProgress lock after _runLiveInternal resolves', async () => {
    await service.runLive('Leave Policy');

    expect((TestingDiscoveryService as any).inProgress.has('Leave Policy')).toBe(false);
  });

  it('releases inProgress lock even if _runLiveInternal rejects', async () => {
    mockRunLiveInternal.mockRejectedValueOnce(new Error('browser crash'));

    await expect(service.runLive('Leave Policy')).rejects.toThrow('browser crash');

    expect((TestingDiscoveryService as any).inProgress.has('Leave Policy')).toBe(false);
  });

  it('waits for background to finish and returns cached status when lock is already held', async () => {
    // Simulate background already running: set lock manually
    (TestingDiscoveryService as any).inProgress.add('Leave Policy');

    // Release the lock after 50ms to simulate background completing
    setTimeout(() => clearLock('Leave Policy'), 50);

    const result = await service.runLive('Leave Policy');

    // _runLiveInternal was NOT called again (we reused the background result)
    expect(mockRunLiveInternal).not.toHaveBeenCalled();
    // Returns cached status from DiscoveryCacheService.getStatus
    expect(result.fresh).toBe(true);
  });
});
