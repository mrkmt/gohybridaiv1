import { MultiAgentRouter } from '../../../api/MultiAgentRouter';
import type { TokenUsage } from '../../../api/MultiAgentRouter';

export type CliModel = 'qwen' | 'gemini' | 'codex';
export type { TokenUsage };

export type AiRole =
  | 'TEST_GENERATION'
  | 'CODE'
  | 'INVESTIGATOR'
  | 'REASONING'
  | 'DOCUMENTATION'
  | 'QUICK'
  | 'BUSINESS_LOGIC'
  | 'ARCHITECT'
  | 'REVIEWER'
  | 'ANALYST';

export class AiControllerService {

  /**
   * Generate AI response for a given role.
   * Delegates to MultiAgentRouter for consistent routing and fallback.
   */
  static async generate(role: AiRole, prompt: string, structured: boolean = false): Promise<string> {
    const timeoutMs = 180000; // Increased to 180s for complex test generation
    console.log(`[AiController] Routing role: ${role} via MultiAgentRouter... (structured=${structured})`);

    try {
        const result = await Promise.race([
            MultiAgentRouter.route(role.toUpperCase(), prompt, structured),
            new Promise<any>((_, reject) =>
                setTimeout(() => reject(new Error(`AI generation for role ${role} timed out after ${timeoutMs}ms`)), timeoutMs)
            )
        ]);
        return result.response;
    } catch (err: any) {
        throw new Error(`AI Generation failed for role ${role}: ${err.message}`);
    }
  }

  /**
   * Same as generate() but also returns real token usage from the provider.
   * Use this when you need to track/log actual token spend.
   */
  static async generateWithUsage(
    role: AiRole,
    prompt: string,
    structured = false,
  ): Promise<{ response: string; usage: TokenUsage }> {
    const timeoutMs = 180000; // Increased to 180s
    try {
      const result = await Promise.race([
        MultiAgentRouter.route(role.toUpperCase(), prompt, structured),
        new Promise<any>((_, reject) =>
          setTimeout(() => reject(new Error(`AI generation for role ${role} timed out after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
      return { response: result.response, usage: result.usage };
    } catch (err: any) {
      throw new Error(`AI Generation failed for role ${role}: ${err.message}`);
    }
  }

  /**
   * Get health status of all AI providers.
   */
  static async getHealth(): Promise<Record<string, boolean>> {
    return MultiAgentRouter.getHealth();
  }

  /**
   * Convenience: generate test scenarios / test cases (JSON spec).
   */
  static async generateTestSpec(prompt: string): Promise<string> {
    return this.generate('TEST_GENERATION', prompt);
  }

  /**
   * Convenience: generate Playwright TypeScript code.
   */
  static async generatePlaywrightCode(prompt: string): Promise<string> {
    return this.generate('CODE', prompt);
  }

  /**
   * Convenience: self-healing diagnostic analysis.
   */
  static async diagnoseFailure(prompt: string): Promise<string> {
    return this.generate('INVESTIGATOR', prompt);
  }

  /**
   * Get the model assigned to a role.
   */
  static getModelForRole(role: AiRole): string {
    // This is a legacy method used by some services to see which model *would* be used
    // We'll return the profile name from MultiAgentRouter config
    return role.toUpperCase() === 'CODE' ? 'qwen' : 'gemini';
  }
}
