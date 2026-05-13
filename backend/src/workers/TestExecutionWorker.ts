import { Job } from 'bullmq';
import { Pool } from 'pg';
import { WorkerQueue, JobData } from '../../api/WorkerQueue';
import { TestingExecutionOrchestrator } from '../services/execution/TestingExecutionOrchestrator';
import { TestSessionService } from '../services/session/TestSessionService';
import { appLogger } from '../utils/logger';

export class TestExecutionWorker {
    private orchestrator: TestingExecutionOrchestrator;
    private sessions: TestSessionService;

    constructor(private pool: Pool) {
        this.sessions = new TestSessionService(pool);
        this.orchestrator = new TestingExecutionOrchestrator(this.sessions, pool);
    }

    async start() {
        WorkerQueue.startWorker(this.processJob.bind(this));
        appLogger.info('[TestExecutionWorker] Worker started and listening for jobs.');
    }

    private async processJob(job: Job<JobData>) {
        const { jiraId, userId, testCaseIds, environment, type } = job.data;
        appLogger.info(`[TestExecutionWorker] Processing job ${job.id} for ticket ${jiraId} (Type: ${type})`);

        try {
            // Get session
            const session = await this.sessions.get(jiraId, userId);
            if (!session) {
                throw new Error(`Session not found for ticket ${jiraId}`);
            }

            if (type === 'execute') {
                await this.orchestrator.execute(session, testCaseIds, environment, userId);
            } else if (type === 'retry') {
                if (!testCaseIds || testCaseIds.length === 0) {
                    throw new Error('No test case IDs provided for retry');
                }
                await this.orchestrator.retryFailed(session, testCaseIds, environment, userId);
            }

            appLogger.info(`[TestExecutionWorker] Job ${job.id} finished successfully for ticket ${jiraId}`);
        } catch (err: any) {
            appLogger.error(`[TestExecutionWorker] Job ${job.id} failed for ticket ${jiraId}: ${err.message}`, {
                stack: err.stack,
            });
            throw err; // Rethrow to let BullMQ handle the failure
        }
    }
}
