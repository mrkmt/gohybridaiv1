import { Request, Response, NextFunction } from 'express';

export function globalErrorHandler(err: any, req: Request, res: Response, next: NextFunction) {
    console.error(`[GlobalError] Unhandled error:`, err);

    const status = err.status || err.statusCode || 500;
    const message = err.message || 'Internal Server Error';

    // Safety check for sensitive info in development
    const details = process.env.NODE_ENV === 'development' ? err.stack : undefined;

    res.status(status).json({
        error: {
            code: err.code || (status >= 500 ? 'INTERNAL_ERROR' : 'APPLICATION_ERROR'),
            message,
            ...(details ? { details } : {}),
        },
        path: req.path,
        timestamp: new Date().toISOString()
    });
}
