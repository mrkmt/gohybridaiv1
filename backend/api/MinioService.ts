/**
 * MinioService (Deprecated - Use LocalStorageService)
 * 
 * Backward compatibility wrapper - redirects to LocalStorageService
 */

import { localStorageService, LocalStorageService } from './LocalStorageService';

// Re-export LocalStorageService as MinioService for backward compatibility
export class MinioService {
    private localStorage: LocalStorageService;

    constructor() {
        this.localStorage = localStorageService;
        console.log('[MinioService] Using LocalStorageService (MinIO deprecated)');
    }

    async uploadFile(objectName: string, buffer: Buffer, metaData: any = {}): Promise<string> {
        const parts = objectName.split('/');
        const fileName = parts.pop() || 'file';
        const subPath = parts.join('/');
        
        await this.localStorage.saveFile(subPath, buffer, fileName);
        return objectName;
    }

    async saveScreenshot(testId: string, buffer: Buffer): Promise<string> {
        return await this.localStorage.saveScreenshot(testId, buffer);
    }

    async saveVideo(testId: string, buffer: Buffer): Promise<string> {
        return await this.localStorage.saveVideo(testId, buffer);
    }

    async saveReport(ticketId: string, fileName: string, content: Buffer | string): Promise<string> {
        return await this.localStorage.saveReport(ticketId, fileName, content);
    }

    async readFile(subPath: string, fileName: string): Promise<Buffer> {
        return await this.localStorage.readFile(subPath, fileName);
    }

    async deleteFile(subPath: string, fileName: string): Promise<void> {
        await this.localStorage.deleteFile(subPath, fileName);
    }

    getPublicUrl(filePath: string): string {
        return this.localStorage.getPublicUrl(filePath);
    }
}

// Export singleton for backward compatibility
export const minioService = new MinioService();
