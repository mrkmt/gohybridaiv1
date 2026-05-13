import { exec } from 'child_process';
import { promisify } from 'util';
import { Pool } from 'pg';
import { LocalAIService } from '../../../api/LocalAIService';
import { config } from '../../../api/config';
import { CriticalErrorService } from '../CriticalErrorService';

const execAsync = promisify(exec);

export class SystemHealthService {
    /**
     * Kills zombie browser processes that might interfere with new test runs.
     * Targeted at Windows environments (Node.exe, Chrome, msedgedriver).
     */
    static async cleanupZombieProcesses(): Promise<void> {
        console.log('[Health] Running zombie process cleanup...');
        const targets = ['chromedriver.exe', 'msedgedriver.exe', 'playwright.exe'];
        
        for (const target of targets) {
            try {
                // /F forces termination, /IM specifies image name, /T kills child processes
                await execAsync(`taskkill /F /IM "${target}" /T`);
            } catch (e) {
                // Silently ignore if process not found
            }
        }
        console.log('[Health] Cleanup complete.');
    }

    /**
     * Checks the status of critical system dependencies.
     */
    static async checkHealth(pool: any): Promise<{ status: 'OK' | 'DEGRADED' | 'FAIL', details: any }> {
        const details: any = {
            database: 'UNKNOWN',
            localAI: 'UNKNOWN',
            timestamp: new Date().toISOString()
        };

        let failCount = 0;

        // Check Database
        try {
            await pool.query('SELECT 1');
            details.database = 'CONNECTED';
        } catch (e: any) {
            details.database = `ERROR: ${e.message}`;
            failCount++;
            await CriticalErrorService.reportDatabaseDown(e);
        }

        // Check AI Provider (MultiAgentRouter → Gemini CLI / Qwen CLI / OpenRouter)
        try {
            const aiStatus = await LocalAIService.simpleGenerate('health check');
            details.localAI = aiStatus ? 'OPERATIONAL' : 'OFFLINE';
            if (!aiStatus) {
                failCount++;
                await CriticalErrorService.reportAiOutage('HEALTH_CHECK', 'health check', 'LocalAIService returned empty status');
            }
        } catch (e: any) {
            details.localAI = `ERROR: ${e.message}`;
            failCount++;
            await CriticalErrorService.reportAiOutage('HEALTH_CHECK', 'health check', e);
        }

        const status = failCount === 0 ? 'OK' : (failCount < 2 ? 'DEGRADED' : 'FAIL');

        return { status, details };
    }
}
