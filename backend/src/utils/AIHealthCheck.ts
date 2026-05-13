/**
 * AI Health Check Utility
 * 
 * Checks availability of Qwen/Gemini/Codex CLI and OpenRouter HTTP.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fetch from 'node-fetch';
import { config } from '../../api/config';

const execAsync = promisify(exec);

export interface AIHealthStatus {
  service: string;
  available: boolean;
  latencyMs: number;
  error?: string;
  model?: string;
  lastChecked: Date;
}

export interface AIHealthReport {
  qwenCli: AIHealthStatus;
  geminiCli: AIHealthStatus;
  codexCli: AIHealthStatus;
  openrouterHttp: AIHealthStatus;
  overallAvailable: boolean;
}

const healthCache = new Map<string, AIHealthStatus>();
const CACHE_TTL_MS = 60_000;

async function checkCliHealth(provider: 'qwen' | 'gemini' | 'codex'): Promise<AIHealthStatus> {
  const cacheKey = `${provider}_cli`;
  const cached = healthCache.get(cacheKey);
  
  if (cached && Date.now() - cached.lastChecked.getTime() < CACHE_TTL_MS) return cached;

  const startTime = Date.now();
  try {
    const { stdout } = await execAsync(`${provider} --version`, { timeout: 5_000, windowsHide: true });
    const status: AIHealthStatus = {
      service: `${provider}_cli`, available: true, latencyMs: Date.now() - startTime,
      model: stdout.trim() || provider, lastChecked: new Date()
    };
    healthCache.set(cacheKey, status);
    return status;
  } catch (error: any) {
    const status: AIHealthStatus = {
      service: `${provider}_cli`, available: false, latencyMs: Date.now() - startTime,
      error: error.message, lastChecked: new Date()
    };
    healthCache.set(cacheKey, status);
    return status;
  }
}

async function checkOpenRouterHealth(): Promise<AIHealthStatus> {
  const cacheKey = 'openrouter_http';
  const cached = healthCache.get(cacheKey);
  
  if (cached && Date.now() - cached.lastChecked.getTime() < CACHE_TTL_MS) return cached;

  const startTime = Date.now();
  const apiKey = config.ai.openRouterApiKey;
  
  if (!apiKey) {
    return {
      service: 'openrouter_http', available: false, latencyMs: 0,
      error: 'Missing OPENROUTER_API_KEY in .env', lastChecked: new Date()
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${config.ai.openRouterBaseUrl}/models`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: controller.signal as any
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const status: AIHealthStatus = {
      service: 'openrouter_http', available: true, latencyMs: Date.now() - startTime,
      model: 'OpenRouter (HTTP)', lastChecked: new Date()
    };
    healthCache.set(cacheKey, status);
    return status;
  } catch (error: any) {
    const status: AIHealthStatus = {
      service: 'openrouter_http', available: false, latencyMs: Date.now() - startTime,
      error: error.message, lastChecked: new Date()
    };
    healthCache.set(cacheKey, status);
    return status;
  }
}

export async function checkAllAIHealth(): Promise<AIHealthReport> {
  const [qwenCli, geminiCli, codexCli, openrouterHttp] = await Promise.all([
    checkCliHealth('qwen'), checkCliHealth('gemini'), checkCliHealth('codex'), checkOpenRouterHealth()
  ]);
  return { 
    qwenCli, geminiCli, codexCli, openrouterHttp,
    overallAvailable: qwenCli.available || geminiCli.available || codexCli.available || openrouterHttp.available 
  };
}

export async function getBestAvailableService(): Promise<{ service: string; health: AIHealthStatus }> {
  const health = await checkAllAIHealth();
  if (health.openrouterHttp.available) return { service: 'openrouter_http', health: health.openrouterHttp };
  if (health.qwenCli.available) return { service: 'qwen_cli', health: health.qwenCli };
  if (health.geminiCli.available) return { service: 'gemini_cli', health: health.geminiCli };
  if (health.codexCli.available) return { service: 'codex_cli', health: health.codexCli };
  return { service: 'none', health: health.qwenCli };
}

export function clearHealthCache(): void { healthCache.clear(); }

export function isServiceAvailableSync(service: string): boolean {
  return healthCache.get(service)?.available ?? false;
}
