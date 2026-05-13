import './playwright-augment';

import { Pool } from 'pg';
import http from 'http';
import url from 'url';
import jwt from 'jsonwebtoken';
import { WebSocket, WebSocketServer, WebSocket as WSClient } from 'ws';

// Augment WebSocket with auth fields
interface AuthedWebSocket extends WSClient {
    _wsAuthenticated?: boolean;
    _wsUserId?: string;
    _wsSubscribedChannels?: Set<string>;
}
import { createApp, TelemetryService } from './app';
import { MigrationManager } from '../src/services/shared/MigrationManager'; // Updated
import { AuditLogService } from '../src/services/shared/AuditLogService'; // Updated (moved to shared)

import { config } from './config';
const JWT_SECRET = config.server.jwtSecret;
import { storageService } from './StorageService';
import { JobEvents } from './WorkerQueue';
import { initializeStepIngestionServer } from './ws/StepIngestionServer';
import { assertEnvironmentValid } from '../src/utils/EnvironmentValidator';

const pool = new Pool({
    user: config.postgres.user,
    host: config.postgres.host,
    database: config.postgres.database,
    password: config.postgres.password,
    port: config.postgres.port,
    max: config.postgres.max,
    idleTimeoutMillis: config.postgres.idleTimeoutMillis,
    connectionTimeoutMillis: config.postgres.connectionTimeoutMillis,
});

import { DiscoveryRunService } from '../src/services/discovery/DiscoveryRunService'; // Updated
import { SystemHealthService } from '../src/services/shared/SystemHealthService'; // Updated
import { JiraSyncController } from '../src/controllers/JiraSyncController';
import { SharedBrowserPool } from '../src/services/discovery/SharedBrowserPool'; // Updated

async function startServer() {
    try {
        // Validate environment before starting
        assertEnvironmentValid();

        await storageService.init();
        await MigrationManager.run(pool);

        // Expose pool globally for services that don't have dependency injection (like TelegramBot)
        (global as any).dbPool = pool;

        // Initialize services with pool
        AuditLogService.setPool(pool);
        JiraSyncController.setPool(pool);

        // SmartSkillManager — DB-only writes (eliminates file race condition for 5-user deployment)
        const { SmartSkillManager } = await import('../src/services/skills/SmartSkillManager');
        SmartSkillManager.setPool(pool);

        // System Health Pre-check (env-gated for dev vs production)
        const healthCheckEnabled = process.env.ENABLE_HEALTH_CHECKS === 'true';
        if (healthCheckEnabled) {
            const health = await SystemHealthService.checkHealth(pool);
            console.log(`[Go-Hybrid AI] System Health: ${health.status}`, health.details);
            if (health.status === 'FAIL') {
                console.warn('[Go-Hybrid AI] Critical dependencies offline. Server may not function correctly.');
            }
        }

        // Clean up any dangling runs from previous sessions
        DiscoveryRunService.markDanglingRunsAsPaused();

        const app = await createApp({ pool });
        const server = http.createServer(app);

        // Initialize WebSocket Servers with noServer: true to avoid conflicts
        const wss = new WebSocketServer({ noServer: true });
        const stepWss = initializeStepIngestionServer();

        // Route WebSocket upgrade requests to the WSS server
        server.on('upgrade', (req, socket, head) => {
            const pathname = url.parse(req.url || '').pathname;
            
            if (pathname === '/ws') {
                wss.handleUpgrade(req, socket, head, (ws) => {
                    wss.emit('connection', ws, req);
                });
            } else if (pathname === '/ws/steps' || pathname === '/ws/ingest') {
                console.log(`[WS Upgrade] Routing to StepIngestionServer: ${pathname}`);
                stepWss.handleUpgrade(req, socket, head);
            } else {
                console.warn(`[WS Upgrade] Rejected unknown path: ${pathname}`);
                socket.destroy();
            }
        });

        // WebSocket client-to-server auth
        wss.on('connection', (ws: AuthedWebSocket, request) => {
            let authenticated = false;
            let userId: string = '';

            const authTimer = setTimeout(() => {
                if (!authenticated) {
                    ws.close(1008, 'WebSocket authentication timeout');
                }
            }, 10000);

            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message.toString());

                    if (data.type === 'auth' && !authenticated) {
                        clearTimeout(authTimer);
                        const token = data.token;
                        if (token) {
                            try {
                                const decoded = jwt.verify(token, JWT_SECRET) as any;
                                authenticated = true;
                                userId = decoded.sub || '';
                                ws._wsAuthenticated = true;
                                ws._wsUserId = userId;
                                ws._wsSubscribedChannels = new Set<string>();
                                ws.send(JSON.stringify({ type: 'auth_ok', userId }));
                                console.log(`[WS] Client authenticated: ${userId}`);
                            } catch {
                                ws.close(1008, 'Invalid token');
                            }
                        }
                        return;
                    }

                    if (!authenticated) return;

                    if (data.type === 'subscribe' && data.channel) {
                        if (!ws._wsSubscribedChannels) ws._wsSubscribedChannels = new Set();
                        ws._wsSubscribedChannels.add(data.channel);
                        console.log(`[WS] Client ${userId} subscribed to: ${data.channel}`);
                        ws.send(JSON.stringify({ type: 'subscribed', channel: data.channel }));
                        return;
                    }

                    if (data.type === 'LIVE_STEP') {
                        wss.clients.forEach((client) => {
                            if (client !== ws && client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify(data));
                            }
                        });
                    }
                } catch (e) {
                    console.error('[WS] Message parsing error', e);
                }
            });

            console.log('[WS] New client connected (awaiting auth)');
        });

        function sendToRelevantClients(data: unknown, targetUserId?: string) {
            const payload = (data as any)?.payload;
            const ticketId = payload?.ticketId;
            const channel = ticketId ? `execution:${ticketId}` : null;

            wss.clients.forEach((client: any) => {
                if (client.readyState !== WebSocket.OPEN) return;
                if (!client._wsAuthenticated) return;

                if (targetUserId && client._wsUserId !== targetUserId) return;

                if (channel && (client._wsSubscribedChannels?.size ?? 0) > 0) {
                    if (!client._wsSubscribedChannels!.has(channel)) return;
                }

                client.send(JSON.stringify(data));
            });
        }

        TelemetryService.subscribe((log: any) => {
            wss.clients.forEach((c: AuthedWebSocket) => {
                if (c.readyState === WebSocket.OPEN && c._wsAuthenticated) {
                    c.send(JSON.stringify({ type: 'TELEMETRY_LOG', log }));
                }
            });
        });

        // ─── Execution event broadcast ──────────────────────────────────────
        // Orchestrator emits flat payloads: { ticketId, userId, ... }.
        // Guards (same for log/progress/complete/failed):
        //   1. Socket must be authenticated.
        //   2. If the event carries a userId, only that user's sockets receive.
        //   3. If event has a ticketId, socket must be subscribed to
        //      `execution:<ticketId>`.
        // This prevents cross-user leakage when multiple testers run
        // executions against different tickets concurrently.
        const broadcastExecutionEvent = (
            eventType: 'execution:log' | 'execution:progress' | 'execution:complete' | 'execution:failed' | 'execution:step',
            data: any,
            // `execution:log` is already sent as a raw string (`data`) for
            // backward compat; others are wrapped in {type,payload,timestamp}.
            wrapPayload: boolean
        ) => {
            const ticketId = data?.ticketId;
            const userId = data?.userId;
            const channel = ticketId ? `execution:${ticketId}` : null;

            const msg = wrapPayload
                ? JSON.stringify({ type: eventType, payload: data, timestamp: new Date().toISOString() })
                : JSON.stringify(data);

            wss.clients.forEach((c: AuthedWebSocket) => {
                if (c.readyState !== WebSocket.OPEN || !c._wsAuthenticated) return;
                if (userId && c._wsUserId && c._wsUserId !== userId) return;
                if (channel && !c._wsSubscribedChannels?.has(channel)) return;
                c.send(msg);
            });
        };

        JobEvents.on('execution:log',      (data) => broadcastExecutionEvent('execution:log', data, false));
        JobEvents.on('execution:progress', (data) => broadcastExecutionEvent('execution:progress', data, true));
        JobEvents.on('execution:complete', (data) => broadcastExecutionEvent('execution:complete', data, true));
        JobEvents.on('execution:failed',   (data) => broadcastExecutionEvent('execution:failed', data, true));
        // S4-5: structured step events — same auth/userId/channel guards as the
        // others, wrapped in payload envelope so the FE can distinguish kind.
        JobEvents.on('execution:step',     (data) => broadcastExecutionEvent('execution:step', data, true));

        JobEvents.on('pipeline:progress', (data) => {
            const payload = data;
            const ticketId = payload?.ticketId;
            const channel = ticketId ? `execution:${ticketId}` : null;

            wss.clients.forEach((c: AuthedWebSocket) => {
                if (c.readyState !== WebSocket.OPEN || !c._wsAuthenticated) return;

                if (channel && (c._wsSubscribedChannels?.size ?? 0) > 0) {
                    if (!c._wsSubscribedChannels!.has(channel)) return;
                }

                c.send(JSON.stringify({ type: 'pipeline:progress', payload: data, timestamp: new Date().toISOString() }));
            });
        });

        const port = process.env.PORT || 3001;
        server.listen(port, async () => {
            console.log(`[Go-Hybrid AI] Forensic Backend running at http://localhost:${port}`);
            console.log(`[Go-Hybrid AI] Live Streaming (WS) active on same port`);

            const JIRA_SYNC_ENABLED = process.env.JIRA_SYNC_ENABLED === 'true';
            if (JIRA_SYNC_ENABLED) {
                console.log('[Go-Hybrid AI] Initial Jira sync requested (background)...');
                JiraSyncController.syncActiveTickets({} as any, { status: () => ({ json: () => {} }) } as any)
                    .catch(err => console.error('[Go-Hybrid AI] Background Jira sync failed:', err.message));
            } else {
                console.log('[Go-Hybrid AI] Live Search mode active (no background sync)');
            }

            const browserPool = SharedBrowserPool.getInstance();
            browserPool.startHealthMonitoring();
            console.log('[Go-Hybrid AI] SharedBrowserPool initialized');

            console.log('[Go-Hybrid AI] Bootstrapping Locator Knowledge Base...');
            import('../src/services/skills/SkillRegistryService').then(({ SkillRegistryService }) => {
                SkillRegistryService.bootstrapFromDiscoveryCache()
                    .then(count => console.log(`[Go-Hybrid AI] Bootstrapped ${count} selector hints.`))
                    .catch(err => console.warn('[Go-Hybrid AI] Skill bootstrap failed:', err.message));
            });

            try {
                const { initialize: initTelegram } = await import('../src/services/shared/TelegramCommandHandler');
                await initTelegram();
            } catch (err: any) {
                if (err.code !== 'MODULE_NOT_FOUND') {
                    console.warn('[Go-Hybrid AI] Telegram command handler init skipped:', err.message);
                }
            }
        });

        const shutdown = async (signal: string) => {
            console.log(`\n[Go-Hybrid AI] Received ${signal}. Shutting down gracefully...`);
            wss.clients.forEach(client => { try { client.close(); } catch { } });
            wss.close();
            try { await SharedBrowserPool.getInstance().shutdown(); } catch { }
            server.close(() => {
                pool.end().then(() => {
                    console.log('[Go-Hybrid AI] Database pool closed.');
                    process.exit(0);
                }).catch(() => process.exit(1));
            });
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

startServer();
