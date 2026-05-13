/**
 * AiModuleResolverService
 *
 * Phase 1 AI integration for Discovery.
 *
 * Purpose: When the regex alias table in DiscoveryCacheService cannot identify
 * a module name from a ticket summary (e.g. "Testing site - Leave Balance Report"),
 * this service falls back to a fast AI call that picks the best matching module
 * from the known MODULE_ROUTES constraint set.
 *
 * Design principles:
 *  - AI never invents new modules — it picks from getCanonicalNames() only.
 *  - Every result is cached on disk keyed by sha256(summary) — same ticket
 *    summary never triggers a second AI call.
 *  - All errors are caught and return null — never throws, existing pipeline continues.
 *  - Uses QUICK role (Gemini Flash / fastest available model) — ~200ms, ~$0.0001.
 */

import * as fs   from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { AiControllerService } from '../../shared/AiControllerService';
import { getCanonicalNames }   from '../ModuleRouteRegistry';
import { appLogger }           from '../../../utils/logger';

interface ResolveResult {
  moduleName: string;
  confidence: number;   // 0..1
  reasoning: string;
}

export class AiModuleResolverService {
  private static readonly CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  // ── Cache dir ────────────────────────────────────────────────────────────
  private static getCacheDir(): string {
    const base = process.env.LOCAL_STORAGE_PATH
      ? path.resolve(process.env.LOCAL_STORAGE_PATH)
      : path.join(__dirname, '..', '..', '..', '..', '..', 'local_storage');
    return path.join(base, 'discovery', 'module_resolver_cache');
  }

  private static getCachePath(summaryHash: string): string {
    const dir = this.getCacheDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${summaryHash}.json`);
  }

  private static hashSummary(summary: string): string {
    return crypto.createHash('sha256').update(summary.trim().toLowerCase()).digest('hex').slice(0, 16);
  }

  // ── Cache read/write ──────────────────────────────────────────────────────
  private static readCache(hash: string): ResolveResult | null {
    const p = this.getCachePath(hash);
    if (!fs.existsSync(p)) return null;
    try {
      const entry = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (Date.now() - new Date(entry.cachedAt).getTime() > this.CACHE_TTL_MS) {
        fs.unlinkSync(p);
        return null;
      }
      return entry.result as ResolveResult;
    } catch {
      return null;
    }
  }

  private static writeCache(hash: string, result: ResolveResult): void {
    try {
      fs.writeFileSync(
        this.getCachePath(hash),
        JSON.stringify({ result, cachedAt: new Date().toISOString() }, null, 2),
        'utf-8',
      );
    } catch {
      // non-fatal
    }
  }

  // ── Main public method ────────────────────────────────────────────────────
  /**
   * Resolve a module name from a ticket summary using AI.
   * Returns the canonical module name (from MODULE_ROUTES) or null if uncertain.
   * Never throws — all errors are caught and return null.
   */
  static async resolve(
    summary: string,
    description?: string,
  ): Promise<string | null> {
    if (!summary?.trim()) return null;

    const hash = this.hashSummary(summary);
    const cached = this.readCache(hash);
    if (cached) {
      appLogger.info(`[AiModuleResolver] Cache hit for "${summary.slice(0, 60)}" → "${cached.moduleName}" (confidence: ${cached.confidence})`);
      return cached.confidence >= 0.5 ? cached.moduleName : null;
    }

    const knownModules = getCanonicalNames();
    const prompt = this.buildPrompt(summary, description, knownModules);

    try {
      const raw = await Promise.race([
        AiControllerService.generate('QUICK', prompt),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('AI module resolver timeout')), 8000)
        ),
      ]);

      const result = this.parseResponse(raw, knownModules);
      if (!result) {
        appLogger.warn(`[AiModuleResolver] Could not parse AI response for: "${summary.slice(0, 60)}"`);
        return null;
      }

      this.writeCache(hash, result);
      appLogger.info(`[AiModuleResolver] Resolved "${summary.slice(0, 60)}" → "${result.moduleName}" (confidence: ${result.confidence}, reason: ${result.reasoning})`);

      return result.confidence >= 0.5 ? result.moduleName : null;

    } catch (err: any) {
      appLogger.warn(`[AiModuleResolver] AI call failed, falling back to null: ${err.message}`);
      return null;
    }
  }

  // ── Prompt builder ────────────────────────────────────────────────────────
  private static buildPrompt(
    summary: string,
    description: string | undefined,
    knownModules: string[],
  ): string {
    const descBlock = description?.trim()
      ? `\nTicket Description (first 300 chars): ${description.trim().slice(0, 300)}`
      : '';

    return `You are a module classifier for an HR management system called GlobalHR.

Given a Jira ticket, identify which GlobalHR module it belongs to.
You MUST pick from the known modules list. If unsure, return confidence < 0.5.

Known GlobalHR modules:
${knownModules.map(m => `- ${m}`).join('\n')}

Ticket Summary: ${summary}${descBlock}

Respond with ONLY valid JSON, no markdown:
{"moduleName": "<exact name from list>", "confidence": <0.0-1.0>, "reasoning": "<one sentence>"}`;
  }

  // ── Response parser ───────────────────────────────────────────────────────
  private static parseResponse(raw: string, knownModules: string[]): ResolveResult | null {
    try {
      // Strip markdown fences if present
      let clean = raw.trim();
      if (clean.startsWith('```')) {
        clean = clean.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim();
      }
      // Extract first JSON object
      const start = clean.indexOf('{');
      const end   = clean.lastIndexOf('}');
      if (start === -1 || end === -1) return null;
      const parsed = JSON.parse(clean.slice(start, end + 1));

      const moduleName  = parsed.moduleName?.trim() ?? '';
      const confidence  = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
      const reasoning   = parsed.reasoning?.trim() ?? '';

      // Validate: must be one of the known modules (case-insensitive)
      const canonical = knownModules.find(m => m.toLowerCase() === moduleName.toLowerCase());
      if (!canonical) {
        appLogger.warn(`[AiModuleResolver] AI returned unknown module "${moduleName}" — rejected`);
        return null;
      }

      return { moduleName: canonical, confidence, reasoning };
    } catch {
      return null;
    }
  }
}
