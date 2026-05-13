import fetch from 'node-fetch';
import { config } from '../../api/config';
import { appLogger } from '../utils/logger';
import { SystemHealthService } from './shared/SystemHealthService';
import { AIProviderService } from '../../api/AIProviderService';
import { UsageTrackerService } from './shared/UsageTrackerService';

export class TelegramBotService {
    private static lastUpdateId = 0;
    private static isPolling = false;
    private static pollInterval: NodeJS.Timeout | null = null;

    /**
     * Start polling for Telegram updates
     */
    static startPolling(): void {
        if (!config.telegram.enabled || !config.telegram.botToken) {
            appLogger.info('[TelegramBot] Bot integration disabled or token missing.');
            return;
        }

        if (this.isPolling) return;

        this.isPolling = true;
        appLogger.info('[TelegramBot] Starting command listener...');
        
        this.pollInterval = setInterval(() => this.pollUpdates(), 5000);
    }

    /**
     * Stop polling
     */
    static stopPolling(): void {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this.isPolling = false;
    }

    private static async pollUpdates(): Promise<void> {
        const { botToken } = config.telegram;
        const url = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=10`;

        try {
            const response = await fetch(url);
            if (!response.ok) return;

            const data = await response.json();
            if (data.ok && data.result.length > 0) {
                for (const update of data.result) {
                    this.lastUpdateId = update.update_id;
                    if (update.message && update.message.text) {
                        await this.handleCommand(update.message);
                    }
                }
            }
        } catch (err: any) {
            // Silently handle polling errors to prevent log spam
        }
    }

    private static async handleCommand(message: any): Promise<void> {
        const text = message.text.toLowerCase();
        const chatId = message.chat.id;

        // Security: Only respond to the authorized chat ID
        if (String(chatId) !== String(config.telegram.chatId)) {
            appLogger.warn(`[TelegramBot] Unauthorized command attempt from chat ${chatId}`);
            return;
        }

        if (text === '/start' || text === '/help') {
            await this.sendMessage(chatId, 
                "🤖 *GoHybridAI Bot Active*\n\n" +
                "Available commands:\n" +
                "▫️ `/status` - Quick system health check\n" +
                "▫️ `/dashboard` - Summary of AI & Automation stats\n" +
                "▫️ `/health` - Detailed infrastructure status"
            );
        } else if (text === '/status') {
            const health = await SystemHealthService.checkHealth((global as any).dbPool);
            const statusEmoji = health.status === 'OK' ? '✅' : (health.status === 'DEGRADED' ? '⚠️' : '🚨');
            await this.sendMessage(chatId, `${statusEmoji} *System Status:* ${health.status}\n\nDB: ${health.details.database}\nAI: ${health.details.localAI}`);
        } else if (text === '/health') {
            const health = await SystemHealthService.checkHealth((global as any).dbPool);
            const cliStatuses = AIProviderService.getCliStatuses();
            
            let response = `🏥 *Infrastructure Health*\n\n`;
            response += `▫️ *System:* ${health.status}\n`;
            response += `▫️ *PostgreSQL:* ${health.details.database}\n`;
            response += `▫️ *Local AI:* ${health.details.localAI}\n\n`;
            response += `🛡️ *AI CLI Providers:*\n`;
            
            for (const cli of cliStatuses) {
                const emoji = cli.installed && cli.authenticated ? '✅' : '❌';
                response += `${emoji} ${cli.name}: ${cli.installed ? 'Installed' : 'Missing'} (${cli.authenticated ? 'Authed' : 'No Auth'})\n`;
            }
            
            await this.sendMessage(chatId, response);
        } else if (text === '/dashboard') {
            const usageToday = UsageTrackerService.getTodaySummary();
            
            let response = `📊 *Automation Dashboard (Today)*\n\n`;
            response += `▫️ *Tokens Used:* ${usageToday.totalTokens.toLocaleString()}\n`;
            response += `▫️ *AI Calls:* ${usageToday.totalCalls}\n`;
            response += `▫️ *Estimated Cost:* $${usageToday.totalCost.toFixed(4)}\n\n`;
            response += `_Run /health for infrastructure details._`;
            
            await this.sendMessage(chatId, response);
        }
    }

    private static async sendMessage(chatId: number, text: string): Promise<void> {
        const { botToken } = config.telegram;
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'Markdown'
            })
        });
    }
}
