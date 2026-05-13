/**
 * UserContextService
 *
 * Provides isolated storage and context for multi-user environments.
 * Prevents "Dual-User Conflict" where two users' discovery runs interfere.
 */

import * as fs from 'fs';
import * as path from 'path';
import { appLogger } from '../utils/logger';

export class UserContextService {
    private static BASE_DIR = path.join(process.cwd(), 'local_storage', 'user_contexts');

    /**
     * Get isolated path for a specific user's resource
     */
    static getUserPath(userId: string, resourceType: 'discovery' | 'scripts' | 'artifacts'): string {
        const userDir = path.join(this.BASE_DIR, userId, resourceType);
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }
        return userDir;
    }

    /**
     * Store a sandboxed UI snapshot for a specific user
     */
    static async saveUserSnapshot(userId: string, moduleName: string, elements: any[]): Promise<void> {
        const discoveryDir = this.getUserPath(userId, 'discovery');
        const snapshotPath = path.join(discoveryDir, `${moduleName}.json`);
        
        fs.writeFileSync(snapshotPath, JSON.stringify({
            userId,
            moduleName,
            capturedAt: new Date().toISOString(),
            elements
        }, null, 2));
        
        appLogger.info(`[UserContext] Saved isolated snapshot for user ${userId}`, { module: moduleName });
    }

    /**
     * Load a sandboxed UI snapshot for a specific user
     */
    static async loadUserSnapshot(userId: string, moduleName: string): Promise<any[] | null> {
        const snapshotPath = path.join(this.getUserPath(userId, 'discovery'), `${moduleName}.json`);
        
        if (!fs.existsSync(snapshotPath)) return null;
        
        try {
            const data = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
            return data.elements;
        } catch {
            return null;
        }
    }

    /**
     * Clean up a user's isolated context
     */
    static async cleanup(userId: string): Promise<void> {
        const userDir = path.join(this.BASE_DIR, userId);
        if (fs.existsSync(userDir)) {
            fs.rmSync(userDir, { recursive: true, force: true });
            appLogger.info(`[UserContext] Cleaned up isolation for user ${userId}`);
        }
    }
}
