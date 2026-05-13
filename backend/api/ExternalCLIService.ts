import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Allowed CLI commands that can be executed.
 * Only these commands are permitted - prevents arbitrary command execution.
 */
const ALLOWED_CLI_COMMANDS = new Set(['qwen', 'codex', 'gemini']);

/**
 * External CLI Service
 * Bridge to execute local AI CLI tools (Qwen, Gemini, Codex).
 * SECURITY: Command allowlist prevents arbitrary command execution.
 */
export class ExternalCLIService {
    /**
     * Validates that a CLI command is in the allowed list.
     */
    private static validateCommand(command: string): void {
        const baseCommand = command.trim().toLowerCase();
        if (!ALLOWED_CLI_COMMANDS.has(baseCommand)) {
            throw new Error(`CLI command "${command}" not in allowed list. Allowed: ${[...ALLOWED_CLI_COMMANDS].join(', ')}`);
        }
    }

    /**
     * Executes a CLI chat command using stdin pipe.
     * ALWAYS uses `-p -` with stdin to avoid CLI confusion between
     * interactive mode (positional query) and non-interactive mode (-p flag).
     */
    static async chat(command: string, prompt: string, timeoutMs: number = 120000): Promise<string> {
        // SECURITY: Validate command against allowlist
        this.validateCommand(command);

        console.log(`[CLI Service] Executing: ${command} (timeout: ${timeoutMs}ms, ${prompt.length} chars)`);

        const isWindows = process.platform === 'win32';

        return new Promise((resolve, reject) => {
            try {
                // ALWAYS use -p - with stdin pipe for non-interactive mode
                // This avoids CLI confusion between positional query and -p flag
                const child = spawn(command, ['-p', '-'], {
                    shell: isWindows,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: { ...process.env, FORCE_COLOR: '0' }
                });

                let stdout = '';
                let stderr = '';

                const timeout = setTimeout(() => {
                    child.kill('SIGTERM');
                    reject(new Error(`CLI timeout after ${timeoutMs}ms`));
                }, timeoutMs);

                // Handle stdout
                if (child.stdout) child.stdout.on('data', (data) => {
                    stdout += data.toString();
                });

                // Handle stderr
                if (child.stderr) child.stderr.on('data', (data) => {
                    stderr += data.toString();
                });

                // Pipe prompt to stdin
                if (child.stdin) {
                    child.stdin.write(prompt);
                    child.stdin.end();
                }

                child.on('close', (code) => {
                    clearTimeout(timeout);

                    if (code === 0 || stdout.length > 0) {
                        console.log(`[CLI Service] Completed with ${stdout.length} chars`);
                        resolve(stdout.trim());
                    } else {
                        reject(new Error(`CLI exited with code ${code}: ${stderr.substring(0, 500)}`));
                    }
                });

                child.on('error', (err) => {
                    clearTimeout(timeout);
                    reject(new Error(`CLI spawn error: ${err.message}`));
                });

            } catch (error: any) {
                reject(new Error(`CLI execution failed: ${error.message}`));
            }
        });
    }

    /**
     * Legacy method: Executes via temp file (fallback for problematic CLIs).
     * SECURITY: command allowlist + no shell execution.
     */
    static async chatViaFile(command: string, prompt: string, timeoutMs: number = 60000): Promise<string> {
        this.validateCommand(command);

        console.log(`[CLI Service] Executing via file: ${command}`);

        try {
            const tmpFile = path.join(os.tmpdir(), `prompt_${Date.now()}.txt`);
            fs.writeFileSync(tmpFile, prompt, 'utf8');

            // SECURITY: use spawn with file redirect instead of shell exec
            return new Promise((resolve, reject) => {
                const child = spawn(command, {
                    shell: false,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: { ...process.env }
                });

                let stdout = '';
                let stderr = '';

                const timeout = setTimeout(() => {
                    child.kill('SIGTERM');
                    reject(new Error(`CLI timeout after ${timeoutMs}ms`));
                }, timeoutMs);

                // Feed the file content to stdin
                const fileContent = fs.readFileSync(tmpFile, 'utf8');
                child.stdin.write(fileContent);
                child.stdin.end();

                child.stdout.on('data', (data) => { stdout += data.toString(); });
                child.stderr.on('data', (data) => { stderr += data.toString(); });

                child.on('close', (code) => {
                    clearTimeout(timeout);
                    // Cleanup
                    try { fs.unlinkSync(tmpFile); } catch {}
                    if (code === 0 || stdout.length > 0) {
                        resolve(stdout.trim());
                    } else {
                        reject(new Error(`CLI exited with code ${code}: ${stderr}`));
                    }
                });

                child.on('error', (err) => {
                    clearTimeout(timeout);
                    // Cleanup
                    try { fs.unlinkSync(tmpFile); } catch {}
                    reject(new Error(`CLI spawn error: ${err.message}`));
                });
            });
        } catch (error: any) {
            throw new Error(`CLI Execution failed: ${error.message || error}`);
        }
    }
}
