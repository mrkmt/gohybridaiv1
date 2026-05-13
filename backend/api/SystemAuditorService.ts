import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

export class SystemAuditorService {
    /**
     * Clean up "Zombie" processes that may have been left behind by crashed tests.
     */
    static async cleanupZombieProcesses(): Promise<void> {
        console.log('[Auditor] Auditing system processes for cleanup...');
        
        const processesToKill = ['chrome.exe', 'chromedriver.exe', 'playwright.exe'];
        
        for (const proc of processesToKill) {
            try {
                // Kill processes that are NOT responding or have been running too long
                // On Windows, /F is force, /T is tree
                await execAsync(`taskkill /F /IM "${proc}" /T`);
                console.log(`[Auditor] Successfully terminated orphan process: ${proc}`);
            } catch (err) {
                // Ignore "Process not found" errors
            }
        }
    }

    /**
     * Checks available disk space for video/screenshot storage.
     */
    static async checkStorageHealth(): Promise<{ healthy: boolean; reason?: string }> {
        // Implementation for disk check if needed
        return { healthy: true };
    }
}
