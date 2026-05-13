import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import fetch from 'node-fetch';
import { config } from './config';

export interface ProviderStatus {
    id: string;
    name: string;
    installed: boolean;
    authenticated: boolean;
    authPath: string;
    version?: string;
    message?: string;
    apiType?: 'cli' | 'openai' | 'gemini';
    model?: string;
    isLocal?: boolean;
    modelSize?: string | null;
}

export class AIProviderService {
    private static authPaths = {
        qwen: path.join(os.homedir(), '.qwen', 'oauth_creds.json'),
        gemini: path.join(os.homedir(), '.gemini', 'oauth_creds.json'),
        codex: path.join(os.homedir(), '.codex', 'auth.json')
    };

    /**
     * Get statuses for all providers: CLI tools only.
     */
    static async getStatuses(): Promise<ProviderStatus[]> {
        return this.getCliStatuses();
    }

    /**
     * Get CLI provider statuses (Qwen, Gemini, Codex).
     */
    static getCliStatuses(): ProviderStatus[] {
        return [
            this.checkCliProvider('qwen', 'Qwen CLI'),
            this.checkCliProvider('gemini', 'Gemini CLI'),
            this.checkCliProvider('codex', 'Codex CLI')
        ];
    }

    private static checkCliProvider(id: string, name: string): ProviderStatus {
        let installed = false;
        let version = '';
        const authPath = (this.authPaths as any)[id];
        let authenticated = fs.existsSync(authPath);

        try {
            const cmd = id === 'codex' ? 'codex --version' : `${id} --version`;
            version = execSync(cmd, { stdio: 'pipe' }).toString().trim();
            installed = true;
        } catch (e) {
            installed = false;
        }

        let message = '';
        if (!installed) message = 'CLI not found in PATH';
        else if (!authenticated) message = 'Needs authentication (run login command)';
        else message = 'Ready to use';

        return {
            id,
            name,
            installed,
            authenticated,
            authPath,
            version,
            message,
            apiType: 'cli',
            model: id,
            isLocal: false,
            modelSize: null
        };
    }

}
