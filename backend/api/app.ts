/**
 * app.ts — Express application factory
 *
 * Reconstructed 2026-04-25 (original was binary-corrupted).
 *
 * Exports:
 *   createApp({ pool })  — returns configured Express app
 *   TelemetryService     — re-export for server.ts
 *   DbClient             — pg-compatible client type (re-export)
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';

// ── Sentry (optional — activate by setting SENTRY_DSN env var + npm install @sentry/node) ──
let Sentry: any = null;
if (process.env.SENTRY_DSN) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        Sentry = require('@sentry/node');
        Sentry.init({
            dsn: process.env.SENTRY_DSN,
            environment: process.env.NODE_ENV || 'production',
            tracesSampleRate: 0.1,
        });
    } catch {
        // @sentry/node not installed — error tracking disabled
    }
}
import { Pool } from 'pg';

import { TelemetryService, DbClient } from '../src/services/shared/TelemetryService';
import { AuthService }                 from '../src/services/shared/AuthService';
import swaggerUi                         from 'swagger-ui-express';
import { swaggerSpec }                   from './swagger';
import { createCoreRouter }             from './routes/coreRoutes';
import { createJiraRouter }             from './routes/jiraRoutes';
import { createCrawlerRouter }          from './routes/crawlerRoutes';
import { createHybridAutomationRouter } from './routes/hybridAutomationRoutes';
import { createMcpRouter }              from './routes/mcpRoutes';
import { createSettingsRouter }         from './routes/settingsRoutes';
import { createTestingRouter }          from '../src/routes/testingRouter';
import { authRouter }                   from '../src/routes/authRouter';
import { optionalAuth, requireAuth }    from './middleware/authMiddleware';
import { requireApiKey }                from './utils/requestUtils';
import { config }                       from './config';
import { SharedBrowserPool }            from '../src/services/discovery/SharedBrowserPool';

// Re-exports for backward compat (other api/ files import DbClient from here)
export { TelemetryService, DbClient };

export async function createApp({ pool }: { pool: Pool }): Promise<Express> {
    const app = express();

    // Telemetry
    TelemetryService.initialize(pool);
    AuthService.setPool(pool);

    // CORS
    const allowedOrigins = config.security.corsOrigins;
    console.log('[DEBUG] Allowed Origins:', allowedOrigins);

    app.use((req, res, next) => {
        if (req.method === 'OPTIONS') {
            console.log(`[DEBUG] CORS Preflight: ${req.method} ${req.path} from ${req.headers.origin}`);
        }
        next();
    });

    app.use(cors({
        origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
            // Allow requests with no origin (mobile apps, Postman, server-to-server)
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                console.warn(`[DEBUG] CORS Blocked origin: ${origin}`);
                callback(new Error(`Origin ${origin} not allowed by CORS`));
            }
        },
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'x-api-key'],
        credentials: true,
    }));

    // Body parsing
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // File uploads
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const upload = multer({
        dest: uploadsDir,
        limits: { fileSize: 50 * 1024 * 1024 },
    });

    // Swagger UI — available at /api-docs
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
        customSiteTitle: 'GoHybridAI API Docs',
        swaggerOptions: { persistAuthorization: true },
    }));
    // Raw OpenAPI spec
    app.get('/api-docs.json', (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(swaggerSpec);
    });

    // Routes
    const coreDeps = { pool, requireApiKey, upload };
    app.use('/api',                   createCoreRouter(coreDeps));
    app.use('/api/jira',              createJiraRouter({ pool, upload }));
    app.use('/api/crawler',           createCrawlerRouter({ upload }));
    app.use('/api/hybrid-automation', createHybridAutomationRouter());
    app.use('/api/mcp',               createMcpRouter());
    app.use('/api/auth',              authRouter);
    app.use('/api/settings',          requireAuth, createSettingsRouter(pool));
    app.use('/api/testing',           requireAuth, createTestingRouter(pool));

    // Health check — used by load balancer, PM2, and smoke tests
    const startTime = Date.now();
    const healthHandler = (_req: Request, res: Response) => {
        const poolStats = SharedBrowserPool.getInstance().getStats();
        res.json({
            ok:        true,
            uptime:    Math.floor((Date.now() - startTime) / 1000),
            browserPool: {
                active:    poolStats.activeContexts,
                inUse:     poolStats.inUse,
                healthy:   poolStats.isHealthy,
                idleSeconds: poolStats.idleSeconds,
            },
            timestamp: new Date().toISOString(),
        });
    };
    app.get('/api/health', healthHandler);
    app.get('/health',     healthHandler); // legacy path

    // 404
    app.use((_req: Request, res: Response) => {
        res.status(404).json({ error: 'Not Found', path: _req.path });
    });

    // Global error handler (4-arg signature required by Express)
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
        const status = (err.status as number) || (err.statusCode as number) || 500;
        const message = process.env.NODE_ENV === 'production'
            ? 'Internal Server Error'
            : (err.message || 'Unknown error');
        TelemetryService.add({ category: 'ERROR', source: 'App', message: `Unhandled: ${err.message}`, metadata: { stack: err.stack } });
        if (Sentry && status >= 500) Sentry.captureException(err);
        res.status(status).json({ error: message });
    });

    return app;
}
