/**
 * TelegramCommandHandler.ts
 *
 * Receives webhook updates from Telegram Bot API and responds to commands:
 *   /status    — Server status, uptime, process info
 *   /health    — Full health check (DB, AI, Browser Pool, Cache)
 *   /dashboard — Aggregated system metrics summary
 *   /ping      — Quick connectivity check
 *
 * Setup:
 *   1. Set webhook URL via Telegram BotFather or API:
 *      POST https://api.telegram.org/bot<TOKEN>/setWebhook
 *      { "url": "https://your-domain/api/telegram/webhook" }
 *   2. Set env vars:
 *      TELEGRAM_BOT_TOKEN=...
 *      TELEGRAM_WEBHOOK_SECRET=<shared secret for webhook validation>
 *      ENABLE_TELEGRAM_COMMANDS=true
 */

import { Request, Response } from 'express';
import fetch from 'node-fetch';
import { config } from '../../../api/config';
import { appLogger } from '../../utils/logger';
import { SharedBrowserPool } from '../discovery/SharedBrowserPool';
import { DiscoveryCacheService } from '../discovery/DiscoveryCacheService';

// ============================================================================
// Types
// ============================================================================

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  entities?: Array<{ type: string; offset: number; length: number }>;
}

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
}

// ============================================================================
// Configuration
// ============================================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || config.telegram.botToken || '';
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const COMMANDS_ENABLED = process.env.ENABLE_TELEGRAM_COMMANDS === 'true' || process.env.ENABLE_TELEGRAM_ALERTS === 'true';

// Allowed users (Telegram user IDs) — only these users can run commands
const ALLOWED_USERS = new Set(
  (process.env.TELEGRAM_ALLOWED_USERS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(Number)
);

const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ============================================================================
// Command Registry
// ============================================================================

interface CommandHandler {
  name: string;
  description: string;
  handler: (chatId: number, args: string[]) => Promise<string>;
}

const commands: CommandHandler[] = [
  {
    name: 'ping',
    description: 'Quick connectivity check',
    handler: handlePing,
  },
  {
    name: 'status',
    description: 'Server status, uptime, and process info',
    handler: handleStatus,
  },
  {
    name: 'health',
    description: 'Full health check (DB, AI, Browser Pool, Cache)',
    handler: handleHealth,
  },
  {
    name: 'dashboard',
    description: 'Aggregated system metrics summary',
    handler: handleDashboard,
  },
  {
    name: 'help',
    description: 'Show available commands',
    handler: handleHelp,
  },
];

// ============================================================================
// Command Handlers
// ============================================================================

async function handlePing(_chatId: number, _args: string[]): Promise<string> {
  return `✅ **GoHybridAI is alive**\n\nTime: ${new Date().toISOString()}\nNode: ${process.version}\nEnv: ${process.env.NODE_ENV || 'development'}`;
}

async function handleStatus(_chatId: number, _args: string[]): Promise<string> {
  const uptimeSec = process.uptime();
  const days = Math.floor(uptimeSec / 86400);
  const hours = Math.floor((uptimeSec % 86400) / 3600);
  const mins = Math.floor((uptimeSec % 3600) / 60);

  const memUsage = process.memoryUsage();
  const memMB = (memUsage.rss / 1024 / 1024).toFixed(1);
  const heapMB = (memUsage.heapUsed / 1024 / 1024).toFixed(1);
  const heapTotalMB = (memUsage.heapTotal / 1024 / 1024).toFixed(1);

  const poolStats = SharedBrowserPool.getInstance().getStats();

  let text = `📊 **Server Status**\n\n`;
  text += `⏱ **Uptime:** ${days}d ${hours}h ${mins}m\n`;
  text += `🔧 **Node:** ${process.version}\n`;
  text += `🌍 **Env:** ${process.env.NODE_ENV || 'development'}\n`;
  text += `📦 **PID:** ${process.pid}\n`;
  text += `\n💾 **Memory:**\n`;
  text += `  RSS: ${memMB} MB\n`;
  text += `  Heap: ${heapMB}/${heapTotalMB} MB\n`;
  text += `\n🌐 **Browser Pool:**\n`;
  text += `  In use: ${poolStats.inUse ? 'Yes' : 'No'}\n`;
  text += `  Launches: ${poolStats.launchCount}\n`;
  text += `  Reuses: ${poolStats.reuseCount}\n`;
  text += `  Healthy: ${poolStats.isHealthy ? '✅' : '❌'}\n`;
  text += `  Idle: ${poolStats.idleSeconds}s\n`;

  return text;
}

async function handleHealth(_chatId: number, _args: string[]): Promise<string> {
  const results: string[] = [];

  // Database check — use pg.Pool directly
  let pool: import('pg').Pool | null = null;
  try {
    const { Pool } = await import('pg');
    pool = new Pool({
      user: process.env.PG_USER || config.postgres.user,
      host: process.env.PG_HOST || config.postgres.host,
      database: process.env.PG_DATABASE || config.postgres.database,
      password: process.env.PG_PASSWORD || config.postgres.password,
      port: parseInt(process.env.PG_PORT || String(config.postgres.port)),
    });
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT 1 as ok');
      const ok = res.rows[0]?.ok === 1;
      const poolInfo = ` (pool: ${pool.totalCount} total, ${pool.idleCount} idle)`;
      results.push(`🗄 **DB:** ✅ Connected${poolInfo}`);
    } finally {
      client.release();
    }
  } catch (err: any) {
    results.push(`🗄 **DB:** ❌ ${err.message}`);
  } finally {
    if (pool) await pool.end().catch(() => {});
  }

  // AI Models
  try {
    const { AiControllerService } = await import('./AiControllerService');
    const aiHealth = await AiControllerService.getHealth();
    const providers = Object.entries(aiHealth || {})
      .map(([name, healthy]: [string, boolean]) => `${healthy ? '✅' : '❌'} ${name}`)
      .join(', ') || 'N/A';
    results.push(`🤖 **AI Providers:** ${providers}`);
  } catch (err: any) {
    results.push(`🤖 **AI:** ❌ ${err.message}`);
  }

  // Browser Pool
  try {
    const poolInstance = SharedBrowserPool.getInstance();
    const healthy = await poolInstance.isHealthy();
    results.push(`🌐 **Browser Pool:** ${healthy ? '✅ Operational' : '⚠️ Degraded'}`);
  } catch (err: any) {
    results.push(`🌐 **Browser Pool:** ❌ ${err.message}`);
  }

  // Discovery Cache
  try {
    const cacheStats = DiscoveryCacheService.getCacheStats();
    const modules = DiscoveryCacheService.listAll();
    results.push(`💾 **Discovery Cache:** ${modules.length} modules cached`);
  } catch (err: any) {
    results.push(`💾 **Discovery Cache:** ❌ ${err.message}`);
  }

  const allOk = results.every(r => r.includes('✅') || r.includes('cached'));

  let text = `${allOk ? '🟢' : '🔴'} **System Health**\n\n`;
  text += results.join('\n');
  text += `\n\n🕐 ${new Date().toISOString()}`;

  return text;
}

async function handleDashboard(_chatId: number, _args: string[]): Promise<string> {
  let text = `📈 **GoHybridAI Dashboard**\n\n`;

  // Database stats — use temporary pool
  let pool: import('pg').Pool | null = null;
  try {
    const { Pool } = await import('pg');
    pool = new Pool({
      user: process.env.PG_USER || config.postgres.user,
      host: process.env.PG_HOST || config.postgres.host,
      database: process.env.PG_DATABASE || config.postgres.database,
      password: process.env.PG_PASSWORD || config.postgres.password,
      port: parseInt(process.env.PG_PORT || String(config.postgres.port)),
    });
    const dbRes = await pool.query(`
      SELECT
        (SELECT count(*) FROM recordings) as recordings,
        (SELECT count(*) FROM test_sessions) as sessions,
        (SELECT count(*) FROM chat_sessions) as chats,
        (SELECT count(*) FROM object_repository) as objects
    `);
    const row = dbRes.rows[0];
    text += `🗄 **Database:**\n`;
    text += `  Recordings: ${row.recordings}\n`;
    text += `  Sessions: ${row.sessions}\n`;
    text += `  Chats: ${row.chats}\n`;
    text += `  Objects: ${row.objects}\n\n`;
  } catch {
    text += `🗄 **Database:** Unable to fetch\n\n`;
  } finally {
    if (pool) await pool.end().catch(() => {});
  }

  // Discovery Cache
  try {
    const cacheStats = DiscoveryCacheService.getCacheStats();
    const modules = DiscoveryCacheService.listAll();
    const totalHits = (Object.values(cacheStats.hits) as any[]).reduce((a: number, b: number) => a + b, 0);
    const totalMisses = (Object.values(cacheStats.misses) as any[]).reduce((a: number, b: number) => a + b, 0);
    const total = Number(totalHits) + Number(totalMisses);
    const hitRate = total > 0 ? ((Number(totalHits) / total) * 100).toFixed(1) : 'N/A';

    text += `💾 **Discovery Cache:**\n`;
    text += `  Modules: ${modules.length}\n`;
    text += `  Hit rate: ${hitRate}%\n`;
    text += `  Hits: ${totalHits} | Misses: ${totalMisses}\n\n`;
  } catch {
    text += `💾 **Discovery Cache:** N/A\n\n`;
  }

  // Browser Pool
  try {
    const poolStats = SharedBrowserPool.getInstance().getStats();
    text += `🌐 **Browser Pool:**\n`;
    text += `  Launches: ${poolStats.launchCount}\n`;
    text += `  Reuses: ${poolStats.reuseCount}\n`;
    text += `  In use: ${poolStats.inUse ? 'Yes' : 'No'}\n`;
    text += `  Healthy: ${poolStats.isHealthy ? '✅' : '❌'}\n\n`;
  } catch {
    text += `🌐 **Browser Pool:** N/A\n\n`;
  }

  // Usage stats
  try {
    const { UsageTrackerService } = await import('./UsageTrackerService');
    const usage = UsageTrackerService.getSummary();
    text += `💰 **AI Usage:**\n`;
    text += `  Total tokens: ${usage.totalTokens.toLocaleString()}\n`;
    text += `  Total calls: ${usage.totalCalls}\n`;
    text += `  Total cost: $${usage.totalCost.toFixed(4)}\n\n`;
  } catch {
    // UsageTracker may not have getSummary — skip silently
  }

  text += `🕐 ${new Date().toISOString()}`;

  return text;
}

async function handleHelp(_chatId: number, _args: string[]): Promise<string> {
  let text = `🤖 **GoHybridAI Bot**\n\nAvailable commands:\n\n`;
  for (const cmd of commands) {
    text += `/${cmd.name} — ${cmd.description}\n`;
  }
  return text;
}

// ============================================================================
// Telegram API Helpers
// ============================================================================

async function sendMessage(chatId: number, text: string, parseMode: string = 'Markdown'): Promise<void> {
  if (!BOT_TOKEN) {
    appLogger.warn('[Telegram] No bot token configured, skipping message send');
    return;
  }

  const url = `${API_BASE}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      appLogger.error(`[Telegram] Failed to send message: ${response.status}`, { data });
    }
  } catch (err: any) {
    appLogger.error(`[Telegram] Send failed: ${err.message}`);
  }
}

async function setMyCommands(): Promise<void> {
  if (!BOT_TOKEN) return;

  const url = `${API_BASE}/setMyCommands`;
  const body = commands.map(c => ({ command: c.name, description: c.description }));

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: body }),
    });

    if (response.ok) {
      appLogger.info('[Telegram] Bot commands registered');
    } else {
      appLogger.warn(`[Telegram] Failed to register commands: ${response.status}`);
    }
  } catch (err: any) {
    appLogger.warn(`[Telegram] Could not register commands: ${err.message}`);
  }
}

// ============================================================================
// Webhook Handler (Express Route)
// ============================================================================

/**
 * Express route handler for Telegram webhook.
 * POST /api/telegram/webhook
 */
export async function handleWebhook(req: Request, res: Response): Promise<void> {
  if (!COMMANDS_ENABLED) {
    res.status(404).json({ error: 'Telegram commands not enabled' });
    return;
  }

  // Validate secret token (if configured)
  if (WEBHOOK_SECRET) {
    const headerSecret = req.header('X-Telegram-Bot-Api-Secret-Token');
    if (headerSecret !== WEBHOOK_SECRET) {
      appLogger.warn('[Telegram] Invalid webhook secret');
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
  }

  const update: TelegramUpdate = req.body;

  // We only care about messages
  const message = update.message || update.edited_message || update.channel_post;
  if (!message) {
    res.status(200).json({ ok: true });
    return;
  }

  const chatId = message.chat.id;
  const text = message.text || '';

  // Check if user is allowed
  if (ALLOWED_USERS.size > 0 && !ALLOWED_USERS.has(message.from?.id ?? 0)) {
    appLogger.warn(`[Telegram] Blocked unauthorized user: ${message.from?.username || message.from?.id}`);
    await sendMessage(chatId, '🚫 You are not authorized to use this bot.');
    res.status(200).json({ ok: true });
    return;
  }

  // Parse command
  if (!text.startsWith('/')) {
    res.status(200).json({ ok: true });
    return;
  }

  const parts = text.trim().split(/\s+/);
  const commandName = parts[0].toLowerCase().replace(/^\/+/, '');
  const args = parts.slice(1);

  appLogger.info(`[Telegram] Command received: /${commandName} from user ${message.from?.username || message.from?.id}`);

  // Find and execute handler
  const command = commands.find(c => c.name === commandName);
  if (!command) {
    await sendMessage(chatId, `❌ Unknown command: /${commandName}\n\nSend /help to see available commands.`);
    res.status(200).json({ ok: true });
    return;
  }

  try {
    const response = await command.handler(chatId, args);
    await sendMessage(chatId, response);
  } catch (err: any) {
    appLogger.error(`[Telegram] Command /${commandName} failed: ${err.message}`);
    await sendMessage(chatId, `❌ Error executing /${commandName}: ${err.message}`);
  }

  res.status(200).json({ ok: true });
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the Telegram command handler.
 * Registers bot commands and optionally sets the webhook URL.
 * Call this during server startup.
 */
export async function initialize(): Promise<void> {
  if (!COMMANDS_ENABLED || !BOT_TOKEN) {
    appLogger.info('[Telegram] Commands not enabled or no bot token. Skipping initialization.');
    return;
  }

  appLogger.info('[Telegram] Initializing command handler...');

  // Register commands with Telegram
  await setMyCommands();

  // Set webhook URL if provided
  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      const url = `${API_BASE}/setWebhook`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: WEBHOOK_SECRET || undefined,
          allowed_updates: ['message'],
        }),
      });

      if (response.ok) {
        appLogger.info(`[Telegram] Webhook set: ${webhookUrl}`);
      } else {
        appLogger.warn(`[Telegram] Failed to set webhook: ${response.status}`);
      }
    } catch (err: any) {
      appLogger.warn(`[Telegram] Could not set webhook: ${err.message}`);
    }
  } else {
    appLogger.info('[Telegram] No TELEGRAM_WEBHOOK_URL set. Configure webhook manually or use polling mode.');
  }
}
