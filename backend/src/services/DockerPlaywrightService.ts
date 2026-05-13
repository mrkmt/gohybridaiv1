import { exec, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { TestExecutionContext } from '../../api/utils/secureRunner';
import { appLogger } from '../utils/logger';

export class DockerPlaywrightService {
    private static readonly DOCKER_IMAGE = 'mcr.microsoft.com/playwright:v1.59.1-jammy';
    private static readonly TMP_BASE = path.join(process.cwd(), 'tmp', 'docker-sandbox');

    private static activeContainers = 0;
    private static maxConcurrentContainers = process.env.MAX_CONCURRENT_CONTAINERS ? parseInt(process.env.MAX_CONCURRENT_CONTAINERS, 10) : 3;
    private static queue: Array<() => void> = [];

    /**
     * Executes a Playwright test script inside an ephemeral Docker container.
     */
    static async runTestInSandbox(
        testScript: string,
        timeoutMs: number = 300000,
        context: TestExecutionContext = {}
    ): Promise<{ stdout: string; stderr: string }> {
        // 1. Queue management
        if (this.activeContainers >= this.maxConcurrentContainers) {
            appLogger.info(`[DockerSandbox] Max concurrent containers reached (${this.maxConcurrentContainers}), queuing test...`);
            await new Promise<void>(resolve => this.queue.push(resolve));
        }

        this.activeContainers++;
        const id = uuidv4();
        const sandboxDir = path.join(this.TMP_BASE, id);
        const scriptPath = path.join(sandboxDir, 'test.spec.ts');
        const credPath = path.join(sandboxDir, 'credentials.json');

        try {
            // 2. Prepare sandbox directory
            if (!fs.existsSync(sandboxDir)) {
                fs.mkdirSync(sandboxDir, { recursive: true });
            }

            // 3. Write test script and credentials
            fs.writeFileSync(scriptPath, testScript);
            fs.writeFileSync(credPath, JSON.stringify({
                baseUrl: context.baseUrl || 'http://localhost:4200',
                customerId: context.customerId,
                username: context.username,
                password: context.password,
                idNumber: context.idNumber,
                testModule: context.testModule,
                testEnv: context.testEnv
            }));

            // 4. Construct Docker command
            const projectRoot = process.cwd();
            const containerAppDir = '/app';
            
            const dockerArgs = [
                'run', '--rm',
                '--name', `gohybrid-sandbox-${id}`,
                '-v', `${sandboxDir}:${containerAppDir}/sandbox`,
                '-v', `${path.join(projectRoot, 'tests', 'playwright')}:${containerAppDir}/tests/playwright`,
                '-v', `${path.join(projectRoot, 'playwright.config.ts')}:${containerAppDir}/playwright.config.ts`,
                '-v', `${path.join(projectRoot, 'package.json')}:${containerAppDir}/package.json`,
                '-v', `${path.join(projectRoot, 'tsconfig.json')}:${containerAppDir}/tsconfig.json`,
                '-e', `GOHYBRID_CREDENTIALS_FILE=${containerAppDir}/sandbox/credentials.json`,
                '-e', `TEST_MODULE=${context.testModule || ''}`,
                '-e', `TEST_ENV=${context.testEnv || ''}`,
                '-w', containerAppDir,
                this.DOCKER_IMAGE,
                'npx', 'playwright', 'test', 'sandbox/test.spec.ts'
            ];

            appLogger.info(`[DockerSandbox] [${id}] Active containers: ${this.activeContainers}/${this.maxConcurrentContainers}`);
            
            return await new Promise((resolve, reject) => {
                const child = spawn('docker', dockerArgs, { shell: false });
                
                let stdout = '';
                let stderr = '';

                const timer = setTimeout(() => {
                    appLogger.warn(`[DockerSandbox] [${id}] Timeout reached, killing container...`);
                    exec(`docker kill gohybrid-sandbox-${id}`, (err) => {
                        if (err) appLogger.error(`[DockerSandbox] [${id}] Failed to kill container: ${err.message}`);
                    });
                    reject(new Error(`Docker execution timed out after ${timeoutMs}ms`));
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
                        return reject(new Error(`Docker execution failed (${code}): ${stderr.trim() || 'No stderr'}`));
                    }
                    resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
                });
            });

        } finally {
            // 5. Cleanup
            this.activeContainers--;
            appLogger.info(`[DockerSandbox] [${id}] Container finished. Active: ${this.activeContainers}/${this.maxConcurrentContainers}`);

            try {
                if (fs.existsSync(sandboxDir)) {
                    fs.rmSync(sandboxDir, { recursive: true, force: true });
                }
            } catch (err: any) {
                appLogger.warn(`[DockerSandbox] [${id}] Cleanup failed: ${err.message}`);
            }

            // 6. Release next in queue
            if (this.queue.length > 0) {
                const next = this.queue.shift();
                if (next) {
                    appLogger.info(`[DockerSandbox] Releasing next test from queue (${this.queue.length} remaining)`);
                    next();
                }
            }
        }
    }
}
