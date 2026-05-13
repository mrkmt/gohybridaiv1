import { DbClient, TelemetryService } from './TelemetryService';
import { appLogger } from '../../utils/logger';

export interface ChatSession {
    id: string;
    title: string;
    messages: any[];
    jira_id?: string;
    last_modified: number;
    created_at?: string;
}

export class ChatSessionService {
    private static pool: DbClient;
    private static readonly COLUMNS = 'id, title, messages, jira_id, last_modified, created_at';

    static setPool(pool: DbClient) {
        this.pool = pool;
    }

    /**
     * Get all chat sessions ordered by last modified
     */
    static async getAll(): Promise<ChatSession[]> {
        try {
            const { rows } = await this.pool.query(
                `SELECT ${this.COLUMNS} FROM chat_sessions ORDER BY last_modified DESC`
            );
            return rows.map(r => ({
                ...r,
                jiraId: r.jira_id || '',
                messages: typeof r.messages === 'string' ? JSON.parse(r.messages) : r.messages,
                lastModified: Number(r.last_modified),
                last_modified: Number(r.last_modified)
            }));
        } catch (error: any) {
            appLogger.error('[ChatSessionService] Failed to get sessions', { error: error.message });
            return [];
        }
    }

    /**
     * Save or update a chat session
     */
    static async save(session: ChatSession): Promise<boolean> {
        try {
            const messagesJson = JSON.stringify(session.messages);
            const lastModified = session.last_modified || Date.now();

            await this.pool.query(
                `INSERT INTO chat_sessions (id, title, messages, jira_id, last_modified)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title,
                    messages = EXCLUDED.messages,
                    jira_id = EXCLUDED.jira_id,
                    last_modified = EXCLUDED.last_modified`,
                [session.id, session.title, messagesJson, session.jira_id, lastModified]
            );
            return true;
        } catch (error: any) {
            appLogger.error('[ChatSessionService] Failed to save session', { error: error.message });
            return false;
        }
    }

    /**
     * Delete a chat session
     */
    static async delete(id: string): Promise<boolean> {
        try {
            await this.pool.query('DELETE FROM chat_sessions WHERE id = $1', [id]);
            return true;
        } catch (error: any) {
            appLogger.error('[ChatSessionService] Failed to delete session', { error: error.message });
            return false;
        }
    }

    /**
     * Get a single session by ID
     */
    static async getById(id: string): Promise<ChatSession | null> {
        try {
            const { rows } = await this.pool.query(`SELECT ${this.COLUMNS} FROM chat_sessions WHERE id = $1`, [id]);
            if (rows.length === 0) return null;
            
            const r = rows[0];
            return {
                ...r,
                messages: typeof r.messages === 'string' ? JSON.parse(r.messages) : r.messages,
                last_modified: Number(r.last_modified)
            };
        } catch (error: any) {
            appLogger.error('[ChatSessionService] Failed to get session by ID', { error: error.message });
            return null;
        }
    }
}
