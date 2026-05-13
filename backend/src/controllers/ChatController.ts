import { Request, Response } from 'express';
import { ChatSessionService } from '../services/shared/ChatSessionService';
import { appLogger } from '../utils/logger';
import { z } from 'zod';

const ChatSessionSchema = z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    messages: z.array(z.any()),
    jira_id: z.string().optional(),
    last_modified: z.number()
});

export class ChatController {
    /**
     * GET /api/chat-sessions
     */
    static async listSessions(req: Request, res: Response) {
        try {
            const sessions = await ChatSessionService.getAll();
            res.json(sessions);
        } catch (error: any) {
            appLogger.error('[ChatController] List failed', { source: 'ChatController', error: error.message });
            res.status(500).json({ 
                error: 'Failed to retrieve chat history',
                details: error.message 
            });
        }
    }

    /**
     * POST /api/chat-sessions
     */
    static async saveSession(req: Request, res: Response) {
        appLogger.info(`[ChatController] saveSession request body: ${JSON.stringify(req.body)}`);
        try {
            const validation = ChatSessionSchema.safeParse(req.body);
            if (!validation.success) {
                return res.status(400).json({ 
                    error: 'Invalid session data', 
                    details: validation.error.format() 
                });
            }

            const success = await ChatSessionService.save(validation.data);
            res.json({ success });
        } catch (error: any) {
            appLogger.error('[ChatController] Save failed', { source: 'ChatController', error: error.message });
            res.status(500).json({ 
                error: 'Database save failed', 
                details: error.message 
            });
        }
    }

    /**
     * DELETE /api/chat-sessions/:id
     */
    static async deleteSession(req: Request, res: Response) {
        try {
            const { id } = req.params;
            if (!id) return res.status(400).json({ error: 'Session ID is required' });
            
            const success = await ChatSessionService.delete(id);
            res.json({ success });
        } catch (error: any) {
            appLogger.error('[ChatController] Delete failed', { source: 'ChatController', error: error.message });
            res.status(500).json({ 
                error: 'Deletion failed', 
                details: error.message 
            });
        }
    }
}
