import fs from 'fs';
import path from 'path';
import { config } from './config';

function splitSafeSegments(p: string): string[] {
    if (typeof p !== 'string') throw new Error('Invalid storage path');
    if (p.includes('\0')) throw new Error('Invalid storage path');

    const normalized = p.replace(/\\/g, '/');
    if (path.posix.isAbsolute(normalized)) throw new Error('Absolute paths are not allowed');

    const segments = normalized.split('/').filter(Boolean);
    for (const seg of segments) {
        if (seg === '.' || seg === '..') throw new Error('Path traversal is not allowed');
        if (/^[a-zA-Z]:$/.test(seg)) throw new Error('Invalid path segment');
    }
    return segments;
}

function encodePathSegments(p: string): string {
    return splitSafeSegments(p).map(encodeURIComponent).join('/');
}

export class StorageService {
    private readonly baseDir: string;
    private readonly publicRoute: string;

    constructor(opts?: { baseDir?: string; publicRoute?: string }) {
        this.baseDir = path.resolve(opts?.baseDir ?? config.storage.baseDir);
        this.publicRoute = opts?.publicRoute ?? config.storage.publicRoute;
    }

    async init(): Promise<void> {
        fs.mkdirSync(this.baseDir, { recursive: true });
    }

    private resolveOnDisk(objectName: string): string {
        const segments = splitSafeSegments(objectName);
        const resolved = path.resolve(this.baseDir, ...segments);
        if (!resolved.startsWith(this.baseDir + path.sep) && resolved !== this.baseDir) {
            throw new Error('Resolved path escapes storage base dir');
        }
        return resolved;
    }

    async uploadFile(objectName: string, buffer: Buffer): Promise<string> {
        const filePath = this.resolveOnDisk(objectName);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, buffer);
        return objectName;
    }

    async getFileBuffer(objectName: string): Promise<Buffer> {
        const filePath = this.resolveOnDisk(objectName);
        return await fs.promises.readFile(filePath);
    }

    async deleteFile(objectName: string): Promise<void> {
        const filePath = this.resolveOnDisk(objectName);
        try {
            await fs.promises.unlink(filePath);
        } catch (e: any) {
            if (e?.code === 'ENOENT') return;
            throw e;
        }
    }

    async deleteFolder(prefix: string): Promise<void> {
        const dirPath = this.resolveOnDisk(prefix);
        try {
            await fs.promises.rm(dirPath, { recursive: true, force: true });
        } catch (e: any) {
            if (e?.code === 'ENOENT') return;
            throw e;
        }
    }

    getPublicUrl(objectName: string, baseUrl: string): string {
        const encoded = encodePathSegments(objectName);
        const route = this.publicRoute.startsWith('/') ? this.publicRoute : `/${this.publicRoute}`;
        return `${baseUrl}${route}/${encoded}`;
    }
}

export const storageService = new StorageService();

