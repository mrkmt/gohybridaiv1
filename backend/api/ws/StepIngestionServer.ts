import { WebSocket, WebSocketServer } from 'ws';
import http from 'http';
import { AiCachingService } from '../../src/services/AiCachingService';

/**
 * Module Knowledge Interface
 * Stores route/URL mappings for each module based on ingested step data
 */
interface ModuleKnowledge {
    moduleName: string;
    menuLabel: string;
    route: string;
    url: string;
    networkApiMappings: Record<string, string>; // API endpoint -> Menu label mapping
    lastUpdated: string;
}

/**
 * Network Log Entry Interface
 */
interface NetworkLogEntry {
    url: string;
    method: string;
    requestBody?: any;
    responseBody?: any;
    status: number;
    timestamp: number;
}

/**
 * Ingested Step Data Interface
 */
interface IngestedStepData {
    stepId: string;
    action: string;
    selector?: string;
    url: string;
    currentRoute: string;
    networkLogs: NetworkLogEntry[];
    timestamp: number;
}

/**
 * Step Ingestion Server
 * 
 * Handles real-time step ingestion from browser extension or test runner.
 * Implements intelligent network log mapping to correlate API responses with UI routes.
 */
export class StepIngestionServer {
    private wss: WebSocketServer;
    private moduleKnowledgeCache: Map<string, ModuleKnowledge> = new Map();
    private ingestedSteps: Map<string, IngestedStepData[]> = new Map(); // sessionId -> steps
    private readonly CACHE_CATEGORY = 'module-knowledge';

    constructor() {
        this.wss = new WebSocketServer({ noServer: true });
        this.setupHandlers();
    }

    public handleUpgrade(request: http.IncomingMessage, socket: any, head: Buffer): void {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
            this.wss.emit('connection', ws, request);
        });
    }

    private setupHandlers(): void {
        this.wss.on('connection', (ws: WebSocket) => {
            console.log('[StepIngestionServer] New client connected');

            ws.on('message', (message: Buffer) => {
                try {
                    const data = JSON.parse(message.toString());
                    this.handleMessage(ws, data);
                } catch (error: any) {
                    console.error('[StepIngestionServer] Message parse error:', error.message);
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
                }
            });

            ws.on('close', () => {
                console.log('[StepIngestionServer] Client disconnected');
            });

            ws.on('error', (error: Error) => {
                console.error('[StepIngestionServer] WebSocket error:', error.message);
            });
        });
    }

    private handleMessage(ws: WebSocket, data: any): void {
        switch (data.type) {
            case 'step-ingested':
                this.handleStepIngested(ws, data.payload);
                break;
            case 'session-start':
                this.handleSessionStart(ws, data.payload);
                break;
            case 'session-end':
                this.handleSessionEnd(ws, data.payload);
                break;
            case 'get-module-knowledge':
                this.handleGetModuleKnowledge(ws, data.payload);
                break;
            default:
                console.warn('[StepIngestionServer] Unknown message type:', data.type);
        }
    }

    /**
     * Handle 'step-ingested' event
     * Captures and stores the currentRoute (URL) for each module
     * Implements Network Log Mapping to correlate API responses with menu labels
     */
    private handleStepIngested(ws: WebSocket, payload: {
        sessionId: string;
        stepId: string;
        action: string;
        selector?: string;
        url: string;
        currentRoute: string;
        networkLogs: NetworkLogEntry[];
        moduleName?: string;
        menuLabel?: string;
        timestamp: number;
    }): void {
        const { sessionId, stepId, action, selector, url, currentRoute, networkLogs, moduleName, menuLabel } = payload;

        console.log(`[StepIngestionServer] Step ingested: ${stepId} (${action}) in session ${sessionId}`);

        // Store ingested step
        if (!this.ingestedSteps.has(sessionId)) {
            this.ingestedSteps.set(sessionId, []);
        }
        this.ingestedSteps.get(sessionId)!.push({
            stepId,
            action,
            selector,
            url,
            currentRoute,
            networkLogs,
            timestamp: payload.timestamp || Date.now(),
        });

        // Update module knowledge if moduleName/menuLabel provided
        if (moduleName && menuLabel) {
            this.updateModuleKnowledge(moduleName, menuLabel, currentRoute, networkLogs);
        }

        // Acknowledge receipt
        ws.send(JSON.stringify({
            type: 'step-acknowledged',
            stepId,
            sessionId,
            capturedRoute: currentRoute,
        }));
    }

    /**
     * Update Module Knowledge with route and network API mappings
     * Parses network logs to find menu data APIs (e.g., GetUserLevelMenuData)
     * and maps the menu label to its specific Route/URL
     */
    private updateModuleKnowledge(
        moduleName: string,
        menuLabel: string,
        currentRoute: string,
        networkLogs: NetworkLogEntry[]
    ): void {
        const cacheKey = `${moduleName}:${menuLabel}`;
        const existingKnowledge = this.moduleKnowledgeCache.get(cacheKey);

        // Build network API mappings
        const networkApiMappings: Record<string, string> = {};

        for (const log of networkLogs) {
            // Check if response contains menu data
            const responseBody = log.responseBody;
            if (responseBody) {
                // Detect menu data patterns in API responses
                const menuDataPatterns = [
                    'GetUserLevelMenuData',
                    'menuData',
                    'menuItems',
                    'navigation',
                    'permissions',
                ];

                const responseStr = JSON.stringify(responseBody).toLowerCase();
                for (const pattern of menuDataPatterns) {
                    if (responseStr.includes(pattern.toLowerCase())) {
                        // Map this API endpoint to the menu label
                        const apiUrl = this.extractBaseUrl(log.url);
                        networkApiMappings[apiUrl] = menuLabel;
                        console.log(`[StepIngestionServer] Network Log Mapping: ${apiUrl} -> "${menuLabel}"`);
                        break;
                    }
                }
            }
        }

        const knowledge: ModuleKnowledge = {
            moduleName,
            menuLabel,
            route: currentRoute,
            url: this.extractBaseUrl(currentRoute),
            networkApiMappings: {
                ...(existingKnowledge?.networkApiMappings || {}),
                ...networkApiMappings,
            },
            lastUpdated: new Date().toISOString(),
        };

        this.moduleKnowledgeCache.set(cacheKey, knowledge);

        // Persist to AI cache for long-term storage
        AiCachingService.setCache(
            { cacheKey, knowledge },
            this.CACHE_CATEGORY as 'plan' | 'script',
            knowledge,
            7 * 24 * 60 * 60 * 1000 // 7 days TTL
        );

        console.log(`[StepIngestionServer] Module knowledge updated: "${moduleName} > ${menuLabel}" -> ${currentRoute}`);
    }

    /**
     * Handle session start
     */
    private handleSessionStart(ws: WebSocket, payload: { sessionId: string }): void {
        const { sessionId } = payload;
        this.ingestedSteps.set(sessionId, []);
        console.log(`[StepIngestionServer] Session started: ${sessionId}`);
        ws.send(JSON.stringify({ type: 'session-started', sessionId }));
    }

    /**
     * Handle session end
     * Returns all ingested steps and module knowledge for the session
     */
    private handleSessionEnd(ws: WebSocket, payload: { sessionId: string }): void {
        const { sessionId } = payload;
        const steps = this.ingestedSteps.get(sessionId) || [];
        const moduleKnowledge = Array.from(this.moduleKnowledgeCache.values());

        console.log(`[StepIngestionServer] Session ended: ${sessionId} (${steps.length} steps ingested)`);

        ws.send(JSON.stringify({
            type: 'session-ended',
            sessionId,
            stepCount: steps.length,
            steps,
            moduleKnowledge,
        }));

        // Optionally clean up session data after a delay
        setTimeout(() => {
            this.ingestedSteps.delete(sessionId);
        }, 60000); // Keep for 1 minute for potential re-requests
    }

    /**
     * Handle get-module-knowledge request
     */
    private handleGetModuleKnowledge(ws: WebSocket, payload: { moduleName?: string; menuLabel?: string }): void {
        const { moduleName, menuLabel } = payload;

        let knowledge: ModuleKnowledge[];

        if (moduleName && menuLabel) {
            const cacheKey = `${moduleName}:${menuLabel}`;
            const single = this.moduleKnowledgeCache.get(cacheKey);
            knowledge = single ? [single] : [];
        } else if (moduleName) {
            knowledge = Array.from(this.moduleKnowledgeCache.values()).filter(k => k.moduleName === moduleName);
        } else {
            knowledge = Array.from(this.moduleKnowledgeCache.values());
        }

        ws.send(JSON.stringify({
            type: 'module-knowledge',
            count: knowledge.length,
            knowledge,
        }));
    }

    /**
     * Extract base URL without query parameters
     */
    private extractBaseUrl(url: string): string {
        try {
            const parsed = new URL(url);
            return `${parsed.origin}${parsed.pathname}`;
        } catch {
            return url;
        }
    }

    /**
     * Get all module knowledge (for external services)
     */
    public getAllModuleKnowledge(): ModuleKnowledge[] {
        return Array.from(this.moduleKnowledgeCache.values());
    }

    /**
     * Get module knowledge for a specific module/menu
     */
    public getModuleKnowledge(moduleName: string, menuLabel: string): ModuleKnowledge | undefined {
        const cacheKey = `${moduleName}:${menuLabel}`;
        return this.moduleKnowledgeCache.get(cacheKey);
    }

    /**
     * Get ingested steps for a session
     */
    public getSessionSteps(sessionId: string): IngestedStepData[] {
        return this.ingestedSteps.get(sessionId) || [];
    }

    /**
     * Load module knowledge from cache
     */
    public loadModuleKnowledgeFromCache(): void {
        const cached = AiCachingService.getCache<ModuleKnowledge[]>(
            { category: 'all' },
            this.CACHE_CATEGORY as 'plan' | 'script'
        );

        if (cached && Array.isArray(cached)) {
            for (const knowledge of cached) {
                const cacheKey = `${knowledge.moduleName}:${knowledge.menuLabel}`;
                this.moduleKnowledgeCache.set(cacheKey, knowledge);
            }
            console.log(`[StepIngestionServer] Loaded ${cached.length} module knowledge entries from cache`);
        }
    }
}

/**
 * Singleton instance manager
 */
let stepIngestionServerInstance: StepIngestionServer | null = null;

export function initializeStepIngestionServer(): StepIngestionServer {
    if (!stepIngestionServerInstance) {
        stepIngestionServerInstance = new StepIngestionServer();
        stepIngestionServerInstance.loadModuleKnowledgeFromCache();
    }
    return stepIngestionServerInstance;
}

export function getStepIngestionServer(): StepIngestionServer | null {
    return stepIngestionServerInstance;
}
