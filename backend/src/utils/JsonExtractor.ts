/**
 * JsonExtractor
 *
 * Robust extraction of JSON from LLM responses.
 * LLMs frequently return JSON wrapped in markdown fences, prefixed with
 * prose, or with minor trailing garbage. This module handles all common
 * patterns and falls back gracefully rather than throwing.
 *
 * Usage:
 *   const data = JsonExtractor.extract(responseText); // throws on failure
 *   const data = JsonExtractor.tryExtract(responseText, defaultValue); // never throws
 */

import { appLogger } from './logger';

export class JsonExtractor {
  /**
   * Extract and parse JSON from an LLM response string.
   * Tries multiple strategies in order:
   *   1. Markdown code fence  ``` json ... ```
   *   2. First { ... } object block
   *   3. First [ ... ] array block
   *   4. Raw string (trimmed)
   *
   * @throws SyntaxError if no valid JSON can be found
   */
  static extract<T = unknown>(text: string): T {
    if (!text?.trim()) throw new SyntaxError('Empty response');

    const strategies: Array<() => string> = [
      // Strategy 1: code fence
      () => {
        const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (!m) throw new Error('no fence');
        return m[1].trim();
      },
      // Strategy 2: first object block
      () => {
        const start = text.indexOf('{');
        const end   = text.lastIndexOf('}');
        if (start === -1 || end === -1 || end <= start) throw new Error('no object');
        return text.substring(start, end + 1);
      },
      // Strategy 3: first array block
      () => {
        const start = text.indexOf('[');
        const end   = text.lastIndexOf(']');
        if (start === -1 || end === -1 || end <= start) throw new Error('no array');
        return text.substring(start, end + 1);
      },
      // Strategy 4: raw trimmed
      () => text.trim(),
    ];

    let lastErr: Error | null = null;
    for (const strategy of strategies) {
      try {
        const candidate = strategy();
        return JSON.parse(candidate) as T;
      } catch (e: any) {
        lastErr = e;
      }
    }

    throw new SyntaxError(`Cannot extract JSON from LLM response: ${lastErr?.message}. First 200 chars: ${text.slice(0, 200)}`);
  }

  /**
   * Same as extract() but returns `defaultValue` instead of throwing.
   */
  static tryExtract<T>(text: string, defaultValue: T): T {
    try {
      return JsonExtractor.extract<T>(text);
    } catch (err: any) {
      appLogger.warn('[JsonExtractor] Extraction failed — using default', { message: err.message });
      return defaultValue;
    }
  }

  /**
   * Extract and validate that the result is an array.
   * Returns the array, or `[]` if extraction fails or result is not an array.
   */
  static tryArray<T>(text: string): T[] {
    const result = JsonExtractor.tryExtract<unknown>(text, []);
    return Array.isArray(result) ? (result as T[]) : [];
  }

  /**
   * Extract and validate that the result is a plain object.
   * Returns the object, or `{}` if extraction fails or result is not an object.
   */
  static tryObject<T extends Record<string, unknown>>(text: string): Partial<T> {
    const result = JsonExtractor.tryExtract<unknown>(text, {});
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      return result as Partial<T>;
    }
    return {};
  }
}
