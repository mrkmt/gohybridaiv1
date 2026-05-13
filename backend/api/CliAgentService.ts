import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';
import { config } from './config';

const execAsync = promisify(exec);

export class CliAgentService {
    /**
     * Calls a local AI CLI (Gemini, Qwen, Codex) with the given prompt.
     * Writes prompt to a temp file and pipes it via stdin for OS compatibility.
     */
    static async generateFromCli(prompt: string, provider: 'qwen' | 'gemini' | 'codex'): Promise<string> {
        console.log(`[CLI Agent] Triggering ${provider} CLI (${prompt.length} chars)...`);

        try {
            return await new Promise<string>((resolve, reject) => {
                // Step 1: Try to resolve the actual binary path
                const cmd = this.resolveCliBinary(provider);

                console.log(`[CLI Agent] Resolved ${provider} binary: ${cmd}`);

                // Step 2: ALWAYS use -p - with stdin pipe for non-interactive mode
                // This avoids CLI confusion between positional query and -p flag
                const isWindows = process.platform === 'win32';
                const spawnArgs = ['-p', '-'];

                const proc = child_process.spawn(cmd, spawnArgs, {
                    shell: isWindows,  // shell needed on Windows for npm global paths (.cmd/.bat)
                    timeout: 300000, // 5-min timeout for large docs
                    windowsHide: isWindows,  // suppresses console popups only on Windows
                    stdio: ['pipe', 'pipe', 'pipe'], // keep all streams for type compatibility
                    env: { ...process.env, FORCE_COLOR: '0' } // disable colors in output
                });

                let stdout = '';
                let stderr = '';

                if (proc.stdout) proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
                if (proc.stderr) proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

                // Pipe prompt to stdin
                if (proc.stdin) {
                    proc.stdin.write(prompt);
                    proc.stdin.end();
                }

                proc.on('close', (code: number) => {
                    if (stdout.trim()) {
                        resolve(stdout.trim());
                    } else {
                        reject(new Error(`${cmd} exited with code ${code}. stderr: ${stderr.substring(0, 500)}`));
                    }
                });

                proc.on('error', (err: Error) => {
                    reject(new Error(`${cmd} process error: ${err.message}`));
                });

                proc.on('spawn', () => {
                    console.log(`[CLI Agent] ${provider} process spawned successfully`);
                });
            });

        } catch (error: any) {
            console.error(`[CLI Agent] Error executing ${provider}:`, error.message);
            throw new Error(`Failed to generate via ${provider} CLI: ${error.message}`);
        }
    }

    /**
     * Resolves the actual CLI binary path for the given provider.
     * Handles both Windows (npm global .cmd) and Ubuntu/Linux (global bin).
     * Falls back to bare provider name if custom path is a config directory.
     */
    private static resolveCliBinary(provider: 'qwen' | 'gemini' | 'codex'): string {
        const customPath = provider === 'qwen' ? config.knowledge.qwenPath :
                         provider === 'codex' ? config.knowledge.codexPath :
                         provider === 'gemini' ? config.knowledge.geminiPath : null;

        // If custom path exists and is a file, use it directly
        if (customPath && fs.existsSync(customPath)) {
            if (fs.statSync(customPath).isFile()) {
                return customPath;
            }

            // If it's a directory, look for common binary names inside it
            if (fs.statSync(customPath).isDirectory()) {
                const isWindows = process.platform === 'win32';

                // Try provider.exe / provider first
                const ext = isWindows ? '.exe' : '';
                const possibleBin = path.join(customPath, `${provider}${ext}`);
                if (fs.existsSync(possibleBin)) {
                    return possibleBin;
                }

                // On Windows, also try .cmd and .bat (npm global style)
                if (isWindows) {
                    for (const ext of ['.cmd', '.bat']) {
                        const possibleCmd = path.join(customPath, `${provider}${ext}`);
                        if (fs.existsSync(possibleCmd)) {
                            return possibleCmd;
                        }
                    }
                }
            }
        }

        // Fall back to global binary name
        // On Windows: npm installs create .cmd wrappers (e.g., gemini.cmd, qwen.cmd)
        // On Ubuntu/Linux: binaries are in PATH (e.g., gemini, qwen)
        const isWindows = process.platform === 'win32';
        return isWindows ? provider : provider;
    }
}
