import { Request, Response } from 'express';

// ============================================================
// Standard response envelope helpers
// ============================================================

/**
 * Send a success response with standardized { data } envelope.
 * For 201 Created, automatically sets Location header if resourceId is provided.
 */
export function successResponse(
    res: Response,
    data: unknown,
    options?: { status?: number; meta?: Record<string, unknown>; location?: string }
) {
    const status = options?.status ?? 200;
    const body: Record<string, unknown> = { data };

    if (options?.meta !== undefined) {
        body.meta = options.meta;
    }

    const headers: Record<string, string> = {};
    if (options?.location) {
        headers['Location'] = options.location;
    }

    return res.status(status).json(body);
}

/**
 * Send an error response with standardized { success: false, error: { code, message, details } } envelope.
 */
export function errorResponse(
    res: Response,
    status: number,
    code: string,
    message: string,
    details?: unknown
) {
    const body: Record<string, unknown> = {
        success: false,
        error: {
            code,
            message,
        },
    };

    if (details !== undefined) {
        (body.error as Record<string, unknown>).details = details;
    }

    return res.status(status).json(body);
}

/**
 * Shorthand for validation error (400/422).
 */
export function validationError(res: Response, details: unknown, message = 'Request validation failed') {
    return errorResponse(res, 422, 'VALIDATION_ERROR', message, details);
}

/**
 * Shorthand for not found error (404).
 */
export function notFoundError(res: Response, resource = 'Resource') {
    return errorResponse(res, 404, 'NOT_FOUND', `${resource} not found`);
}

/**
 * Shorthand for internal server error (500).
 */
export function internalError(res: Response, message = 'Internal server error') {
    return errorResponse(res, 500, 'INTERNAL_ERROR', message);
}

/**
 * Shorthand for unauthorized error (401).
 */
export function unauthorizedError(res: Response, message = 'Authentication required') {
    return errorResponse(res, 401, 'UNAUTHORIZED', message);
}

/**
 * Shorthand for forbidden error (403).
 */
export function forbiddenError(res: Response, message = 'You do not have permission to access this resource') {
    return errorResponse(res, 403, 'FORBIDDEN', message);
}

/**
 * Shorthand for conflict error (409).
 */
export function conflictError(res: Response, message = 'Resource conflict') {
    return errorResponse(res, 409, 'CONFLICT', message);
}

/**
 * Shorthand for rate limit error (429).
 */
export function rateLimitError(res: Response, retryAfter?: number) {
    const body: Record<string, unknown> = {
        success: false,
        error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Rate limit exceeded. Please try again later.',
        },
    };

    const headers: Record<string, string> = {};
    if (retryAfter) {
        headers['Retry-After'] = String(retryAfter);
    }

    return res.status(429).set(headers).json(body);
}
