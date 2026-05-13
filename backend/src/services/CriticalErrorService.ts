import fetch from 'node-fetch';
import { config } from '../../api/config';
import { appLogger } from '../utils/logger';

export enum ErrorSeverity {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    CRITICAL = 'CRITICAL'
}

export interface ErrorContext {
    ticketId?: string;
    module?: string;
    userId?: string;
    testId?: string;
    additionalData?: any;
}

export class CriticalErrorService {
    /**
     * Report a critical system error.
     * Logs to local logger and sends Telegram alert if configured.
     */
    static async reportError(
        message: string, 
        error?: any, 
        severity: ErrorSeverity = ErrorSeverity.HIGH,
        context: ErrorContext = {}
    ): Promise<void> {
        const timestamp = new Date().toLocaleString();
        const errorStack = error instanceof Error ? error.stack : (typeof error === 'object' ? JSON.stringify(error) : String(error || ''));
        
        // 1. Local Logging
        const logMethod = severity === ErrorSeverity.CRITICAL || severity === ErrorSeverity.HIGH ? 'error' : 'warn';
        appLogger[logMethod](`[CriticalError] ${severity}: ${message}`, { 
            error: errorStack, 
            context 
        });

        // 2. Telegram Alert (if enabled and severity is HIGH/CRITICAL)
        if (config.telegram.enabled && 
            config.telegram.botToken && 
            config.telegram.chatId && 
            (severity === ErrorSeverity.CRITICAL || severity === ErrorSeverity.HIGH)) {
            
            try {
                await this.sendTelegramAlert(message, severity, context, timestamp);
            } catch (tgErr: any) {
                console.warn(`[CriticalError] Failed to send Telegram alert: ${tgErr.message}`);
            }
        }
    }

    /**
     * Send alert to Telegram bot
     */
    private static async sendTelegramAlert(
        message: string, 
        severity: ErrorSeverity, 
        context: ErrorContext,
        timestamp: string
    ): Promise<void> {
        const { botToken, chatId } = config.telegram;
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

        // Format message with emojis
        const emoji = severity === ErrorSeverity.CRITICAL ? '🚨' : '⚠️';
        const environment = process.env.NODE_ENV || 'development';
        
        let text = `${emoji} *GoHybridAI Alert - ${severity}*\n\n`;
        text += `*Message:* ${message}\n`;
        text += `*Env:* \`${environment}\`\n`;
        text += `*Time:* ${timestamp}\n`;
        
        if (context.ticketId) text += `*Ticket:* \`${context.ticketId}\`\n`;
        if (context.module) text += `*Module:* \`${context.module}\`\n`;
        if (context.testId) text += `*Test ID:* \`${context.testId}\`\n`;

        const body = {
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown'
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(`Telegram API responded with ${response.status}: ${JSON.stringify(data)}`);
        }
    }

    /**
     * Specifically for AI Provider failures (all models down)
     */
    static async reportAiOutage(role: string, prompt: string, error: any): Promise<void> {
        await this.reportError(
            `AI Outage: Failed to fulfill role [${role}] - All models in fallback chain failed.`,
            error,
            ErrorSeverity.CRITICAL,
            { additionalData: { role, promptLength: prompt.length } }
        );
    }

    /**
     * Specifically for Database connection issues
     */
    static async reportDatabaseDown(error: any): Promise<void> {
        await this.reportError(
            'Database Connection Failure: Backend cannot reach PostgreSQL.',
            error,
            ErrorSeverity.CRITICAL
        );
    }
}
