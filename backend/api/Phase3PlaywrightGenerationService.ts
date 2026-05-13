/**
 * RETIRED STUB — Phase3PlaywrightGenerationService.
 *
 * STATUS (2026-04-22): All server-boot-path callers have been migrated off.
 *   - `api/routes/coreRoutes.ts` — import removed (was dead).
 *   - `src/services/shared/PhaseOrchestratorService.ts` — Phase 3 block now
 *     short-circuits with a clear deprecation message instead of invoking
 *     this stub.
 *
 * This file is kept ONLY so two dev-only scripts still type-check:
 *   - `api/demo-script.ts`
 *   - `src/scripts/test-intelligence-resolver.ts`
 * Neither is part of the production server. Delete this file (and those
 * scripts) when/if they're no longer needed. Callers that somehow reach
 * `generateAndSave()` will get a clear error pointing them at the new
 * pipeline: TestingWorkflowController → TestingGenerationService →
 * JsonTestGenerationService → JsonToPlaywrightCompiler.
 */

import { z } from 'zod';

export const Phase3GenerateSchema = z.object({
  jiraId: z.string(),
  planSteps: z.array(z.any()).optional(),
  targetEnv: z.string().optional(),
  baseUrl: z.string().optional(),
  customerId: z.string().optional(),
  testIdNumber: z.string().optional(),
  testUsername: z.string().optional(),
  testPassword: z.string().optional(),
}).passthrough();

export type Phase3GenerateInput = z.infer<typeof Phase3GenerateSchema>;

export const Phase3PlaywrightGenerationService = {
  async generateAndSave(_input: Phase3GenerateInput): Promise<never> {
    throw new Error(
      'Phase3PlaywrightGenerationService.generateAndSave is not implemented. ' +
      'The service was removed during reorganisation. ' +
      'Use the new generation pipeline (JsonTestGenerationService + JsonToPlaywrightCompiler) instead.'
    );
  },
};
