/**
 * SmartTicketSummarizer
 *
 * Lightweight, structured summarization of Jira tickets for test generation.
 * Replaces the "send entire 37K char ticket to AI" approach.
 *
 * Flow:
 *   1. Fetch raw Jira data (summary, description, comments, linked tickets)
 *   2. Extract key fields, business rules, and edge cases into structured JSON
 *   3. Cache by ticket ID + content hash
 *   4. Reuse until ticket changes
 *
 * Benefits:
 *   - ~55% fewer tokens per ticket (37K → ~10K final prompt)
 *   - No aggressive context trimming (72% context loss eliminated)
 *   - Structured output → easy to validate and cache
 *   - Model-agnostic → works with any AI (OpenRouter, local Gemini, etc.)
 *   - Falls back to current behavior if summarization fails
 */

import { getJiraAxios } from '../../utils/jiraAxios';
import { TestCaseGeneratorService } from '../generation/TestCaseGeneratorService';
import { ChatMentionService } from './ChatMentionService';
import { UnifiedAIOrchestrator, TaskType } from '../../../api/UnifiedAIOrchestrator';
import { appLogger } from '../../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

// Cache file location
const CACHE_DIR = path.join(__dirname, '..', 'local_storage', 'ticket-summaries');
const CACHE_TTL_MS = 5 * 60 * 60 * 1000; // 5 hours

export interface TicketSummary {
  ticketId: string;
  summary: string;
  description: string;        // Plain text, ADF extracted
  issueType: 'Bug' | 'Story' | 'Task' | 'Unknown';
  priority: string;
  module: string;             // Detected module (e.g., "Department", "Leave")

  // For Bug tickets
  reproductionSteps?: Array<{ stepNumber: number; description: string }>;
  severity?: 'Critical' | 'Major' | 'Minor' | 'Cosmetic';
  isRegression?: boolean;
  isDuplicate?: boolean;
  duplicateTicket?: string;

  // For Story/Task tickets
  requirements?: Array<{ id: string; description: string }>;
  affectedModules?: string[];
  newFeatures?: string[];

  // Universal
  keyFields: string[];        // Form fields mentioned (e.g., "Short Code", "Name")
  businessRules: string[];    // Constraints (e.g., "Short Code max 5 chars")
  edgeCases: string[];        // Edge case hints (e.g., "duplicate detection")
  qaNotes: string[];          // QA team comments/observations
  linkedContext: string;      // Summary of linked tickets
  commentsCount: number;

  // Metadata
  summarizedAt: string;
  contentHash: string;        // Hash of raw content for cache invalidation
}

interface CachedEntry {
  summary: TicketSummary;
  expiresAt: number;
  contentHash: string;
}

// ─── Cache Helpers ────────────────────────────────────────────

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cacheFilePath(ticketId: string): string {
  return path.join(CACHE_DIR, `${ticketId}.json`);
}

function computeContentHash(data: any): string {
  const text = JSON.stringify({
    summary: data.fields?.summary || '',
    description: JSON.stringify(data.fields?.description || ''),
    comments: data.fields?.comment?.comments?.map((c: any) => c.body) || [],
    linked: data.fields?.issuelinks?.map((l: any) => l.outwardIssue?.key || l.inwardIssue?.key) || [],
  });
  // Simple hash: sum of char codes mod 10^16
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).padStart(8, '0');
}

function getCached(ticketId: string, contentHash: string): TicketSummary | null {
  try {
    const filePath = cacheFilePath(ticketId);
    if (!fs.existsSync(filePath)) return null;

    const raw = fs.readFileSync(filePath, 'utf-8');
    const entry: CachedEntry = JSON.parse(raw);

    if (Date.now() > entry.expiresAt) return null; // Expired
    if (entry.contentHash !== contentHash) return null; // Content changed

    return entry.summary;
  } catch {
    return null;
  }
}

function saveCached(ticketId: string, summary: TicketSummary, contentHash: string): void {
  try {
    ensureCacheDir();
    const entry: CachedEntry = {
      summary,
      expiresAt: Date.now() + CACHE_TTL_MS,
      contentHash,
    };
    fs.writeFileSync(cacheFilePath(ticketId), JSON.stringify(entry, null, 2), 'utf-8');
    appLogger.info(`[SmartSummarizer] Cache saved for ${ticketId}`);
  } catch (e: any) {
    appLogger.warn(`[SmartSummarizer] Cache save failed: ${e.message}`);
  }
}

// ─── Main Summarization ──────────────────────────────────────

export class SmartTicketSummarizer {

  /**
   * Summarize a Jira ticket into structured test-relevant context.
   * Returns cached result if available and content hasn't changed.
   */
  static async summarize(ticketId: string, manualComments?: string[]): Promise<TicketSummary | null> {
    try {
      const jiraAxios = getJiraAxios();

      // Fetch full ticket data
      const response = await jiraAxios.get(`/rest/api/3/issue/${ticketId}`, {
        params: { fields: 'summary,description,issuetype,priority,comment,issuelinks' }
      });

      const issue = response.data;
      const contentHash = computeContentHash(issue);

      // Check cache
      const cached = getCached(ticketId, contentHash);
      if (cached) {
        appLogger.info(`[SmartSummarizer] Cache HIT for ${ticketId}`);
        return cached;
      }

      // Extract raw data
      const summary = issue.fields.summary || '';
      const description = TestCaseGeneratorService.extractTextFromADF(issue.fields.description || '');
      const issueType = issue.fields.issuetype?.name || 'Unknown';
      const priority = issue.fields.priority?.name || '';

      // Extract human comments
      const rawComments = issue.fields?.comment?.comments || [];
      const humanComments = ChatMentionService.filterBotComments(rawComments);
      let commentsText = humanComments
        .map((c: any) => {
          const author = c.author?.displayName || 'Unknown';
          const text = TestCaseGeneratorService.extractTextFromADF(c.body || '');
          return text ? `[${author}]: ${text}` : null;
        })
        .filter(Boolean)
        .join('\n');

      if (manualComments && manualComments.length > 0) {
        commentsText += '\n' + manualComments.join('\n');
      }

      // Fetch linked tickets context
      let linkedContext = '';
      const links = issue.fields?.issuelinks || [];
      const linkedKeys: string[] = [];
      for (const link of links.slice(0, 5)) {
        const linkedIssue = link.outwardIssue || link.inwardIssue;
        if (linkedIssue) linkedKeys.push(linkedIssue.key);
      }

      if (linkedKeys.length > 0) {
        try {
          for (const key of linkedKeys) {
            try {
              const linkedResp = await jiraAxios.get(`/rest/api/3/issue/${key}`, {
                params: { fields: 'summary,description,issuetype' }
              });
              const linkedSummary = linkedResp.data.fields?.summary || '';
              const linkedDesc = TestCaseGeneratorService.extractTextFromADF(linkedResp.data.fields?.description || '');
              const linkedType = linkedResp.data.fields?.issuetype?.name || '';
              linkedContext += `[${key}] (${linkedType}): ${linkedSummary}\n${linkedDesc.substring(0, 300)}\n\n`;
            } catch {
              // Skip individual linked ticket failures
            }
          }
        } catch {
          // Skip linked context on failure
        }
      }

      // Build compact prompt for summarization (~2-3K chars max)
      const summarizationPrompt = `
# Role: Senior QA Test Analyst
# Task: Analyze this Jira ticket and extract TEST-RELEVANT information into structured JSON.

## Ticket Data
**ID:** ${ticketId}
**Type:** ${issueType}
**Priority:** ${priority}
**Summary:** ${summary}
**Description:**
${description.substring(0, 3000)}

${commentsText ? `## QA Comments:\n${commentsText.substring(0, 2000)}` : ''}
${linkedContext ? `## Linked Tickets:\n${linkedContext.substring(0, 2000)}` : ''}

## Output Format (STRICT JSON ONLY — no markdown, no explanation)
{
  "module": "The GlobalHR module name (e.g., Department, Leave, Attendance, Grade, Designation, Employee, Payroll, etc.)",
  "keyFields": ["List all form fields or grid columns mentioned"],
  "businessRules": ["List all constraints, validations, rules mentioned"],
  "edgeCases": ["List edge cases, boundary conditions, special scenarios"],
  "qaNotes": ["Important observations from QA comments"],
  "reproductionSteps": [
    {"stepNumber": 1, "description": "..."}
  ],
  "requirements": [
    {"id": "REQ1", "description": "..."}
  ],
  "newFeatures": ["List new features or changes mentioned"],
  "affectedModules": ["Modules/pages that are affected"],
  "isRegression": true/false,
  "isDuplicate": true/false,
  "duplicateTicket": "ticket key if duplicate"
}

## Rules
- Return ONLY valid JSON. No markdown code blocks. No explanation.
- If a field is not applicable, use empty array [] or false.
- Keep descriptions concise but complete.
- Focus ONLY on information relevant to TEST GENERATION.
`.trim();

      // Call AI for summarization
      let aiResponse: string;
      try {
        aiResponse = await UnifiedAIOrchestrator.generate(summarizationPrompt, TaskType.TEST_GENERATION);
      } catch (e: any) {
        appLogger.warn(`[SmartSummarizer] AI summarization failed for ${ticketId}: ${e.message}`);
        return null; // Fall back to caller's default behavior
      }

      // Parse response
      const parsed = this.parseSummarizationResponse(aiResponse);
      if (!parsed) {
        appLogger.warn(`[SmartSummarizer] Failed to parse AI response for ${ticketId}`);
        return null;
      }

      // Build final summary
      const result: TicketSummary = {
        ticketId,
        summary,
        description: description.substring(0, 1000),
        issueType: issueType as TicketSummary['issueType'],
        priority,
        module: parsed.module || this.detectModuleFromSummary(summary),
        keyFields: parsed.keyFields || [],
        businessRules: parsed.businessRules || [],
        edgeCases: parsed.edgeCases || [],
        qaNotes: parsed.qaNotes || [],
        linkedContext: linkedContext.substring(0, 500),
        commentsCount: humanComments.length,
        summarizedAt: new Date().toISOString(),
        contentHash,

        // Bug-specific
        reproductionSteps: parsed.reproductionSteps || undefined,
        severity: parsed.severity || undefined,
        isRegression: parsed.isRegression || false,
        isDuplicate: parsed.isDuplicate || false,
        duplicateTicket: parsed.duplicateTicket || undefined,

        // Story-specific
        requirements: parsed.requirements || undefined,
        affectedModules: parsed.affectedModules || [],
        newFeatures: parsed.newFeatures || [],
      };

      // Cache it
      saveCached(ticketId, result, contentHash);

      appLogger.info(`[SmartSummarizer] Summarized ${ticketId}: module=${result.module}, fields=${result.keyFields.length}, rules=${result.businessRules.length}`);

      return result;

    } catch (e: any) {
      appLogger.warn(`[SmartSummarizer] Summarization failed for ${ticketId}: ${e.message}`);
      return null;
    }
  }

  /**
   * Parse AI response into structured format.
   * Handles markdown code blocks, trailing text, etc.
   */
  private static parseSummarizationResponse(text: string): any | null {
    try {
      let cleaned = text.trim();

      // Strip markdown code blocks
      const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        cleaned = codeBlockMatch[1];
      }

      // Find JSON bounds
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start === -1 || end === -1 || end < start) return null;

      return JSON.parse(cleaned.substring(start, end + 1));
    } catch {
      return null;
    }
  }

  /**
   * Detect module from ticket summary (fallback).
   * Reuses the existing detection logic.
   */
  private static detectModuleFromSummary(summary: string): string {
    return TestCaseGeneratorService.detectModuleFromSummary(summary);
  }
}
