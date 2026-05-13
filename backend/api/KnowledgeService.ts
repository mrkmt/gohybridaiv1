import fs from 'fs';
import path from 'path';
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
import { config } from './config';
import { LocalAIService } from './LocalAIService';

interface KnowledgeChunk {
    id: string;
    filePath: string;
    fileName: string;
    content: string;
    embedding?: number[];
    title?: string;
    snippet?: string;
    path?: string;
    score?: number;
    metadata: {
        module?: string;
        menu?: string;
        lastModified: number;
        chunkIndex: number;
    };
}

interface KnowledgeIndex {
    chunks: KnowledgeChunk[];
    lastIndexed: number;
}

interface CachedEmbedding {
    embedding: number[];
    timestamp: number;
    ttl: number;
}

interface FileCache {
    content: string;
    score: number;
    snippet: string;
    timestamp: number;
}

export class KnowledgeService {
    private static DEFAULT_ROOTS = [
        ...config.knowledge.preferredPaths,
        config.knowledge.geminiPath,
        config.knowledge.qwenPath,
        config.knowledge.codexPath,
        config.knowledge.anythingLlmPath,
        ...config.knowledge.extraPaths,
        // Include External Logic for PDF manuals
        path.join(process.cwd(), 'External Logic/Domain Knowledge'),
        // Include Trained Knowledge (Hidden Gem)
        path.join(__dirname, '..', 'local_storage', 'knowledge')
    ].filter(Boolean);

    private static embeddingCache = new Map<string, CachedEmbedding>();
    private static fileCache = new Map<string, FileCache>();
    private static readonly CACHE_TTL = 3600000;
    private static readonly INDEX_PATH = path.join(config.storage.baseDir, 'knowledge-index.json');
    private static cachedIndex: KnowledgeIndex | null = null;

    /**
     * Finds relevant local docs (including PDFs) using keyword ranking.
     */
    static async findRelevantDocs(query: string): Promise<any[]> {
        if (!config.knowledge.enabled) return [];
        const q = (query || '').trim();
        if (!q) return [];

        const cacheKey = `query:${q.toLowerCase()}`;
        const cached = this.fileCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            return JSON.parse(cached.content);
        }

        const roots = await this.getExistingRoots();
        const terms = this.tokenize(q);
        const files = await this.collectCandidateFiles(roots);
        const results: any[] = [];

        for (const filePath of files) {
            const { score, snippet } = await this.scoreFile(filePath, terms);
            if (score <= 0) continue;

            results.push({
                path: filePath,
                title: path.basename(filePath),
                snippet,
                score,
            });
        }

        const sorted = results.sort((a, b) => b.score - a.score).slice(0, 10);
        this.fileCache.set(cacheKey, { content: JSON.stringify(sorted), score: 0, snippet: '', timestamp: Date.now() });
        return sorted;
    }

    /**
     * Semantic Search: Hybrid approach.
     * 1. Keywords pull top candidates.
     * 2. Local AI re-ranks candidates based on actual relevance to the query.
     */
    static async findSemanticDocs(query: string, limit: number = 3): Promise<KnowledgeChunk[]> {
        if (!config.knowledge.enabled) return [];
        
        console.log(`[Knowledge Service] Semantic search for: "${query.substring(0, 50)}..."`);
        
        // Step 1: Broad keyword retrieval
        const candidates = await this.findRelevantDocs(query);
        if (candidates.length === 0) return [];

        // If only one, no need to re-rank
        if (candidates.length === 1) {
            return candidates.map(d => this.mapFileToChunk(d));
        }

        // Step 2: AI Re-ranking (The "Best" part)
        // We ask the local AI to pick the most relevant snippets
        try {
            const snippets = candidates.slice(0, 5).map((c, i) => `ID ${i}: ${c.title}\nContent: ${c.snippet.substring(0, 300)}`).join('\n\n');
            
            const prompt = `
                # Task: Identify the most relevant documentation for a testing requirement.
                # Query: ${query}
                
                # Available Documents:
                ${snippets}
                
                # Instructions:
                Rank the Document IDs from most relevant to least relevant based on business rules and logic.
                Return only a JSON array of the top ${limit} IDs, e.g., [1, 0, 4]
                
                # Response (JSON array only):
            `;

            const aiResponse = await LocalAIService.simpleGenerate('qwen', prompt);
            const rankedIds = this.extractJSONArray(aiResponse);

            if (Array.isArray(rankedIds) && rankedIds.length > 0) {
                console.log(`[Knowledge Service] AI re-ranked: ${rankedIds.join(', ')}`);
                const reRanked = rankedIds
                    .map(id => candidates[id])
                    .filter(Boolean)
                    .map(d => this.mapFileToChunk(d));
                return reRanked.slice(0, limit);
            }
        } catch (err: any) {
            console.warn(`[Knowledge Service] AI re-ranking failed: ${err.message}`);
        }

        // Fallback to keyword order
        return candidates.slice(0, limit).map(d => this.mapFileToChunk(d));
    }

    private static mapFileToChunk(d: any): KnowledgeChunk {
        return {
            id: d.path,
            filePath: d.path,
            fileName: d.title,
            content: d.snippet,
            title: d.title,
            snippet: d.snippet,
            metadata: { lastModified: Date.now(), chunkIndex: 0 }
        };
    }

    private static extractJSONArray(text: string): number[] | null {
        try {
            const start = text.indexOf('[');
            const end = text.lastIndexOf(']');
            if (start === -1 || end === -1) return null;
            return JSON.parse(text.substring(start, end + 1));
        } catch {
            return null;
        }
    }

    /**
     * Load knowledge index from disk
     */
    static async loadIndex(): Promise<KnowledgeIndex | null> {
        if (this.cachedIndex) return this.cachedIndex;
        try {
            if (fs.existsSync(this.INDEX_PATH)) {
                const raw = fs.readFileSync(this.INDEX_PATH, 'utf8');
                this.cachedIndex = JSON.parse(raw);
                return this.cachedIndex;
            }
        } catch (e) {
            console.error('[Knowledge Service] Failed to load index:', e);
        }
        return null;
    }

    /**
     * Rebuild the entire index from provided chunks
     */
    static async rebuildIndex(chunks: KnowledgeChunk[]): Promise<void> {
        console.log(`[Knowledge Service] Saving index with ${chunks.length} chunks...`);
        await this.saveIndex({
            chunks,
            lastIndexed: Date.now()
        });
    }

    /**
     * Save knowledge index to disk
     */
    static async saveIndex(index: KnowledgeIndex): Promise<void> {
        try {
            const dir = path.dirname(this.INDEX_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.INDEX_PATH, JSON.stringify(index, null, 2));
            this.cachedIndex = index;
        } catch (e) {
            console.error('[Knowledge Service] Failed to save index:', e);
        }
    }

    private static cosineSimilarity(vecA: number[], vecB: number[]): number {
        if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    private static async getExistingRoots(): Promise<string[]> {
        const existing: string[] = [];
        for (const root of this.DEFAULT_ROOTS) {
            try {
                if (!root) continue;
                const stat = await fs.promises.stat(root);
                if (stat.isDirectory()) existing.push(root);
            } catch { }
        }
        return existing;
    }

    private static tokenize(text: string): string[] {
        return text.toLowerCase().split(/[^a-z0-9_\-]+/g).map(t => t.trim()).filter(t => t.length >= 2).slice(0, 12);
    }

    private static async collectCandidateFiles(roots: string[]): Promise<string[]> {
        const maxFiles = config.knowledge.maxFiles;
        const acceptedExt = new Set(['.md', '.txt', '.pdf', '.docx']); // Core docs
        const configExt = new Set(['.json', '.yml', '.yaml']); // Configs
        const out: string[] = [];

        const walk = async (dir: string, depth: number) => {
            if (out.length >= maxFiles || depth > 5) return;
            let entries: fs.Dirent[] = [];
            try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }

            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (this.shouldSkipDirectory(entry.name)) continue;
                    await walk(full, depth + 1);
                } else if (entry.isFile()) {
                    if (this.shouldSkipFile(entry.name)) continue;
                    const ext = path.extname(entry.name).toLowerCase();

                    if (acceptedExt.has(ext)) {
                        out.push(full);
                    } else if (configExt.has(ext)) {
                        // Only include top-level or specific config files, skip node_modules/lockfiles
                        if (!full.includes('node_modules') && !full.includes('lock.json')) {
                            out.push(full);
                        }
                    }
                }
            }
        };

        for (const root of roots) await walk(root, 0);
        return out;
    }

    private static shouldSkipDirectory(name: string): boolean {
        return new Set([
            'node_modules', 'dist', 'build', '.git', 'tmp', 'coverage',
            '.next', '.gemini', '.qwen', '.codex', 'local_storage', 'logs'
        ]).has(name.toLowerCase());
    }

    private static shouldSkipFile(name: string): boolean {
        const lower = name.toLowerCase();
        return lower.includes('package-lock.json') ||
            lower.includes('.log') ||
            lower.includes('.env') ||
            lower.includes('tsconfig.json') ||
            lower.startsWith('.');
    }

    private static async scoreFile(filePath: string, terms: string[]): Promise<{ score: number; snippet: string }> {
        try {
            let text = "";
            if (filePath.endsWith('.pdf')) {
                const dataBuffer = fs.readFileSync(filePath);
                const data = await pdf(dataBuffer);
                text = data.text;
            } else if (filePath.endsWith('.docx')) {
                const dataBuffer = fs.readFileSync(filePath);
                const result = await mammoth.extractRawText({ buffer: dataBuffer });
                text = result.value;
            } else {
                text = fs.readFileSync(filePath, 'utf8');
            }

            const lower = text.toLowerCase();
            let score = 0;
            for (const term of terms) {
                if (lower.indexOf(term) >= 0) score += 10;
                score += (lower.split(term).length - 1);
            }

            if (score <= 0) return { score: 0, snippet: '' };
            return { score, snippet: text.substring(0, config.knowledge.maxSnippetChars) };
        } catch {
            return { score: 0, snippet: '' };
        }
    }
}
