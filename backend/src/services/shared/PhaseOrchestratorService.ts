import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ReproductionPlanService, ReproductionPlanRequestSchema } from '../../../api/ReproductionPlanService';
// Phase3PlaywrightGenerationService has been retired. The Phase 3 block below
// now fails fast with a migration message rather than invoking the throwing
// stub. New pipeline: TestingWorkflowController → TestingGenerationService →
// JsonTestGenerationService → JsonToPlaywrightCompiler.
import { JiraAutomationService } from '../jira/JiraAutomationService';
import { MultiAgentRouter } from '../../../api/MultiAgentRouter';

// ═══════════════════════════════════════════════════════════════════════════════
// Phase State Machine
// ═══════════════════════════════════════════════════════════════════════════════

export type PhaseStatus = 'IDLE' | 'INGESTED' | 'PLANNED' | 'SCRIPTED' | 'EXECUTING' | 'COMPLETED' | 'FAILED';

export interface PhaseState {
    jiraId: string;
    runId: string;
    currentPhase: PhaseStatus;
    phase2Result?: { steps: string[]; targetRuleId?: string; aiModel?: string };
    phase3Result?: { testScript: string; modelUsed?: string };
    phase4Result?: { status: string; testId?: string; duration?: number; failedTests?: any[] };
    config: {
        baseUrl: string;
        customerId: string;
        targetEnv: 'testing' | 'uat' | 'live';
        credentials: { idNumber: string; username: string; password: string };
    };
    ticket?: { summary?: string; description?: any };
    sanitizedSteps?: any[];
    detectedForms?: any[];
    detectedRules?: any[];
    error?: string;
    createdAt: string;
    lastUpdated: string;
}

const PHASE_ORDER: PhaseStatus[] = ['IDLE', 'INGESTED', 'PLANNED', 'SCRIPTED', 'EXECUTING', 'COMPLETED'];

// ═══════════════════════════════════════════════════════════════════════════════
// Orchestrator Service
// ═══════════════════════════════════════════════════════════════════════════════

export class PhaseOrchestratorService {
    private static stateDir = path.join(process.cwd(), 'local_storage', 'phase_state');

    // ─── State Persistence ─────────────────────────────────────────────────────

    private static ensureStateDir(): void {
        if (!fs.existsSync(this.stateDir)) {
            fs.mkdirSync(this.stateDir, { recursive: true });
        }
    }

    private static getStatePath(jiraId: string): string {
        return path.join(this.stateDir, `${jiraId.replace(/[^a-zA-Z0-9-]/g, '_')}.json`);
    }

    static loadState(jiraId: string): PhaseState | null {
        const filePath = this.getStatePath(jiraId);
        if (!fs.existsSync(filePath)) return null;
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch {
            console.warn(`[Orchestrator] Failed to load state for ${jiraId}`);
            return null;
        }
    }

    static saveState(state: PhaseState): void {
        this.ensureStateDir();
        state.lastUpdated = new Date().toISOString();
        fs.writeFileSync(this.getStatePath(state.jiraId), JSON.stringify(state, null, 2), 'utf8');
        console.log(`[Orchestrator] State saved: ${state.jiraId} → ${state.currentPhase}`);
    }

    static listStates(): PhaseState[] {
        this.ensureStateDir();
        return fs.readdirSync(this.stateDir)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                try { return JSON.parse(fs.readFileSync(path.join(this.stateDir, f), 'utf8')); }
                catch { return null; }
            })
            .filter(Boolean);
    }

    // ─── Phase Transitions ─────────────────────────────────────────────────────

    /**
     * Run the orchestrated flow from the current phase forward.
     * Supports resume: if a previous run failed at Phase 3, calling this again
     * will skip Phase 2 (using cached results) and start from Phase 3.
     */
    static async orchestrate(params: {
        jiraId: string;
        ticket?: { summary?: string; description?: any };
        sanitizedSteps?: any[];
        detectedForms?: any[];
        detectedRules?: any[];
        baseUrl: string;
        customerId: string;
        targetEnv: 'testing' | 'uat' | 'live';
        credentials: { idNumber: string; username: string; password: string };
        startFromPhase?: PhaseStatus;
        model?: string;
    }): Promise<PhaseState> {
        // Apply temporary role overrides if a specific model is requested
        if (params.model) {
            MultiAgentRouter.setRoleOverride('INVESTIGATOR', params.model);
            MultiAgentRouter.setRoleOverride('CODER', params.model);
            MultiAgentRouter.setRoleOverride('ANALYST', params.model);
            MultiAgentRouter.setRoleOverride('REVIEWER', params.model);
            console.log(`[Orchestrator] Temporary role overrides set to: ${params.model}`);
        }
        // Load existing state or create new
        let state = this.loadState(params.jiraId);

        if (!state || params.startFromPhase === 'IDLE') {
            state = {
                jiraId: params.jiraId,
                runId: uuidv4(),
                currentPhase: 'IDLE',
                config: {
                    baseUrl: params.baseUrl,
                    customerId: params.customerId,
                    targetEnv: params.targetEnv,
                    credentials: params.credentials,
                },
                ticket: params.ticket,
                sanitizedSteps: params.sanitizedSteps || [],
                detectedForms: params.detectedForms || [],
                detectedRules: params.detectedRules || [],
                createdAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
            };
        } else {
            // Update config with latest values (credentials may have changed)
            state.config = {
                baseUrl: params.baseUrl,
                customerId: params.customerId,
                targetEnv: params.targetEnv,
                credentials: params.credentials,
            };
            if (params.ticket) state.ticket = params.ticket;
        }

        // Override start phase if specified
        if (params.startFromPhase && params.startFromPhase !== 'IDLE') {
            const idx = PHASE_ORDER.indexOf(params.startFromPhase);
            if (idx > 0) {
                state.currentPhase = PHASE_ORDER[idx - 1]; // Set to the phase before, so the loop will execute it
            }
        }

        this.saveState(state);

        // ── Phase 2: Reproduction Plan ──────────────────────────────────────
        if (this.shouldRunPhase(state, 'PLANNED')) {
            try {
                console.log(`[Orchestrator] ${state.jiraId} → Phase 2: Generating reproduction plan...`);
                const planResult = await ReproductionPlanService.generateBddPlan({
                    jiraId: state.jiraId,
                    ticket: state.ticket,
                    sanitizedSteps: state.sanitizedSteps || [],
                    detectedForms: state.detectedForms,
                    detectedRules: state.detectedRules,
                    url: state.config.baseUrl,
                    customerId: state.config.customerId,
                    environmentType: state.config.targetEnv === 'live' ? 'Production' : state.config.targetEnv === 'uat' ? 'Staging' : 'Development',
                    idNumber: state.config.credentials.idNumber,
                    username: state.config.credentials.username,
                    password: state.config.credentials.password,
                });

                state.phase2Result = planResult;
                state.currentPhase = 'PLANNED';
                state.error = undefined;
                this.saveState(state);

                // Jira feedback
                await this.commentToJira(state.jiraId,
                    `✅ **Phase 2 Complete**: Reproduction plan generated (${planResult.steps.length} BDD steps). Ready for review.`
                );
            } catch (err: any) {
                state.currentPhase = 'FAILED';
                state.error = `Phase 2 failed: ${err.message}`;
                this.saveState(state);
                await this.commentToJira(state.jiraId, `❌ **Phase 2 Failed**: ${err.message}`);
                return state;
            }
        }

        // ── Phase 3: Playwright Script Generation ───────────────────────────
        if (this.shouldRunPhase(state, 'SCRIPTED')) {
            if (!state.phase2Result?.steps?.length) {
                state.currentPhase = 'FAILED';
                state.error = 'Cannot run Phase 3 without Phase 2 results.';
                this.saveState(state);
                return state;
            }

            // Phase 3 legacy path is DEPRECATED. The Phase3PlaywrightGeneration
            // service was retired in the services reorganisation. Callers that
            // need Playwright generation should drive it through the new
            // pipeline: TestingWorkflowController → TestingGenerationService →
            // JsonTestGenerationService → JsonToPlaywrightCompiler.
            console.warn(`[Orchestrator] ${state.jiraId} → Phase 3 SKIPPED: legacy script generation retired. Use TestingWorkflowController flow.`);
            state.currentPhase = 'FAILED';
            state.error = 'Phase 3 retired: use TestingWorkflowController (new generation pipeline) instead of the legacy Phase3 orchestrator path.';
            this.saveState(state);
            await this.commentToJira(
                state.jiraId,
                '⚠️ **Phase 3 legacy path retired** — run this ticket through the new Testing Workflow (chat-driven generation) to produce an executable Playwright script.'
            );
            return state;
        }

        // ── Phase 4: Execution ──────────────────────────────────────────────
        // Phase 4 is intentionally NOT auto-executed by the orchestrator.
        // It requires the user (or the /api/execute-test endpoint) to trigger
        // because it spawns a Playwright process and needs environment setup.
        // The orchestrator prepares everything up to "SCRIPTED", then the
        // execute-test endpoint handles the actual execution.

        if (state.currentPhase === 'SCRIPTED') {
            console.log(`[Orchestrator] ${state.jiraId} → Ready for Phase 4 execution.`);
        }

        // Cleanup temporary role overrides
        if (params.model) {
            MultiAgentRouter.clearRoleOverrides();
        }

        return state;
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────

    private static shouldRunPhase(state: PhaseState, targetPhase: PhaseStatus): boolean {
        const currentIdx = PHASE_ORDER.indexOf(state.currentPhase);
        const targetIdx = PHASE_ORDER.indexOf(targetPhase);
        return currentIdx < targetIdx;
    }

    /**
     * Mark Phase 4 as complete (called by the execute-test endpoint).
     */
    static markPhase4Complete(jiraId: string, result: { status: string; testId?: string; duration?: number; failedTests?: any[] }): void {
        const state = this.loadState(jiraId);
        if (!state) return;

        state.phase4Result = result;
        state.currentPhase = result.status === 'passed' ? 'COMPLETED' : 'FAILED';
        if (result.status !== 'passed') {
            state.error = `Phase 4: Test ${result.status}`;
        } else {
            state.error = undefined;
        }
        this.saveState(state);
    }

    private static async commentToJira(jiraId: string, message: string): Promise<void> {
        // Only comment if jiraId looks like a real ticket
        if (!/^[A-Z]+-\d+$/.test(jiraId)) return;

        try {
            await JiraAutomationService.addComment(jiraId, message);
        } catch (err: any) {
            console.warn(`[Orchestrator] Jira comment failed for ${jiraId}: ${err.message}`);
        }
    }
}
