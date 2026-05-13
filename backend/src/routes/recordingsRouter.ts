import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { DbClient } from '../services/shared/TelemetryService';
import { storageService } from '../../api/StorageService';
import { IntegrityService } from '../../api/IntegrityService';
import { VisualForensicsService } from '../../api/VisualForensicsService';
import { LocalAIService } from '../../api/LocalAIService';
import { config } from '../../api/config';
import { redactSensitive } from '../../api/utils/security';
import {
    isUuid, parseLimit, parsePage, ASSET_COLUMN_MAP, TriageSchema
} from '../../api/utils/requestUtils';
import { successResponse, errorResponse, validationError, notFoundError, internalError } from '../../api/utils/responseHelpers';

export function createRecordingsRouter(deps: { pool: DbClient, upload: any }) {
    const router = Router();

    router.get('/', async (req, res) => {
        const limit = parseLimit(req.query.limit, 50);
        const page = parsePage(req.query.page, 1);
        const offset = (page - 1) * limit;
        try {
            const { rows } = await deps.pool.query(`SELECT id, session_id, app_version, environment, video_url, screenshot_url, manual_snapshot_url, is_admin, jira_id, test_url, created_at FROM recordings ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
            const countResult = await deps.pool.query('SELECT COUNT(*) FROM recordings');
            res.json({ data: rows, pagination: { page, limit, total: parseInt(countResult.rows[0].count) } });
        } catch (err: any) { internalError(res, 'Database error'); }
    });

    router.get('/:id', async (req, res) => {
        const id = req.params.id;
        if (!isUuid(id)) return errorResponse(res, 400, 'INVALID_INPUT', 'Invalid ID');
        try {
            const { rows } = await deps.pool.query('SELECT * FROM recordings WHERE id = $1', [id]);
            if (rows.length === 0) return notFoundError(res, 'Recording');
            successResponse(res, rows[0]);
        } catch (err: any) { internalError(res, 'Database error'); }
    });

    router.put('/:id/make-standard', async (req, res) => {
        const id = req.params.id;
        if (!isUuid(id)) return errorResponse(res, 400, 'INVALID_INPUT', 'Invalid ID');
        try {
            const { rows } = await deps.pool.query('SELECT app_version as module FROM recordings WHERE id = $1', [id]);
            if (rows.length === 0) return notFoundError(res, 'Recording');
            const moduleName = rows[0].module;
            await deps.pool.query('UPDATE recordings SET is_admin = false WHERE app_version = $1', [moduleName]);
            await deps.pool.query('UPDATE recordings SET is_admin = true WHERE id = $1', [id]);
            successResponse(res, { message: `Recording marked as Admin Standard for module: ${moduleName}` });
        } catch (err: any) { internalError(res, 'Failed to update standard'); }
    });

    router.post('/:id/assets', deps.upload.single('file'), async (req, res) => {
        const id = req.params.id;
        if (!isUuid(id) || !req.file) return errorResponse(res, 400, 'INVALID_INPUT', 'Invalid recording id or no file');
        const type = req.body.type || 'screenshot';
        const column = ASSET_COLUMN_MAP[type];
        const allowedColumns = ['screenshot_url', 'video_url', 'manual_snapshot_url'];
        if (!column || !allowedColumns.includes(column)) return errorResponse(res, 400, 'INVALID_INPUT', `Invalid asset type: ${type}`);
        const ext = req.file.originalname.split('.').pop();
        const objectName = `${id}/${type}_${Date.now()}.${ext}`;
        try {
            const fileBuffer = fs.readFileSync(req.file.path);
            await storageService.uploadFile(objectName, fileBuffer);
            try { fs.unlinkSync(req.file.path); } catch (e) { }
            await deps.pool.query(`UPDATE recordings SET ${column} = $1 WHERE id = $2`, [objectName, id]);
            successResponse(res, { message: 'Asset uploaded successfully', path: objectName, type });
        } catch (err: any) { errorResponse(res, 500, 'SERVICE_ERROR', 'Failed to upload asset', err.message); }
    });

    router.get('/:id/assets/:type', async (req, res) => {
        const { id, type } = req.params;
        if (!isUuid(id)) return errorResponse(res, 400, 'INVALID_INPUT', 'Invalid ID');
        const column = ASSET_COLUMN_MAP[type];
        const allowedColumns = ['screenshot_url', 'video_url', 'manual_snapshot_url'];
        if (!column || !allowedColumns.includes(column)) return errorResponse(res, 400, 'INVALID_INPUT', `Invalid asset type: ${type}`);
        try {
            const { rows } = await deps.pool.query(`SELECT ${column} as path FROM recordings WHERE id = $1`, [id]);
            if (rows.length === 0 || !rows[0].path) return notFoundError(res, 'Asset');
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const url = storageService.getPublicUrl(rows[0].path, baseUrl);
            successResponse(res, { url });
        } catch (err: any) { internalError(res, 'Failed to get preview URL'); }
    });

    router.post('/triage/:id', async (req, res) => {
        const id = req.params.id;
        if (!isUuid(id)) return errorResponse(res, 400, 'INVALID_INPUT', 'Invalid recording id');
        const validationResult = TriageSchema.safeParse(req.body);
        if (!validationResult.success) return validationError(res, validationResult.error.issues);
        const { error } = validationResult.data;
        try {
            const { rows } = await deps.pool.query('SELECT * FROM recordings WHERE id = $1', [id]);
            if (rows.length === 0) return notFoundError(res, 'Recording');
            const result = await LocalAIService.suggestRootCause({ steps: rows[0].steps, error, appVersion: rows[0].app_version, annotations: rows[0].annotations, expectedResults: rows[0].expected_results });
            successResponse(res, { suggestion: result.response, modelUsed: result.modelUsed, status: result.status });
        } catch (err: any) { errorResponse(res, 500, 'SERVICE_ERROR', 'AI Triage failed', err.message); }
    });

    return router;
}
