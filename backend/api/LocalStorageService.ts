/**
 * LocalStorageService
 * 
 * Local file storage service (MinIO replacement)
 * Stores files in backend/local_storage/assets/
 */

import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';

export class LocalStorageService {
    private baseDir: string;
    private publicRoute: string;

    constructor() {
        this.baseDir = config.storage.baseDir;
        this.publicRoute = config.storage.publicRoute;
        this.ensureStorageDir();
    }

    /**
     * Ensure storage directory exists
     */
    private ensureStorageDir() {
        const dirs = [
            this.baseDir,
            path.join(this.baseDir, 'assets'),
            path.join(this.baseDir, 'test-artifacts'),
            path.join(this.baseDir, 'screenshots'),
            path.join(this.baseDir, 'videos'),
            path.join(this.baseDir, 'reports')
        ];

        dirs.forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`[LocalStorage] Created directory: ${dir}`);
            }
        });
    }

    /**
     * Save file to local storage
     */
    async saveFile(
        subPath: string,
        buffer: Buffer | string,
        fileName: string
    ): Promise<string> {
        try {
            const dir = path.join(this.baseDir, subPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const filePath = path.join(dir, fileName);
            
            if (Buffer.isBuffer(buffer)) {
                fs.writeFileSync(filePath, buffer);
            } else {
                fs.writeFileSync(filePath, buffer, 'utf-8');
            }

            console.log(`[LocalStorage] Saved: ${filePath}`);
            return filePath;
        } catch (error: any) {
            console.error('[LocalStorage] Save error:', error.message);
            throw new Error('Failed to save file to local storage');
        }
    }

    /**
     * Read file from local storage
     */
    async readFile(subPath: string, fileName: string): Promise<Buffer> {
        try {
            const filePath = path.join(this.baseDir, subPath, fileName);
            
            if (!fs.existsSync(filePath)) {
                throw new Error('File not found');
            }

            return fs.readFileSync(filePath);
        } catch (error: any) {
            console.error('[LocalStorage] Read error:', error.message);
            throw new Error('Failed to read file from local storage');
        }
    }

    /**
     * Delete file from local storage
     */
    async deleteFile(subPath: string, fileName: string): Promise<void> {
        try {
            const filePath = path.join(this.baseDir, subPath, fileName);
            
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`[LocalStorage] Deleted: ${filePath}`);
            }
        } catch (error: any) {
            console.error('[LocalStorage] Delete error:', error.message);
            throw new Error('Failed to delete file from local storage');
        }
    }

    /**
     * Get public URL for file
     */
    getPublicUrl(filePath: string): string {
        const relativePath = path.relative(this.baseDir, filePath);
        return `${this.publicRoute}/${relativePath.replace(/\\/g, '/')}`;
    }

    /**
     * Save screenshot
     */
    async saveScreenshot(testId: string, buffer: Buffer): Promise<string> {
        const fileName = `screenshot-${Date.now()}.png`;
        const filePath = await this.saveFile(
            path.join('test-artifacts', testId, 'screenshots'),
            buffer,
            fileName
        );
        return filePath;
    }

    /**
     * Save video
     */
    async saveVideo(testId: string, buffer: Buffer): Promise<string> {
        const fileName = `video-${Date.now()}.webm`;
        const filePath = await this.saveFile(
            path.join('test-artifacts', testId, 'videos'),
            buffer,
            fileName
        );
        return filePath;
    }

    /**
     * Save report
     */
    async saveReport(ticketId: string, fileName: string, content: Buffer | string): Promise<string> {
        const filePath = await this.saveFile(
            path.join('reports', ticketId),
            content,
            fileName
        );
        return filePath;
    }

    /**
     * List files in directory
     */
    async listFiles(subPath: string): Promise<string[]> {
        try {
            const dir = path.join(this.baseDir, subPath);
            
            if (!fs.existsSync(dir)) {
                return [];
            }

            return fs.readdirSync(dir);
        } catch (error: any) {
            console.error('[LocalStorage] List error:', error.message);
            return [];
        }
    }

    /**
     * Get storage stats
     */
    async getStats() {
        const dirs = ['assets', 'test-artifacts', 'screenshots', 'videos', 'reports'];
        const stats: Record<string, { count: number; size: number }> = {};

        for (const dir of dirs) {
            const fullPath = path.join(this.baseDir, dir);
            if (fs.existsSync(fullPath)) {
                const files = fs.readdirSync(fullPath, { recursive: true }) as string[];
                let totalSize = 0;
                
                for (const file of files) {
                    const filePath = path.join(fullPath, file);
                    try {
                        const stat = fs.statSync(filePath);
                        if (stat.isFile()) {
                            totalSize += Number(stat.size);
                        }
                    } catch (e) {
                        // Skip if can't read
                    }
                }

                stats[dir] = {
                    count: files.length,
                    size: totalSize
                };
            }
        }

        return stats;
    }
}

// Export singleton instance
export const localStorageService = new LocalStorageService();
