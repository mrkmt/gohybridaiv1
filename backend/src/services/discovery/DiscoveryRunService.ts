import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { promises as fsPromises } from 'fs';
import { DiscoverySafeConfig, getDiscoveryStorageDir } from './DiscoveryConfig';

export type DiscoveryRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'paused';

export interface DiscoveryCheckpoint {
    runId: string;
    visitedUrls: string[];
    pendingUrls: { url: string; depth: number }[];
    timestamp: string;
}

export interface DiscoveryRunEvent {
    timestamp: string;
    level: 'info' | 'warn' | 'error';
    message: string;
    page?: string;
    metadata?: Record<string, unknown>;
}

export interface DiscoveryRunRecord {
    id: string;
    status: DiscoveryRunStatus;
    startedAt: string;
    completedAt?: string;
    config: DiscoverySafeConfig;
    pagesDiscovered: number;
    elementsExtracted: number;
    latestError?: string;
    hasCheckpoint?: boolean;
    latestScreenshotPath?: string;
    screenshotPaths: string[];
    events: DiscoveryRunEvent[];
}

interface DiscoveryRunStore {
    runs: DiscoveryRunRecord[];
}

export class DiscoveryRunService {
    private static readonly filePath = path.join(getDiscoveryStorageDir(), 'runs.json');

    static async create(config: DiscoverySafeConfig): Promise<DiscoveryRunRecord> {
        const store = await this.readStore();
        
        // Generate Easy ID (RUN-101, RUN-102, etc.)
        const existingIds = store.runs.map(r => r.id);
        const runNumbers = existingIds
            .map(id => {
                const match = id.match(/RUN-(\d+)/);
                return match ? parseInt(match[1], 10) : null;
            })
            .filter((n): n is number => n !== null);
        
        const nextNumber = runNumbers.length > 0 ? Math.max(...runNumbers) + 1 : 101;
        const easyId = `RUN-${nextNumber}`;

        const run: DiscoveryRunRecord = {
            id: easyId,
            status: 'queued',
            startedAt: new Date().toISOString(),
            config,
            pagesDiscovered: 0,
            elementsExtracted: 0,
            hasCheckpoint: false,
            screenshotPaths: [],
            events: [],
        };

        store.runs.unshift(run);
        await this.writeStore(store);
        return run;
    }

    static async list(): Promise<DiscoveryRunRecord[]> {
        const store = await this.readStore();
        return store.runs;
    }

    static async markDanglingRunsAsPaused(): Promise<void> {
        const store = await this.readStore();
        let changed = false;
        store.runs.forEach(run => {
            if (run.status === 'running') {
                run.status = 'paused';
                run.events.push({
                    timestamp: new Date().toISOString(),
                    level: 'warn',
                    message: 'Run was interrupted and has been marked as paused.'
                });
                changed = true;
            }
        });
        if (changed) {
            await this.writeStore(store);
        }
    }

    static async getById(id: string): Promise<DiscoveryRunRecord | undefined> {
        const store = await this.readStore();
        return store.runs.find(run => run.id === id);
    }

    static async markRunning(id: string): Promise<DiscoveryRunRecord | undefined> {
        return await this.update(id, run => {
            run.status = 'running';
        });
    }

    static async markCompleted(id: string): Promise<DiscoveryRunRecord | undefined> {
        await this.clearCheckpoint(id);
        return await this.update(id, run => {
            run.status = 'completed';
            run.completedAt = new Date().toISOString();
            run.hasCheckpoint = false;
        });
    }

    static async markFailed(id: string, error: string): Promise<DiscoveryRunRecord | undefined> {
        return await this.update(id, run => {
            run.status = 'failed';
            run.completedAt = new Date().toISOString();
            run.latestError = error;
        });
    }

    static async saveCheckpoint(id: string, checkpoint: Omit<DiscoveryCheckpoint, 'timestamp'>): Promise<void> {
        const fullCheckpoint: DiscoveryCheckpoint = {
            ...checkpoint,
            timestamp: new Date().toISOString()
        };
        const checkpointPath = path.join(getDiscoveryStorageDir(), `checkpoint_${id}.json`);
        await fsPromises.writeFile(checkpointPath, JSON.stringify(fullCheckpoint, null, 2), 'utf8');
        
        await this.update(id, run => {
            run.hasCheckpoint = true;
        });
    }

    static async getCheckpoint(id: string): Promise<DiscoveryCheckpoint | undefined> {
        const checkpointPath = path.join(getDiscoveryStorageDir(), `checkpoint_${id}.json`);
        if (!fs.existsSync(checkpointPath)) return undefined;
        try {
            const content = await fsPromises.readFile(checkpointPath, 'utf8');
            return JSON.parse(content);
        } catch {
            return undefined;
        }
    }

    static async clearCheckpoint(id: string): Promise<void> {
        const checkpointPath = path.join(getDiscoveryStorageDir(), `checkpoint_${id}.json`);
        if (fs.existsSync(checkpointPath)) {
            try { await fsPromises.unlink(checkpointPath); } catch {}
        }
        await this.update(id, run => {
            run.hasCheckpoint = false;
        });
    }

    static async appendEvent(id: string, event: DiscoveryRunEvent): Promise<DiscoveryRunRecord | undefined> {
        return await this.update(id, run => {
            run.events.push(event);
            if (event.level === 'error') {
                run.latestError = event.message;
            }
            if (run.events.length > 100) {
                run.events = run.events.slice(run.events.length - 100);
            }
        });
    }

    static async updateStats(id: string, updates: Partial<Pick<DiscoveryRunRecord, 'pagesDiscovered' | 'elementsExtracted'>>): Promise<DiscoveryRunRecord | undefined> {
        return await this.update(id, run => {
            if (typeof updates.pagesDiscovered === 'number') run.pagesDiscovered = updates.pagesDiscovered;
            if (typeof updates.elementsExtracted === 'number') run.elementsExtracted = updates.elementsExtracted;
        });
    }

    static async addScreenshot(id: string, screenshotPath: string): Promise<DiscoveryRunRecord | undefined> {
        return await this.update(id, run => {
            run.latestScreenshotPath = screenshotPath;
            if (!run.screenshotPaths.includes(screenshotPath)) {
                run.screenshotPaths.push(screenshotPath);
            }
        });
    }

    private static async update(id: string, mutate: (run: DiscoveryRunRecord) => void): Promise<DiscoveryRunRecord | undefined> {
        const store = await this.readStore();
        const run = store.runs.find(item => item.id === id);
        if (!run) return undefined;
        mutate(run);
        await this.writeStore(store);
        return run;
    }

    private static ensureStore(): void {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, JSON.stringify({ runs: [] }, null, 2), 'utf8');
        }
    }

    private static async readStore(): Promise<DiscoveryRunStore> {
        this.ensureStore();
        try {
            const raw = await fsPromises.readFile(this.filePath, 'utf8');
            const parsed = JSON.parse(raw) as DiscoveryRunStore;
            return { runs: Array.isArray(parsed.runs) ? parsed.runs : [] };
        } catch {
            return { runs: [] };
        }
    }

    private static async writeStore(store: DiscoveryRunStore): Promise<void> {
        this.ensureStore();
        const trimmed = store.runs.slice(0, 50);
        await fsPromises.writeFile(this.filePath, JSON.stringify({ runs: trimmed }, null, 2), 'utf8');
    }
}
