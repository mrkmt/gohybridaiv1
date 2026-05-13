import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { appLogger } from '../../src/utils/logger';

declare global {
    namespace Express {
        interface Request {
            id: string;
        }
    }
}

/**
 * Middleware to add a unique request ID to each incoming request.
 * The ID is added to the request object and returned in the 'X-Request-Id' response header.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
    req.id = (req.headers['x-request-id'] as string) || uuidv4();
    res.setHeader('X-Request-Id', req.id);
    
    // Log with low-level details for correlation
    appLogger.info('Incoming request', { 
        method: req.method, 
        url: req.url, 
        requestId: req.id,
        ip: req.ip
    });
    
    next();
}
