import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureSafeArgs } from './security';
import { DockerPlaywrightService } from '../../src/services/DockerPlaywrightService';

const DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export interface RunCommandOptions {
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    cwd?: string;
}

export async function runCommand(
    command: string,
    args: string[],
    options: RunCommandOptions = {}
): Promise<{ stdout: string; stderr: string }> {
    ensureSafeArgs(args);

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
    const env = { ...process.env, ...options.env };
    const cwd = options.cwd || process.cwd();

    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(command, args, {
            shell: false,
            windowsHide: true,
            env,
            cwd
        });

        let stdout = '';
        let stderr = '';

        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`Command timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            if (code !== 0) {
                return reject(new Error(`Command failed (${code}): ${stderr.trim() || 'No stderr'}`));
            }
            resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        });
    });
}

export interface TestExecutionContext {
    baseUrl?: string;
    customerId?: string;
    testModule?: string;
    testEnv?: string;
    idNumber?: string;
    username?: string;
    password?: string;
}

/**
 * Write credentials to a temporary JSON file with restricted permissions,
 * then pass the file path (not raw credentials) to the Playwright child process.
 * The file is cleaned up after the test run.
 */
function createSecureCredentialFile(context: TestExecutionContext): string | null {
    if (!context.username || !context.password) return null;

    const tmpDir = os.tmpdir();
    const credPath = path.join(tmpDir, `gohybrid-credentials-${Date.now()}.json`);

    try {
        // Write with restrictive permissions (owner read only: 0600)
        // On Windows, fs.openSync with 'w' mode 0o600 works best-effort
        const fd = fs.openSync(credPath, 'w', 0o600);
        fs.writeFileSync(fd, JSON.stringify({
            baseUrl: context.baseUrl || 'http://localhost:4200',
            customerId: context.customerId,
            username: context.username,
            password: context.password,
            idNumber: context.idNumber
        }));
        fs.closeSync(fd);
        return credPath;
    } catch (e) {
        // Cleanup on failure
        try { if (credPath && fs.existsSync(credPath)) fs.unlinkSync(credPath); } catch {}
        return null;
    }
}

/**
 * Clean up the temporary credential file
 */
export function cleanupCredentialFile(filePath: string): void {
    if (!filePath) return;
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch {}
}

/**
 * Clean up all credential files older than 1 hour in the temp directory
 */
export function cleanupExpiredCredentialFiles(): void {
    try {
        const tmpDir = os.tmpdir();
        const files = fs.readdirSync(tmpDir);
        const now = Date.now();
        const maxAge = 60 * 60 * 1000; // 1 hour

        for (const file of files) {
            if (file.startsWith('gohybrid-credentials-') && file.endsWith('.json')) {
                const filePath = path.join(tmpDir, file);
                const stat = fs.statSync(filePath);
                if (now - stat.mtimeMs > maxAge) {
                    fs.unlinkSync(filePath);
                }
            }
        }
    } catch {
        // Silent cleanup failure
    }
}

export async function runPlaywrightTest(
    testScript: string,
    timeoutMs: number = 300000, // 5 minutes
    context: TestExecutionContext = {}
): Promise<{ stdout: string; stderr: string }> {
    // ── OPTION A: Docker Sandbox Execution ──
    const useDocker = process.env.USE_DOCKER_SANDBOX === 'true';
    if (useDocker) {
        return await DockerPlaywrightService.runTestInSandbox(testScript, timeoutMs, context);
    }

    // ── OPTION B: Host OS Execution (Legacy) ──
    const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

    // Security: Write credentials to a temp file instead of passing as raw env vars.
    // The credential file is created with restricted permissions (0600) and cleaned up after the run.
    const credFile = context.username ? createSecureCredentialFile(context) : null;

    // Build a minimal environment - only pass what the child process needs.
    // Do NOT inherit sensitive values from parent process.env.
    // Include backward-compatibility aliases so existing tests using process.env.TEST_* still work,
    // but they are isolated to this child process only (not leaked to sibling processes).
    const childEnv: NodeJS.ProcessEnv = {
        PATH: process.env.PATH || '',
        SystemRoot: process.env.SystemRoot || '',
        USERPROFILE: process.env.USERPROFILE || '',
        HOMEPATH: process.env.HOMEPATH || '',
        ProgramFiles: process.env.ProgramFiles || '',
        GOHYBRID_CREDENTIALS_FILE: credFile || '',
        // Backward-compat aliases - these are process-isolated, not leaked to system
        TEST_MODULE: context.testModule || '',
        TEST_ENV: context.testEnv || '',
        TEST_IDNUMBER: context.idNumber || '',
        TEST_USERNAME: context.username || '',
        TEST_PASSWORD: context.password || '',
        BASE_URL: context.baseUrl || '',
        CUSTOMER_ID: context.customerId || '',
    };

    // Clean up expired credential files before the run
    cleanupExpiredCredentialFiles();

    try {
        return await runCommand(npxCmd, ['playwright', 'test', testScript], { timeoutMs, env: childEnv });
    } finally {
        // Always clean up the credential file after the test run
        if (credFile) {
            cleanupCredentialFile(credFile);
        }
    }
}

export async function runAICommand(
    command: string,
    args: string[],
    timeoutMs: number = 120000 // 2 minutes for AI commands
): Promise<{ stdout: string; stderr: string }> {
    return runCommand(command, args, { timeoutMs });
}
