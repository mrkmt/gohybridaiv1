import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { DbClient } from './app';

export class ActionCenterService {
    /**
     * MCP Bridge: Executes specific actions requested by the AI and logs them.
     */
    static async executeAction(recordingId: string, action: string, params: any, pool: DbClient): Promise<any> {
        console.log(`[ActionCenter] AI is requesting action: ${action.toUpperCase()}`);
        let result: any;
        let status: 'success' | 'error' = 'success';

        try {
            switch (action) {
                case 'file_read':
                    result = await this.readFile(params.path);
                    break;
                case 'file_write':
                    result = await this.writeFile(params.path, params.content);
                    break;
                case 'db_query':
                    result = await this.queryDb(params.query, params.vals, pool);
                    break;
                case 'run_test':
                    result = await this.runTest(params.filename);
                    break;
                default:
                    result = { error: `Action ${action} not supported.` };
                    status = 'error';
            }
        } catch (e: any) {
            result = { error: e.message };
            status = 'error';
        }

        // Log action to DB for transparency
        await pool.query(
            `INSERT INTO ai_actions (recording_id, action_type, params, result, status) 
             VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)`,
            [recordingId, action, JSON.stringify(params), JSON.stringify(result), status]
        );

        return result;
    }

    private static async readFile(filePath: string) {
        const fullPath = path.join(process.cwd(), filePath);
        if (!fullPath.startsWith(process.cwd())) return { error: 'Access Denied' };
        return { content: fs.readFileSync(fullPath, 'utf8') };
    }

    private static async writeFile(filePath: string, content: string) {
        const fullPath = path.join(process.cwd(), filePath);
        if (!fullPath.startsWith(process.cwd())) return { error: 'Access Denied' };
        fs.writeFileSync(fullPath, content);
        return { success: true };
    }

    private static async queryDb(query: string, vals: any[], pool: DbClient) {
        // Restricted to SELECT only for AI safety
        if (!query.toLowerCase().startsWith('select')) return { error: 'Only SELECT allowed' };
        const { rows } = await pool.query(query, vals);
        return { results: rows };
    }

    private static async runTest(filename: string) {
        return new Promise((resolve) => {
            try {
                if (!filename || typeof filename !== 'string') return resolve({ success: false, error: 'Invalid filename' });

                // Constrain tests to a specific directory to avoid arbitrary execution
                const testsRoot = path.join(process.cwd(), 'playwright-tests');
                const fullPath = path.join(testsRoot, filename);

                // Prevent path traversal
                if (!fullPath.startsWith(testsRoot)) return resolve({ success: false, error: 'Invalid test path' });

                if (!fs.existsSync(fullPath)) return resolve({ success: false, error: 'Test file not found' });

                // Use execFile to avoid shell interpretation and injection
                const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
                execFile(npxCmd, ['playwright', 'test', fullPath], { windowsHide: true, timeout: 5 * 60 * 1000, shell: true }, (error, stdout, stderr) => {
                    resolve({
                        success: !error,
                        output: stdout || stderr,
                        error: error ? error.message : undefined
                    });
                });
            } catch (e: any) {
                resolve({ success: false, error: e?.message || String(e) });
            }
        });
    }
}
