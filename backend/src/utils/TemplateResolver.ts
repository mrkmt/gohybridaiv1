/**
 * TemplateResolver Utility
 * 
 * Resolves template variables like {{base_url}}, {{BASE_URL}}, {{username}}, etc.
 * in test specifications, navigation targets, and generated code.
 * 
 * This prevents the critical failure where template placeholders are left unresolved
 * in generated test scripts (e.g., navigating to literal "{{base_url}}#/master-department").
 */

import * as path from 'path';
import { appLogger } from './logger';

export interface TemplateContext {
  [key: string]: string | number | boolean | undefined;
}

/**
 * Default template context builder from environment variables
 */
export function buildDefaultContext(overrides?: Partial<TemplateContext>): TemplateContext {
  // timestamp is regenerated per call so each test run gets a fresh unique value.
  // Format: YYYYMMDD_HHmmss (safe for field values, no special chars)
  const now = new Date();
  const ts = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') + '_' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');

  return {
    base_url: process.env.BASE_URL || 'http://localhost:4200',
    BASE_URL: process.env.BASE_URL || 'http://localhost:4200',
    baseUrl: process.env.BASE_URL || 'http://localhost:4200',
    api_base_url: process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4200',
    API_BASE_URL: process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4200',
    username: process.env.TEST_USERNAME || '',
    TEST_USERNAME: process.env.TEST_USERNAME || '',
    password: process.env.TEST_PASSWORD || '',
    TEST_PASSWORD: process.env.TEST_PASSWORD || '',
    id_number: process.env.TEST_IDNUMBER || '',
    TEST_IDNUMBER: process.env.TEST_IDNUMBER || '',
    customer_id: process.env.CUSTOMER_ID || '',
    CUSTOMER_ID: process.env.CUSTOMER_ID || '',
    // Dynamic test-data tokens — resolved at compile time so each run is unique
    timestamp: ts,
    TIMESTAMP: ts,
    unique_id: `${Date.now()}`,
    UNIQUE_ID: `${Date.now()}`,
    random: Math.random().toString(36).slice(2, 8),
    RANDOM: Math.random().toString(36).slice(2, 8),
    ...overrides,
  };
}

/**
 * Resolve all {{variable}} placeholders in a string
 * 
 * @param template - String containing {{variable}} placeholders
 * @param context - Key-value mapping for resolution (uses env defaults if not provided)
 * @param strict - If true, throw on unresolved variables; if false, leave them as-is
 * @returns Resolved string
 * 
 * @example
 * resolveTemplate('{{base_url}}#/master-department', { base_url: 'https://test.globalhr.com.mm/ook' })
 * // => 'https://test.globalhr.com.mm/ook#/master-department'
 */
export function resolveTemplate(
  template: string,
  context?: TemplateContext,
  strict: boolean = false
): string {
  if (!template || typeof template !== 'string') {
    return template;
  }

  const ctx = context || buildDefaultContext();
  const templateRegex = /\{\{(\w+)\}\}/g;
  const unresolved: string[] = [];

  const result = template.replace(templateRegex, (match, key) => {
    // 1. Direct lookup
    let value = ctx[key];

    // 2. Dynamic: timestamp_slice_X_Y[_upper|_lower]
    // e.g. {{timestamp_slice_0_8}} → first 8 chars of timestamp
    if (value === undefined && key.startsWith('timestamp_slice_')) {
      const parts = key.split('_'); // ['timestamp','slice','0','8','upper']
      const start = parseInt(parts[2], 10);
      const end   = parseInt(parts[3], 10);
      const transform = parts[4];
      const rawTs = String(ctx['timestamp'] || '');
      if (rawTs) {
        value = rawTs.slice(start, end);
        if (transform === 'upper') value = (value as string).toUpperCase();
        if (transform === 'lower') value = (value as string).toLowerCase();
      }
    }

    if (value === undefined || value === null) {
      unresolved.push(key);
      return strict ? '' : match;
    }
    return String(value);
  });

  if (strict && unresolved.length > 0) {
    throw new Error(
      `Unresolved template variables: ${unresolved.join(', ')}. ` +
      `Available context keys: ${Object.keys(ctx).join(', ')}`
    );
  }

  return result;
}

/**
 * Resolve template variables in an object's string values (mutates in place)
 * 
 * @param obj - Object with string values that may contain {{variable}} placeholders
 * @param context - Key-value mapping for resolution
 * @param strict - If true, throw on unresolved variables
 * @returns Same object with resolved values
 */
export function resolveTemplateInObject<T extends Record<string, any>>(
  obj: T,
  context?: TemplateContext,
  strict: boolean = false
): T {
  const ctx = context || buildDefaultContext();
  const objAny = obj as any;

  for (const key of Object.keys(objAny)) {
    if (typeof objAny[key] === 'string') {
      objAny[key] = resolveTemplate(objAny[key], ctx, strict);
    } else if (Array.isArray(objAny[key])) {
      objAny[key] = objAny[key].map((item: any) =>
        typeof item === 'string' ? resolveTemplate(item, ctx, strict) : item
      );
    } else if (typeof objAny[key] === 'object' && objAny[key] !== null) {
      resolveTemplateInObject(objAny[key], ctx, strict);
    }
  }

  return obj;
}

/**
 * Validate that a string has no unresolved {{variable}} placeholders
 * 
 * @param text - Text to validate
 * @returns Array of unresolved variable names
 */
export function getUnresolvedVariables(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  
  const templateRegex = /\{\{(\w+)\}\}/g;
  const unresolved = new Set<string>();
  let match;
  
  while ((match = templateRegex.exec(text)) !== null) {
    unresolved.add(match[1]);
  }
  
  return Array.from(unresolved);
}

/**
 * Check if a string contains any template variables
 */
export function hasTemplateVariables(text: string): boolean {
  return /\{\{\w+\}\}/.test(text);
}

/**
 * Sanitize a URL by ensuring it doesn't contain unresolved template variables
 * Falls back to configured BASE_URL if template variables are found
 */
export function sanitizeUrl(url: string, fallbackBaseUrl?: string): string {
  if (!url || typeof url !== 'string') {
    return fallbackBaseUrl || process.env.BASE_URL || 'http://localhost:4200';
  }

  const unresolved = getUnresolvedVariables(url);
  if (unresolved.length > 0) {
    appLogger.warn(
      `[TemplateResolver] URL contains unresolved variables: ${unresolved.join(', ')}. ` +
      `Using fallback: ${fallbackBaseUrl || process.env.BASE_URL}`
    );
    return fallbackBaseUrl || process.env.BASE_URL || 'http://localhost:4200';
  }

  return url;
}
