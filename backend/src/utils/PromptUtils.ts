/**
 * PromptUtils - Prompt size management and optimization
 *
 * Prevents runaway token usage by:
 * - Capping prompt context to configurable limits
 * - Truncating intelligently (preserve structure, cut middle)
 * - Estimating token counts more accurately than char/4
 */

// Hard cap: no single prompt context should exceed this
const MAX_PROMPT_CHARS = 100_000;

// Soft cap: warn when context exceeds this
const WARN_PROMPT_CHARS = 50_000;

/**
 * Estimate token count for a given text.
 * Uses a more realistic ratio than the naive char/4.
 * - English text: ~4 chars/token
 * - Code/technical: ~3 chars/token
 * - Mixed: ~3.5 chars/token
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  // Check ratio of non-ASCII chars (code/technical has more symbols)
  const nonAsciiRatio = (text.match(/[^\x00-\x7F]/g) || []).length / text.length;
  const charsPerToken = nonAsciiRatio > 0.1 ? 3 : nonAsciiRatio > 0.05 ? 3.5 : 4;
  return Math.ceil(text.length / charsPerToken);
}

/**
 * Cap a prompt/context string to a maximum size.
 * Truncates from the middle, preserving the beginning (most important context)
 * and the end (the actual question/instruction).
 */
export function capPrompt(text: string, maxChars = MAX_PROMPT_CHARS): string {
  if (!text || text.length <= maxChars) return text;

  const headSize = Math.floor(maxChars * 0.6);
  const tailSize = maxChars - headSize - 200; // 200 chars for truncation marker

  const head = text.slice(0, headSize);
  const tail = text.slice(-tailSize);

  return `${head}\n\n--- [CONTEXT TRUNCATED: ${text.length - headSize - tailSize} chars omitted for token efficiency] ---\n\n${tail}`;
}

/**
 * Cap and warn if context is too large.
 * Logs a warning when the soft cap is exceeded.
 */
export function capPromptWithWarning(text: string, label = 'unnamed'): string {
  if (text.length > WARN_PROMPT_CHARS) {
    console.warn(`[PromptUtils] ⚠️ ${label} prompt is ${text.length.toLocaleString()} chars (warning threshold: ${WARN_PROMPT_CHARS.toLocaleString()} chars). Capping to ${MAX_PROMPT_CHARS.toLocaleString()} chars.`);
  }
  return capPrompt(text);
}

/**
 * Truncate Jira ticket context to essential fields only.
 * Strips full ADF structure and keeps only the text content.
 */
export function extractTicketSummary(ticket: {
  summary?: string;
  description?: string;
  comments?: Array<{ body?: string; author?: string }>;
}): string {
  const parts: string[] = [];

  if (ticket.summary) {
    parts.push(`Summary: ${ticket.summary}`);
  }

  if (ticket.description) {
    // Cap description at 30K chars (should cover most tickets)
    const desc = ticket.description.length > 30_000
      ? ticket.description.slice(0, 30_000) + '\n--- [Description truncated at 30K chars] ---'
      : ticket.description;
    parts.push(`Description:\n${desc}`);
  }

  if (ticket.comments && ticket.comments.length > 0) {
    // Only include last 5 comments, capped at 10K chars total
    const recentComments = ticket.comments.slice(-5);
    let commentText = recentComments
      .filter(c => c.body)
      .map(c => `[${c.author || 'Unknown'}]: ${c.body!}`)
      .join('\n\n');

    if (commentText.length > 10_000) {
      commentText = commentText.slice(0, 10_000) + '\n--- [Comments truncated at 10K chars] ---';
    }
    parts.push(`Comments:\n${commentText}`);
  }

  return parts.join('\n\n');
}

/**
 * Filter knowledge base rules to only those relevant to a module.
 * Instead of dumping ALL rules, only include matching ones.
 */
export function filterRulesByModule(
  rules: Array<{ module?: string; keywords?: string[]; [key: string]: any }>,
  targetModule: string,
  maxRules = 50
): Array<{ module?: string; keywords?: string[]; [key: string]: any }> {
  if (!targetModule) return rules.slice(0, maxRules);

  const normalized = targetModule.toLowerCase();

  // Score rules by relevance
  const scored = rules.map(rule => {
    let score = 0;
    if (rule.module?.toLowerCase().includes(normalized)) score += 10;
    if (rule.keywords?.some((kw: string) => normalized.includes(kw.toLowerCase()))) score += 5;
    return { rule, score };
  });

  // Sort by relevance, take top N
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxRules)
    .map(s => s.rule);
}

/**
 * Get prompt size info for logging/monitoring.
 */
export function getPromptInfo(text: string, label = 'prompt'): {
  charCount: number;
  estimatedTokens: number;
  isOverCap: boolean;
  label: string;
} {
  return {
    charCount: text.length,
    estimatedTokens: estimateTokenCount(text),
    isOverCap: text.length > MAX_PROMPT_CHARS,
    label,
  };
}
