/**
 * Smart Skill Manager
 * 
 * Features:
 * - Deduplication: Only save unique patterns (80%+ similar = skip)
 * - Fuzzy Matching: Calculate similarity between patterns
 * - Versioning: Update with v1, v2, v3 tracking
 * - Keep Forever: No auto-cleanup
 * - Real-time Sync: Immediate skill registry update
 */

import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';

export interface SkillPattern {
  id: string;
  type: 'jira' | 'recording' | 'workflow';
  module?: string;
  issueType?: string;
  selectors?: string[];
  workflow?: any[];
  checklist?: any[];
  learnedPatterns?: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
  usedBy: string[];
  successRate?: number;
  changeLog: Array<{
    version: number;
    date: string;
    change: string;
  }>;
}

export interface SkillIndex {
  patterns: SkillPattern[];
  lastUpdated: string;
}

export class SmartSkillManager {
  private static skillsDir = path.join(__dirname, '../skills');
  private static indexFile = path.join(this.skillsDir, 'skill-index.json');
  /** Injected at server startup via SmartSkillManager.setPool(pool). When present,
   *  all writes go to the skill_patterns DB table instead of individual JSON files. */
  private static pool: Pool | null = null;

  static setPool(pool: Pool): void {
    SmartSkillManager.pool = pool;
  }

  private static config = {
    similarityThreshold: 0.80,      // 80% similar = skip (don't save duplicate)
    updateThreshold: 0.60,          // 60% similar = update existing pattern
    minSuccessRate: 0.90,           // Only save patterns with 90%+ success
    autoSync: true                  // Real-time sync to registry
  };

  /**
   * Save pattern intelligently (deduplicate + version)
   */
  static async savePattern(pattern: Partial<SkillPattern>): Promise<{
    status: 'saved' | 'skipped' | 'updated';
    patternId?: string;
    version?: number;
    similarity?: number;
  }> {
    try {
      // Generate unique ID
      const patternId = this.generatePatternId(pattern);
      
      // Load existing patterns
      const index = await this.loadSkillIndex();
      
      // Check for similar patterns
      const similar = await this.findSimilarPattern(pattern, index);
      
      if (similar && similar.similarity >= this.config.similarityThreshold) {
        // Already have this pattern (80%+ similar) - SKIP
        console.log(`[SmartSkill] Pattern already exists: ${similar.pattern.id} (${(similar.similarity * 100).toFixed(0)}% similar) - SKIPPED`);
        return {
          status: 'skipped',
          patternId: similar.pattern.id,
          similarity: similar.similarity
        };
      }
      
      if (similar && similar.similarity >= this.config.updateThreshold) {
        // Similar but different (60-80% similar) - UPDATE with new version
        console.log(`[SmartSkill] Pattern similar: ${similar.pattern.id} (${(similar.similarity * 100).toFixed(0)}% similar) - UPDATING`);
        const updated = await this.updatePattern(similar.pattern, pattern);
        return {
          status: 'updated',
          patternId: updated.id,
          version: updated.version,
          similarity: similar.similarity
        };
      }
      
      // Completely new pattern - SAVE
      console.log(`[SmartSkill] New unique pattern: ${patternId} - SAVING`);
      const saved = await this.saveNewPattern(patternId, pattern);
      return {
        status: 'saved',
        patternId: saved.id,
        version: saved.version
      };
      
    } catch (error: any) {
      console.error('[SmartSkill] Error saving pattern:', error.message);
      return { status: 'skipped' };
    }
  }

  /**
   * Find similar pattern in index
   */
  static async findSimilarPattern(
    newPattern: Partial<SkillPattern>,
    index: SkillIndex
  ): Promise<{ pattern: SkillPattern; similarity: number } | null> {
    let bestMatch: { pattern: SkillPattern; similarity: number } | null = null;
    
    for (const existing of index.patterns) {
      const similarity = this.calculateSimilarity(newPattern, existing);
      
      if (similarity >= this.config.updateThreshold) {
        if (!bestMatch || similarity > bestMatch.similarity) {
          bestMatch = { pattern: existing, similarity };
        }
      }
    }
    
    return bestMatch;
  }

  /**
   * Calculate similarity between two patterns (0.0 to 1.0)
   */
  static calculateSimilarity(
    newPattern: Partial<SkillPattern>,
    existing: SkillPattern
  ): number {
    let score = 0;
    let checks = 0;
    
    // Same module? (+0.25)
    if (newPattern.module && existing.module) {
      if (newPattern.module.toLowerCase() === existing.module.toLowerCase()) {
        score += 0.25;
      }
      checks++;
    }
    
    // Same issue type? (+0.25)
    if (newPattern.issueType && existing.issueType) {
      if (newPattern.issueType === existing.issueType) {
        score += 0.25;
      }
      checks++;
    }
    
    // Selector overlap? (+0.30)
    if (newPattern.selectors && existing.selectors) {
      const selectorOverlap = this.calculateOverlap(newPattern.selectors, existing.selectors);
      score += selectorOverlap * 0.30;
      checks++;
    }
    
    // Workflow similarity? (+0.20)
    if (newPattern.workflow && existing.workflow) {
      const workflowSimilarity = this.calculateWorkflowSimilarity(
        newPattern.workflow,
        existing.workflow
      );
      score += workflowSimilarity * 0.20;
      checks++;
    }
    
    return checks > 0 ? score / checks : 0;
  }

  /**
   * Calculate overlap between two arrays (0.0 to 1.0)
   */
  static calculateOverlap(a: string[], b: string[]): number {
    if (!a.length || !b.length) return 0;
    
    const setB = new Set(b.map(s => s.toLowerCase()));
    const matches = a.filter(s => setB.has(s.toLowerCase())).length;
    
    return matches / Math.max(a.length, b.length);
  }

  /**
   * Calculate workflow similarity
   */
  static calculateWorkflowSimilarity(a: any[], b: any[]): number {
    if (!a.length || !b.length) return 0;
    
    // Compare action types and selectors
    const aActions = a.map(s => s.action || s.type).filter(Boolean);
    const bActions = b.map(s => s.action || s.type).filter(Boolean);
    
    return this.calculateOverlap(aActions, bActions);
  }

  /**
   * Generate unique pattern ID
   */
  static generatePatternId(pattern: Partial<SkillPattern>): string {
    const type = pattern.type || 'unknown';
    const module = pattern.module || 'unknown';
    const issueType = pattern.issueType || 'unknown';
    const timestamp = Date.now();
    
    // Format: type-module-issuetype-timestamp
    return `${type}-${module}-${issueType}-${timestamp}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  }

  /**
   * Save new pattern
   */
  static async saveNewPattern(
    patternId: string,
    pattern: Partial<SkillPattern>
  ): Promise<SkillPattern> {
    const now = new Date().toISOString();
    
    const newPattern: SkillPattern = {
      id: patternId,
      type: pattern.type || 'recording',
      module: pattern.module,
      issueType: pattern.issueType,
      selectors: pattern.selectors,
      workflow: pattern.workflow,
      checklist: pattern.checklist,
      learnedPatterns: pattern.learnedPatterns,
      version: 1,
      createdAt: now,
      updatedAt: now,
      usedBy: [],
      successRate: pattern.successRate,
      changeLog: [{
        version: 1,
        date: now,
        change: 'Initial pattern created'
      }]
    };
    
    // Write to DB when pool available (no file I/O, no race condition)
    if (SmartSkillManager.pool) {
      await this.upsertToDb(newPattern);
    } else {
      // File fallback for environments without DB
      const patternFile = path.join(
        this.skillsDir,
        'Auto-Generated',
        pattern.type === 'jira' ? 'jira-patterns' : 'recording-patterns',
        `${patternId}.json`
      );
      fs.mkdirSync(path.dirname(patternFile), { recursive: true });
      fs.writeFileSync(patternFile, JSON.stringify(newPattern, null, 2), 'utf8');
      await this.addToIndex(newPattern);
    }
    
    // Sync to registry (real-time)
    if (this.config.autoSync) {
      await this.syncToRegistry(newPattern);
    }
    
    console.log(`[SmartSkill] Saved: ${patternId} (v${newPattern.version})`);
    return newPattern;
  }

  /**
   * Update existing pattern with new version
   */
  static async updatePattern(
    existing: SkillPattern,
    updates: Partial<SkillPattern>
  ): Promise<SkillPattern> {
    const now = new Date().toISOString();
    const newVersion = existing.version + 1;
    
    const updated: SkillPattern = {
      ...existing,
      ...updates,
      version: newVersion,
      updatedAt: now,
      changeLog: [
        ...existing.changeLog,
        {
          version: newVersion,
          date: now,
          change: `Updated: ${Object.keys(updates).join(', ')}`
        }
      ]
    };
    
    if (SmartSkillManager.pool) {
      await this.upsertToDb(updated);
    } else {
      const patternFile = path.join(
        this.skillsDir,
        'Auto-Generated',
        updated.type === 'jira' ? 'jira-patterns' : 'recording-patterns',
        `${updated.id}.json`
      );
      fs.mkdirSync(path.dirname(patternFile), { recursive: true });
      fs.writeFileSync(patternFile, JSON.stringify(updated, null, 2), 'utf8');
      await this.updateIndexEntry(updated);
    }
    
    // Sync to registry (real-time)
    if (this.config.autoSync) {
      await this.syncToRegistry(updated);
    }
    
    console.log(`[SmartSkill] Updated: ${updated.id} (v${updated.version})`);
    return updated;
  }

  /**
   * Load skill index — from DB when pool is available, file otherwise.
   */
  static async loadSkillIndex(): Promise<SkillIndex> {
    if (SmartSkillManager.pool) {
      try {
        const { rows } = await SmartSkillManager.pool.query(
          `SELECT id, type, module, issue_type AS "issueType",
                  selectors, workflow, checklist, learned_patterns AS "learnedPatterns",
                  version, success_rate AS "successRate", change_log AS "changeLog",
                  created_at AS "createdAt", updated_at AS "updatedAt"
           FROM skill_patterns
           ORDER BY updated_at DESC`,
        );
        const patterns: SkillPattern[] = rows.map((r: any) => ({
          ...r,
          usedBy: [],
          successRate: parseFloat(r.successRate ?? '1'),
        }));
        return { patterns, lastUpdated: new Date().toISOString() };
      } catch (err: any) {
        console.error('[SmartSkill] DB load failed, falling back to file:', err.message);
      }
    }

    try {
      if (fs.existsSync(this.indexFile)) {
        const content = fs.readFileSync(this.indexFile, 'utf8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.error('[SmartSkill] Error loading index:', error);
    }

    return { patterns: [], lastUpdated: new Date().toISOString() };
  }

  /**
   * Add pattern to index
   */
  static async addToIndex(pattern: SkillPattern): Promise<void> {
    const index = await this.loadSkillIndex();
    index.patterns.push(pattern);
    index.lastUpdated = new Date().toISOString();
    
    fs.writeFileSync(this.indexFile, JSON.stringify(index, null, 2), 'utf8');
  }

  /**
   * Update pattern in index
   */
  static async updateIndexEntry(pattern: SkillPattern): Promise<void> {
    const index = await this.loadSkillIndex();
    const idx = index.patterns.findIndex(p => p.id === pattern.id);
    
    if (idx >= 0) {
      index.patterns[idx] = pattern;
    } else {
      index.patterns.push(pattern);
    }
    
    index.lastUpdated = new Date().toISOString();
    fs.writeFileSync(this.indexFile, JSON.stringify(index, null, 2), 'utf8');
  }

  /**
   * Sync pattern to SkillRegistry cache
   */
  static async syncToRegistry(pattern: SkillPattern): Promise<void> {
    // SkillRegistry will auto-reload from files
    // No manual intervention needed
    console.log(`[SmartSkill] Synced to registry: ${pattern.id}`);
  }

  /**
   * Upsert a pattern to the skill_patterns DB table.
   * Called instead of writeFileSync when a pool is injected.
   */
  private static async upsertToDb(pattern: SkillPattern): Promise<void> {
    if (!SmartSkillManager.pool) return;
    await SmartSkillManager.pool.query(
      `INSERT INTO skill_patterns
         (id, type, module, issue_type, selectors, workflow, checklist,
          learned_patterns, version, success_rate, change_log, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         type             = EXCLUDED.type,
         module           = EXCLUDED.module,
         issue_type       = EXCLUDED.issue_type,
         selectors        = EXCLUDED.selectors,
         workflow         = EXCLUDED.workflow,
         checklist        = EXCLUDED.checklist,
         learned_patterns = EXCLUDED.learned_patterns,
         version          = EXCLUDED.version,
         success_rate     = EXCLUDED.success_rate,
         change_log       = EXCLUDED.change_log,
         updated_at       = EXCLUDED.updated_at`,
      [
        pattern.id,
        pattern.type,
        pattern.module        ?? null,
        pattern.issueType     ?? null,
        JSON.stringify(pattern.selectors      ?? []),
        JSON.stringify(pattern.workflow       ?? []),
        JSON.stringify(pattern.checklist      ?? []),
        JSON.stringify(pattern.learnedPatterns ?? []),
        pattern.version,
        pattern.successRate   ?? 1.0,
        JSON.stringify(pattern.changeLog      ?? []),
        pattern.createdAt,
        pattern.updatedAt,
      ],
    );
  }

  /**
   * Get pattern by ID
   */
  static async getPattern(patternId: string): Promise<SkillPattern | null> {
    const index = await this.loadSkillIndex();
    const pattern = index.patterns.find(p => p.id === patternId);
    
    if (!pattern) return null;
    
    // Load full pattern from file
    const patternFile = path.join(
      this.skillsDir,
      'Auto-Generated',
      pattern.type === 'jira' ? 'jira-patterns' : 'recording-patterns',
      `${patternId}.json`
    );
    
    if (fs.existsSync(patternFile)) {
      const content = fs.readFileSync(patternFile, 'utf8');
      return JSON.parse(content);
    }
    
    return null;
  }

  /**
   * List all patterns (optionally filtered)
   */
  static async listPatterns(filter?: {
    type?: 'jira' | 'recording';
    module?: string;
    issueType?: string;
  }): Promise<SkillPattern[]> {
    const index = await this.loadSkillIndex();
    
    if (!filter) return index.patterns;
    
    return index.patterns.filter(p => {
      if (filter.type && p.type !== filter.type) return false;
      if (filter.module && p.module !== filter.module) return false;
      if (filter.issueType && p.issueType !== filter.issueType) return false;
      return true;
    });
  }

  /**
   * Get index statistics
   */
  static async getStats(): Promise<{
    totalPatterns: number;
    jiraPatterns: number;
    recordingPatterns: number;
    avgVersion: number;
    lastUpdated: string;
  }> {
    const index = await this.loadSkillIndex();
    
    return {
      totalPatterns: index.patterns.length,
      jiraPatterns: index.patterns.filter(p => p.type === 'jira').length,
      recordingPatterns: index.patterns.filter(p => p.type === 'recording').length,
      avgVersion: index.patterns.reduce((sum, p) => sum + p.version, 0) / index.patterns.length || 0,
      lastUpdated: index.lastUpdated
    };
  }
}
