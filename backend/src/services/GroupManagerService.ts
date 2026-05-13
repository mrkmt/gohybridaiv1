import * as fs from 'fs';
import * as path from 'path';

export interface RegisteredGroup {
    id: number;
    title: string;
    added_at: string;
}

export class GroupManagerService {
    private static filePath = path.join(process.cwd(), 'active_groups.json');

    static getAll(): RegisteredGroup[] {
        if (!fs.existsSync(this.filePath)) return [];
        try {
            return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        } catch {
            return [];
        }
    }

    /**
     * Registers a group. Returns true if newly added, false if already exists.
     */
    static register(id: number, title: string): boolean {
        const groups = this.getAll();
        const alreadyExists = groups.some(g => g.id === id);
        if (alreadyExists) return false;

        groups.push({ id, title, added_at: new Date().toISOString() });
        fs.writeFileSync(this.filePath, JSON.stringify(groups, null, 2), 'utf8');
        console.log(`[GroupManager] Registered group: "${title}" (${id})`);
        return true;
    }

    static remove(id: number): boolean {
        const groups = this.getAll().filter(g => g.id !== id);
        fs.writeFileSync(this.filePath, JSON.stringify(groups, null, 2), 'utf8');
        return true;
    }
}
