/**
 * VectorKnowledgeService
 *
 * Provides semantic search (RAG) using pgvector.
 * Stores testing patterns, ISTQB rules, and UI knowledge.
 */

import { DbClient } from './shared/TelemetryService';
import { appLogger } from '../utils/logger';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), 'backend', '.env') });

export interface VectorMatch {
    content: string;
    category: string;
    metadata: any;
    similarity: number;
}

export class VectorKnowledgeService {
    private static pool: DbClient | null = null;

    static setPool(pool: DbClient): void {
        this.pool = pool;
    }

    /**
     * Get deterministic mock embeddings using a more robust hashing algorithm.
     * Prevents zero-vectors and NaN similarity results.
     */
    private static async getEmbedding(text: string): Promise<number[]> {
        const vec = new Array(768).fill(0.1); // Small baseline
        const lower = text.toLowerCase();
        
        // Better deterministic distribution
        for (let i = 0; i < lower.length; i++) {
            const charCode = lower.charCodeAt(i);
            const pos = (i * 31) % 768; // Prime-stepped distribution
            vec[pos] = (vec[pos] + (charCode / 255)) / 2;
        }
        
        // Normalize vector to prevent magnitude issues
        const magnitude = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
        return vec.map(v => v / magnitude);
    }

    /**
     * Store knowledge chunk with mock embedding
     */
    static async addKnowledge(content: string, category: string, metadata: any = {}): Promise<void> {
        if (!this.pool) return;
        
        try {
            const embedding = await this.getEmbedding(content);
            const query = `
                INSERT INTO knowledge_vectors (content, category, metadata, embedding)
                VALUES ($1, $2, $3, $4)
            `;
            await this.pool.query(query, [
                content, 
                category, 
                JSON.stringify(metadata), 
                `[${embedding.join(',')}]`
            ]);
        } catch (err: any) {
            appLogger.error('[VectorRAG] Add failed', { error: err.message });
        }
    }

    /**
     * Find most relevant knowledge chunks using a HYBRID approach:
     * 1. Vector similarity (via mock hash)
     * 2. Keyword ranking (Weighted text search)
     */
    static async search(queryText: string, category?: string, limit: number = 5): Promise<VectorMatch[]> {
        if (!this.pool) return [];

        try {
            const keywords = queryText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
            const embedding = await this.getEmbedding(queryText);
            const embeddingStr = `[${embedding.join(',')}]`;
            
            // HYBRID QUERY: pgvector similarity + ts_rank-like keyword matching
            let query = `
                SELECT content, category, metadata, 
                       (1 - (embedding <=> $1)) as similarity
                FROM knowledge_vectors
            `;
            const params: any[] = [embeddingStr];

            let whereClauses = [];
            if (category) {
                whereClauses.push(`category = $${params.length + 1}`);
                params.push(category);
            }
            
            if (keywords.length > 0) {
                const keywordMatch = keywords.map(k => `content ILIKE '%${k}%'`).join(' OR ');
                whereClauses.push(`(${keywordMatch})`);
            }

            if (whereClauses.length > 0) {
                query += ` WHERE ` + whereClauses.join(' AND ');
            }

            query += ` ORDER BY similarity DESC LIMIT $${params.length + 1}`;
            params.push(limit);

            const { rows } = await this.pool.query(query, params);
            return rows.map(r => ({
                content: r.content,
                category: r.category,
                metadata: r.metadata,
                similarity: Number(r.similarity)
            }));
        } catch (err: any) {
            appLogger.error('[VectorRAG] Hybrid search failed', { error: err.message });
            return [];
        }
    }

    /**
     * Special helper to get ISTQB context relevant to a specific ticket
     */
    static async getRelevantISTQB(ticketSummary: string): Promise<string> {
        const matches = await this.search(ticketSummary, 'istqb', 3);
        if (matches.length === 0) return '';
        
        return `### Relevant ISTQB Patterns:\n` + 
               matches.map(m => `- ${m.content}`).join('\n');
    }
}
