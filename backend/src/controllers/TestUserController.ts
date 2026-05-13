import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

export interface TestUser {
    id: string;
    idNumber: string;
    username: string;
    password: string;
    userLevel: 'Admin' | 'HR-Manager' | 'Employee' | 'Supervisor';
    label: string;
    targetEnv?: 'testing' | 'uat' | 'live';
    baseUrl?: string;
    customerId?: string;
    isDefault?: boolean;
    in_use?: boolean;
    locked_at?: string;
}

export class TestUserController {
    private static FILE_PATH = path.join(process.cwd(), 'test-users.json');

    private static read(): TestUser[] {
        if (!fs.existsSync(this.FILE_PATH)) {
            const defaults: TestUser[] = [
                { 
                    id: '1', idNumber: 'ADMIN01', username: 'admin_test', password: 'password123', 
                    userLevel: 'Admin', label: 'Default System Admin', isDefault: true, in_use: false,
                    targetEnv: 'testing', baseUrl: 'https://www.globalhr.app', customerId: 'demo'
                },
                { 
                    id: '2', idNumber: 'HR01', username: 'hr_test', password: 'password123', 
                    userLevel: 'HR-Manager', label: 'HR Manager Account', in_use: false,
                    targetEnv: 'testing', baseUrl: 'https://www.globalhr.app', customerId: 'demo'
                },
                { 
                    id: '3', idNumber: 'EMP01', username: 'emp_test', password: 'password123', 
                    userLevel: 'Employee', label: 'Standard Employee', in_use: false,
                    targetEnv: 'testing', baseUrl: 'https://www.globalhr.app', customerId: 'demo'
                }
            ];
            fs.writeFileSync(this.FILE_PATH, JSON.stringify(defaults, null, 2));
            return defaults;
        }
        return JSON.parse(fs.readFileSync(this.FILE_PATH, 'utf8'));
    }

    private static write(users: TestUser[]) {
        fs.writeFileSync(this.FILE_PATH, JSON.stringify(users, null, 2));
    }

    static async lockUser(idNumber: string): Promise<boolean> {
        const users = this.read();
        const user = users.find(u => u.idNumber === idNumber);
        
        if (!user) return false;
        
        // If locked for more than 5 minutes, auto-unlock (prevent permanent lockouts from crashed tests)
        if (user.in_use && user.locked_at) {
            const lockedTime = new Date(user.locked_at).getTime();
            if (Date.now() - lockedTime < 5 * 60 * 1000) {
                return false; // Still locked
            }
        }
        
        user.in_use = true;
        user.locked_at = new Date().toISOString();
        this.write(users);
        return true;
    }

    static async unlockUser(idNumber: string): Promise<void> {
        const users = this.read();
        const user = users.find(u => u.idNumber === idNumber);
        if (user) {
            user.in_use = false;
            user.locked_at = undefined;
            this.write(users);
        }
    }

    static async list(req: Request, res: Response) {
        try {
            res.json(this.read());
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    }

    static async save(req: Request, res: Response) {
        try {
            const user = req.body;
            if (!user.idNumber || !user.userLevel) return res.status(400).json({ error: 'Missing required fields' });

            const users = this.read();
            if (user.id) {
                const idx = users.findIndex(u => u.id === user.id);
                if (idx >= 0) users[idx] = user;
                else users.push({ ...user, id: Date.now().toString() });
            } else {
                users.push({ ...user, id: Date.now().toString() });
            }

            // Ensure only one default per level if needed, or just save
            this.write(users);
            res.json({ success: true, users });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    }

    static async delete(req: Request, res: Response) {
        try {
            const { id } = req.params;
            let users = this.read();
            users = users.filter(u => u.id !== id);
            this.write(users);
            res.json({ success: true, users });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    }
}
