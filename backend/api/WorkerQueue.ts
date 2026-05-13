import { Worker } from 'worker_threads';
import * as path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';

export const JobEvents = new EventEmitter();

const PERSIST_DIR = path.join(process.cwd(), 'data');
const PERSIST_PATH = path.join(PERSIST_DIR, 'workerqueue.json');

export interface Job {
    id: string;
    jiraId: string;
    scriptPath: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    progress: number;
}

export class WorkerQueue {
    private static jobs: Job[] = [];
    private static maxConcurrent = 2;
    private static runningCount = 0;
    private static redisEnabled = false;
    private static bullQueue: any = null;

    // Try to enable Redis-backed BullMQ if REDIS_URL is provided
    private static async maybeEnableRedis() {
        if (this.redisEnabled) return;
        const redisUrl = process.env.REDIS_URL || process.env.REDIS;
        if (!redisUrl) return;

        try {
            // @ts-ignore: bullmq is an optional peer dependency
            const { Queue } = await import('bullmq');
            const connection = { connection: { url: redisUrl } } as any;
            this.bullQueue = new Queue('playwright-jobs', connection);
            this.redisEnabled = true;
            console.log('[WorkerQueue] BullMQ enabled via REDIS_URL');
        } catch (e: any) {
            console.warn('[WorkerQueue] Could not enable BullMQ (missing deps?):', e?.message || e);
        }
    }

    // Load persisted jobs on startup
    private static loadPersisted() {
        try {
            if (!fs.existsSync(PERSIST_DIR)) fs.mkdirSync(PERSIST_DIR, { recursive: true });
            if (fs.existsSync(PERSIST_PATH)) {
                const raw = fs.readFileSync(PERSIST_PATH, 'utf8');
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) this.jobs = parsed;
            }
        } catch (e: any) {
            console.warn('[WorkerQueue] Failed to load persisted jobs:', e.message);
        }
    }

    private static persist() {
        try {
            if (!fs.existsSync(PERSIST_DIR)) fs.mkdirSync(PERSIST_DIR, { recursive: true });
            fs.writeFileSync(PERSIST_PATH, JSON.stringify(this.jobs, null, 2), 'utf8');
        } catch (e: any) {
            console.warn('[WorkerQueue] Failed to persist jobs:', e.message);
        }
    }

    static addJob(jiraId: string, scriptPath: string, environment: string = 'testing'): string {
        const id = Math.random().toString(36).substr(2, 9);
        const newJob: Job = { id, jiraId, scriptPath, status: 'pending', progress: 0, environment } as any;
        this.jobs.push(newJob);
        this.persist();
        JobEvents.emit('progress', { type: 'JOB_PROGRESS', job: newJob });
        
        // If Redis is enabled, enqueue to BullMQ as well
        this.maybeEnableRedis().then(() => {
            if (this.redisEnabled && this.bullQueue) {
                try { this.bullQueue.add('job', { id, jiraId, scriptPath }); } catch (e) { /* ignore */ }
            }
        }).catch(() => {});

        this.processQueue();
        return id;
    }

    private static async processQueue() {
        if (this.runningCount >= this.maxConcurrent) return;

        const nextJob = this.jobs.find(j => j.status === 'pending');
        if (!nextJob) return;

        nextJob.status = 'running';
        this.persist();
        JobEvents.emit('progress', { type: 'JOB_PROGRESS', job: nextJob });
        this.runningCount++;

        // Simulate Playwright execution in a worker thread
        // In a real scenario, this would spawn a new worker to run Playwright
        console.log(`[WorkerQueue] Starting job ${nextJob.id} for ${nextJob.jiraId}`);

        this.simulateJob(nextJob).then(() => {
            this.runningCount--;
            this.processQueue();
        });
    }

    private static async simulateJob(job: Job) {
        if (job.jiraId === 'GLOBAL_SYSTEM_AUDIT') {
            return this.simulateGlobalAudit(job);
        }
        return new Promise<void>((resolve) => {
            let p = 0;
            const interval = setInterval(() => {
                p += 20;
                job.progress = p;
                JobEvents.emit('progress', { type: 'JOB_PROGRESS', job });
                
                // Emit execution logs for test execution
                if (job.status === 'running') {
                    JobEvents.emit('execution:log', {
                        type: 'execution:log',
                        payload: {
                            ticketId: job.jiraId,
                            testCaseId: job.id,
                            log: `Test execution progress: ${p}%`,
                            timestamp: new Date().toISOString()
                        }
                    });
                }
                
                if (p >= 100) {
                    job.status = 'completed';
                    clearInterval(interval);
                    this.persist();
                    JobEvents.emit('progress', { type: 'JOB_PROGRESS', job });
                    JobEvents.emit('completed', { type: 'UPLOAD_COMPLETE', recordingId: job.id });
                    resolve();
                }
            }, 1000);
        });
    }

    private static async simulateGlobalAudit(job: Job) {
        const fakeMenus = [
            'Department', 'Leave Request', 'Attendance Process', 
            'Payment Calculation', 'Personal Income Tax IRD 16 Report'
        ];
        
        for (let i = 0; i < fakeMenus.length; i++) {
            const menu = fakeMenus[i];
            const progress = Math.round(((i + 1) / fakeMenus.length) * 100);
            
            job.status = `running` as any;
            job.progress = progress;
            // Add a custom message field if needed, or just update the status text
            (job as any).currentMenu = menu;
            
            console.log(`[WorkerQueue] Auditing ${menu} (${progress}%)`);
            JobEvents.emit('progress', { 
                type: 'JOB_PROGRESS', 
                job: { ...job, status: `Auditing: ${menu}` as any } 
            });

            await new Promise(r => setTimeout(r, 1500)); // Simulate page load and AI audit
        }

        job.status = 'completed';
        job.progress = 100;
        this.persist();
        JobEvents.emit('progress', { type: 'JOB_PROGRESS', job });
        JobEvents.emit('completed', { type: 'UPLOAD_COMPLETE', recordingId: job.id });
    }

    static getJobs() {
        // ensure persisted state is loaded before returning
        this.loadPersisted();
        return this.jobs;
    }

    static getStats() {
        return {
            total: this.jobs.length,
            pending: this.jobs.filter(j => j.status === 'pending').length,
            running: this.runningCount,
            completed: this.jobs.filter(j => j.status === 'completed').length,
            failed: this.jobs.filter(j => j.status === 'failed').length,
            maxConcurrent: this.maxConcurrent,
            redisEnabled: this.redisEnabled
        };
    }
}
