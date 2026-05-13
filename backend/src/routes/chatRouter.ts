import { Router } from 'express';
import { ChatController } from '../controllers/ChatController';

export function createChatRouter() {
    const router = Router();

    router.get('/', ChatController.listSessions);
    router.post('/', ChatController.saveSession);
    router.delete('/:id', ChatController.deleteSession);

    return router;
}
