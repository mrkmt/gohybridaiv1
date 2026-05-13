/**
 * PlaywrightAgentService
 *
 * Agent-enhanced self-healing fallback.
 * When normal self-healing fails, this service uses Playwright's agent capabilities
 * (via external AI API) to examine the DOM, understand the failure, and suggest a fix.
 *
 * NOT a standalone execution mode — only kicks in as emergency repair.
 */

import * as https from 'https';
import * as http from 'http';

export interface AgentHealResult {
  success: boolean;
  customCode?: string;       // Playwright code to fix the issue
  explanation?: string;      // Why this fix works
  confidence?: number;       // 0-1 confidence in the fix
}

interface AgentConfig {
  enabled: boolean;
  apiKey: string;
  provider: 'anthropic' | 'openrouter';
  model: string;
}

function getConfig(): AgentConfig {
  return {
    enabled: process.env.PLAYWRIGHT_AGENT_ENABLED === 'true',
    apiKey: process.env.PLAYWRIGHT_AGENT_API_KEY || '',
    provider: (process.env.PLAYWRIGHT_AGENT_PROVIDER as 'anthropic' | 'openrouter') || 'openrouter',
    model: process.env.PLAYWRIGHT_AGENT_MODEL ||
      (process.env.PLAYWRIGHT_AGENT_PROVIDER === 'anthropic'
        ? 'claude-sonnet-4-6-20250514'
        : 'anthropic/claude-sonnet-4.6-20250514'),
  };
}

/**
 * Check if the agent service is available and configured
 */
export function isAgentAvailable(): boolean {
  const config = getConfig();
  return config.enabled && !!config.apiKey;
}

/**
 * Emergency self-healing via agent when normal healing fails.
 * The agent sees the error, DOM snapshot, and test context to suggest a fix.
 * Returns null if DOM snapshot is missing (AI healing requires visual context).
 */
export async function attemptAgentHealing(options: {
  testCaseId: string;
  testCaseTitle: string;
  stepAction: string;
  stepExpected: string;
  errorMessage: string;
  domSnapshot?: string;
  pageUrl?: string;
}): Promise<AgentHealResult | null> {
  const config = getConfig();

  if (!config.enabled || !config.apiKey) {
    console.warn('[PlaywrightAgent] Agent not configured, skipping');
    return null;
  }

  // AI healing requires DOM snapshot — without it, the agent has no visual context
  // and will produce low-confidence fixes that are likely to fail again
  if (!options.domSnapshot || options.domSnapshot.trim().length === 0) {
    console.warn(
      `[PlaywrightAgent] Skipping AI healing for ${options.testCaseId} — no DOM snapshot available. ` +
      `AI fixes without visual context have low confidence and high failure rate.`
    );
    return null;
  }

  console.log(`[PlaywrightAgent] Emergency healing for ${options.testCaseId} (DOM: ${options.domSnapshot.length.toLocaleString()} chars)...`);

  const prompt = buildHealingPrompt(options);

  try {
    if (config.provider === 'anthropic') {
      return callAnthropic(config, prompt);
    } else {
      return callOpenRouter(config, prompt);
    }
  } catch (error: any) {
    console.error(`[PlaywrightAgent] Agent healing failed: ${error.message}`);
    return null;
  }
}

/**
 * Extract relevant DOM context around the failing element.
 * Instead of truncating to first N chars, this function:
 * 1. Parses the error message to find the problematic selector
 * 2. Searches the DOM snapshot for that selector or nearby context
 * 3. Returns a focused excerpt (with head/tail for overall context)
 */
function extractRelevantDomContext(domSnapshot: string, errorMessage: string, maxChars: number = 12000): string {
  if (!domSnapshot) {
    // Should never reach here since attemptAgentHealing guards against missing DOM
    throw new Error('DOM snapshot is required for AI healing');
  }

  // If snapshot is small enough, return it entirely
  if (domSnapshot.length <= maxChars) return domSnapshot;

  // Try to extract a selector from the error message
  const selectorPatterns = [
    /locator\('([^']+)'\)/,
    /locator\("([^"]+)"\)/,
    /\$?\('([^']+)'\)/,
    /"([^"]+)".*not found/i,
    /Timed out.*waiting for selector[:\s]+(["']?)([^"'\s,]+)\1/i,
  ];

  let searchToken = '';
  for (const pattern of selectorPatterns) {
    const match = errorMessage.match(pattern);
    if (match) {
      searchToken = match[1] || match[2] || '';
      break;
    }
  }

  // If we found a selector, try to find its position in the DOM
  if (searchToken) {
    // Extract the most distinctive part of the selector for searching
    const attrMatch = searchToken.match(/["']([^"']{3,})["']/);
    const classMatch = searchToken.match(/\.([a-zA-Z][a-zA-Z0-9_-]{2,})/);
    const idMatch = searchToken.match(/#([a-zA-Z][a-zA-Z0-9_-]+)/);
    const token = attrMatch?.[1] || classMatch?.[1] || idMatch?.[1] || searchToken;

    const position = domSnapshot.indexOf(token);
    if (position !== -1) {
      // Extract context around the found position:
      // 20% before the match, 80% after (the element and its children are usually after)
      const beforeChars = Math.floor(maxChars * 0.2);
      const afterChars = maxChars - beforeChars;

      const start = Math.max(0, position - beforeChars);
      const end = Math.min(domSnapshot.length, position + afterChars);

      const excerpt = domSnapshot.substring(start, end);
      return `[... ${start} chars omitted ...]\n${excerpt}\n[... ${domSnapshot.length - end} chars omitted ...]`;
    }
  }

  // Fallback: return head (15%) + tail (85%) to capture form/dialog content at end
  const headSize = Math.floor(maxChars * 0.15);
  const tailSize = maxChars - headSize;
  const head = domSnapshot.substring(0, headSize);
  const tail = domSnapshot.substring(domSnapshot.length - tailSize);

  return `[... DOM truncated — showing head + tail (failing element selector not found in snapshot) ...]\n\n=== HEAD ===\n${head}\n\n=== TAIL ===\n${tail}\n\n[Total DOM size: ${domSnapshot.length.toLocaleString()} chars]`;
}

function buildHealingPrompt(options: {
  testCaseId: string;
  testCaseTitle: string;
  stepAction: string;
  stepExpected: string;
  errorMessage: string;
  domSnapshot?: string;
  pageUrl?: string;
}): string {
  // --- Improved DOM snapshot strategy ---
  // Instead of blindly truncating to first N chars, try to extract
  // the failing element's context. Parse the error to identify the
  // problematic selector, then find it + surrounding context.
  const domContext = extractRelevantDomContext(
    options.domSnapshot || '',
    options.errorMessage || '',
  );

  return `# Role: Senior Playwright Test Engineer

## Context
A test failed during execution. Normal self-healing could not fix it.
You need to examine the DOM and error to suggest a code fix.

- **Test Case:** ${options.testCaseId} — ${options.testCaseTitle}
- **Failed Step:** ${options.stepAction}
- **Expected:** ${options.stepExpected}
- **Error:** ${options.errorMessage}
- **Page URL:** ${options.pageUrl || 'unknown'}

## DOM Snapshot (relevant context around failing element)
${domContext}

## Task
Return a JSON object with a Playwright code snippet that would fix this failing step.

The fix should use Playwright's SMART LOCATORS (priority order):
1. page.getByRole('button', { name: '...' })
2. page.getByLabel('...')
3. page.getByPlaceholder('...')
4. page.getByText('...')
5. page.locator('...') with data-testid or specific selectors

## Output Format (STRICT JSON ONLY — no markdown, no explanation)
{
  "customCode": "...Playwright async/await code...",
  "explanation": "Why this fix works",
  "confidence": 0.85
}

## Rules
- customCode must be valid TypeScript Playwright code
- customCode should NOT include page context (no "await page.", just the locators)
- customCode can be multiple lines (separated by \\n in JSON)
- Confidence should be 0.0-1.0 based on how sure you are
- If you cannot fix it, set success: false`;
}

function callAnthropic(config: AgentConfig, prompt: string): Promise<AgentHealResult> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: config.model,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
      system: 'You are an expert Playwright test engineer. Return ONLY valid JSON. No markdown. No explanation.',
    });

    const req = https.request('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            reject(new Error(`Anthropic API returned ${res.statusCode}: ${data}`));
            return;
          }
          const parsed = JSON.parse(data);
          const content = parsed.content?.[0]?.text || '';
          const result = parseAgentResponse(content);
          resolve(result);
        } catch (e: any) {
          reject(new Error(`Failed to parse Anthropic response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function callOpenRouter(config: AgentConfig, prompt: string): Promise<AgentHealResult> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: config.model,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: 'You are an expert Playwright test engineer. Return ONLY valid JSON. No markdown. No explanation.' },
        { role: 'user', content: prompt },
      ],
    });

    const req = https.request('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        'HTTP-Referer': 'https://go-hybrid-ai.local',
        'X-Title': 'GoHybrid AI',
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            reject(new Error(`OpenRouter API returned ${res.statusCode}: ${data}`));
            return;
          }
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.message?.content || '';
          const result = parseAgentResponse(content);
          resolve(result);
        } catch (e: any) {
          reject(new Error(`Failed to parse OpenRouter response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseAgentResponse(content: string): AgentHealResult {
  // Strip markdown code blocks if present
  const stripped = content.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1').trim();

  // Find JSON bounds
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');

  if (start === -1 || end === -1 || end < start) {
    console.error('[PlaywrightAgent] No valid JSON in agent response');
    return { success: false, explanation: 'Agent returned non-JSON response' };
  }

  const jsonText = stripped.substring(start, end + 1);
  const parsed = JSON.parse(jsonText);

  return {
    success: true,
    customCode: parsed.customCode || parsed.code || undefined,
    explanation: parsed.explanation || parsed.reasoning || undefined,
    confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
  };
}
