/**
 * Object Repository API Routes
 *
 * RESTful endpoints for managing the UI element selector repository.
 * Mounts at /api/object-repo
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
    ObjectRepositoryService,
    PageElement,
    RepoStatistics,
} from '../../src/services/ObjectRepositoryService';
import { successResponse, errorResponse, validationError, notFoundError } from '../../api/utils/responseHelpers';
import { requireApiKey } from '../../api/utils/requestUtils';

export function createObjectRepoRouter() {
    const router = Router();

    // ─── Validation Schemas ─────────────────────────────────────

    const ElementSchema = z.object({
        page: z.string().min(1, 'Page is required'),
        section: z.string().optional(),
        elementName: z.string().min(1, 'Element name is required'),
        selector: z.string().min(1, 'Selector is required'),
        altSelectors: z.array(z.string()).optional(),
        type: z.enum(['button', 'input', 'link', 'select', 'textarea', 'dropdown', 'checkbox', 'file', 'table', 'other']),
        confidence: z.number().min(0).max(1),
        businessLogicHint: z.string().optional(),
        relatedModule: z.string().optional(),
        lastVerifiedAt: z.string().optional(),
        versionHistory: z.array(z.object({
            previousSelector: z.string(),
            newSelector: z.string(),
            changedBy: z.string(),
            changedAt: z.string(),
            reason: z.string().optional(),
        })).optional(),
    });

    // ─── GET /api/object-repo — List all elements ──────────────

    router.get('/', async (_req: Request, res: Response) => {
        try {
            const { page, module, type, search } = _req.query;
            let elements = await ObjectRepositoryService.getAll();

            if (page) {
                elements = elements.filter((e: PageElement) => e.page === page);
            }
            if (module) {
                elements = elements.filter((e: PageElement) => e.relatedModule === module);
            }
            if (type) {
                elements = elements.filter((e: PageElement) => e.type === type);
            }
            if (search) {
                const searchLower = (search as string).toLowerCase();
                elements = elements.filter((e: PageElement) =>
                    e.elementName.toLowerCase().includes(searchLower) ||
                    e.selector.toLowerCase().includes(searchLower)
                );
            }

            successResponse(res, elements);
        } catch (err: any) {
            errorResponse(res, 500, 'INTERNAL_ERROR', 'Failed to fetch elements', err.message);
        }
    });

    // ─── GET /api/object-repo/stats ────────────────────────────

    router.get('/stats', async (_req: Request, res: Response) => {
        try {
            const stats: RepoStatistics = await ObjectRepositoryService.getStatistics();
            successResponse(res, stats);
        } catch (err: any) {
            errorResponse(res, 500, 'INTERNAL_ERROR', 'Failed to fetch statistics', err.message);
        }
    });

    // ─── GET /api/object-repo/:id — Get single element ────────

    router.get('/:id', async (req: Request, res: Response) => {
        const element = await ObjectRepositoryService.getById(req.params.id);
        if (!element) {
            return notFoundError(res, 'Element');
        }
        successResponse(res, element);
    });

    // ─── POST /api/object-repo — Add elements ─────────────────

    router.post('/', async (req: Request, res: Response) => {
        if (!requireApiKey(req, res)) return;

        const parsed = z.array(ElementSchema).safeParse(req.body);
        if (!parsed.success) {
            return validationError(res, parsed.error.issues);
        }

        try {
            await ObjectRepositoryService.addElements(parsed.data);
            successResponse(res, { message: 'Elements added successfully' }, { status: 201 });
        } catch (err: any) {
            errorResponse(res, 500, 'INTERNAL_ERROR', 'Failed to add elements', err.message);
        }
    });

    // ─── PUT /api/object-repo/:id — Update element ────────────

    router.put('/:id', async (req: Request, res: Response) => {
        if (!requireApiKey(req, res)) return;

        const parsed = ElementSchema.partial().safeParse(req.body);
        if (!parsed.success) {
            return validationError(res, parsed.error.issues);
        }

        try {
            const updated = await ObjectRepositoryService.updateElement(req.params.id, parsed.data);
            if (!updated) {
                return notFoundError(res, 'Element');
            }
            successResponse(res, updated);
        } catch (err: any) {
            errorResponse(res, 500, 'INTERNAL_ERROR', 'Failed to update element', err.message);
        }
    });

    // ─── DELETE /api/object-repo/:id — Delete element ─────────

    router.delete('/:id', async (req: Request, res: Response) => {
        if (!requireApiKey(req, res)) return;

        const deleted = await ObjectRepositoryService.deleteElement(req.params.id);
        if (!deleted) {
            return notFoundError(res, 'Element');
        }
        successResponse(res, { message: 'Element deleted' });
    });

    // ─── POST /api/object-repo/:id/verify — Record verification ──

    router.post('/:id/verify', async (req: Request, res: Response) => {
        if (!requireApiKey(req, res)) return;

        const verifySchema = z.object({
            success: z.boolean(),
            jiraTicket: z.string().optional(),
            environment: z.string().optional(),
            executionId: z.string().optional(),
            failureReason: z.string().optional(),
        });

        const parsed = verifySchema.safeParse(req.body);
        if (!parsed.success) {
            return validationError(res, parsed.error.issues);
        }

        try {
            await ObjectRepositoryService.recordVerification({
                elementId: req.params.id,
                ...parsed.data,
            });
            successResponse(res, { message: 'Verification recorded' });
        } catch (err: any) {
            errorResponse(res, 500, 'INTERNAL_ERROR', 'Failed to record verification', err.message);
        }
    });

    // ─── POST /api/object-repo/import — Bulk import ───────────

    router.post('/import', async (req: Request, res: Response) => {
        if (!requireApiKey(req, res)) return;

        const parsed = z.array(ElementSchema).safeParse(req.body);
        if (!parsed.success) {
            return validationError(res, parsed.error.issues);
        }

        try {
            await ObjectRepositoryService.bulkImport(parsed.data);
            successResponse(res, { message: 'Bulk import complete', count: parsed.data.length }, { status: 201 });
        } catch (err: any) {
            errorResponse(res, 500, 'INTERNAL_ERROR', 'Failed to import elements', err.message);
        }
    });

    // ─── GET /api/object-repo/export — Export all ─────────────

    router.get('/export', async (_req: Request, res: Response) => {
        try {
            const exported = await ObjectRepositoryService.exportAll();
            res.set('Content-Type', 'application/json');
            res.set('Content-Disposition', 'attachment; filename="object-repository.json"');
            res.send(exported);
        } catch (err: any) {
            errorResponse(res, 500, 'INTERNAL_ERROR', 'Failed to export elements', err.message);
        }
    });

    // ─── GET /api/object-repo/search?q=... ────────────────────

    router.get('/search', async (req: Request, res: Response) => {
        const { q } = req.query;
        if (!q || typeof q !== 'string') {
            return validationError(res, [{ path: ['q'], message: 'Search query "q" is required', code: 'missing_field' }]);
        }

        try {
            const results = await ObjectRepositoryService.searchByName(q);
            successResponse(res, results);
        } catch (err: any) {
            errorResponse(res, 500, 'INTERNAL_ERROR', 'Search failed', err.message);
        }
    });

    return router;
}
