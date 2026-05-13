export const MAX_PROMPT_CHARS = 100_000; // ~26,000 tokens — safe for Gemini/Qwen 
const SCHEMA_RESERVE = 5_000;           // Reserve room for complex JSON schema
const TRIM_TARGET = MAX_PROMPT_CHARS - SCHEMA_RESERVE; 

/**
 * Rough token estimation: ~3.8 characters per token for English text.
 */
export function estimateTokens(input: string | number): number {
  if (!input) return 0;
  const len = typeof input === 'string' ? input.length : input;
  return Math.round(len / 3.8);
}

/**
 * Smart trim: instead of naive 20%/80% split, trim from the BEGINNING
 * of the prompt (where low-priority context lives) and preserve the END
 * (where ticket context and schema live).
 * 
 * Supports both new (prompt, label) and legacy (prompt, tokenLimit, model) signatures.
 */
export function trimContext(prompt: string, labelOrLimit?: string | number, model?: string): string {
  let targetChars = TRIM_TARGET;

  // Legacy support: if second arg is a number, it's a token limit
  if (typeof labelOrLimit === 'number') {
    targetChars = Math.round(labelOrLimit * 3.8);
  }

  if (prompt.length <= targetChars) return prompt;

  const before = prompt.length;
  // Keep the last targetChars chars — this is where ticket context and
  // module knowledge are (because we build the prompt in that order).
  const trimmed = '... [context trimmed — low-priority sections removed] ...\n\n'
    + prompt.slice(prompt.length - targetChars);

  const after = trimmed.length;
  const tokens = estimateTokens(after);
  const label = typeof labelOrLimit === 'string' ? labelOrLimit : (model || 'legacy');
  
  console.info(
    `[ContextManager] Trimmed ${label}: ${before} → ${after} chars (~${tokens} tokens)`
  );
  return trimmed;
}

/**
 * Check if a prompt fits within a token limit.
 * Used by AgentOrchestrator to decide whether to truncate.
 */
export function checkTokenUsage(prompt: string, limit: number, model?: string) {
  const estimatedTokens = estimateTokens(prompt);
  const withinLimit = estimatedTokens <= limit;
  
  return {
    withinLimit,
    estimatedTokens,
    overflowTokens: Math.max(0, estimatedTokens - limit),
    // If over limit, provide the smart-trimmed version immediately
    suggestedTruncation: withinLimit ? null : trimContext(prompt, limit, model),
  };
}

// Export as a namespace/object for legacy compatibility
export const ContextManager = {
  MAX_PROMPT_CHARS,
  trimContext,
  estimateTokens,
  checkTokenUsage,
};
