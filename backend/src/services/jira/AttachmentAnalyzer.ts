/**
 * AttachmentAnalyzer
 *
 * Enriches AttachmentSummary objects with AI-generated descriptions.
 *
 * Strategy by MIME type:
 *   image/*            → Download → Base64 → Vertex AI Gemini Vision (inline_data)
 *   application/pdf    → Download → first 5 000 chars as plain text → AI summarization
 *   video/*            → Metadata-only note ("video — manual review recommended")
 *   other              → Skip (filename/size only)
 *
 * Size limits (to avoid large token bills):
 *   Images  : max 2 MB
 *   PDFs    : max 5 MB
 *
 * Usage:
 *   const enriched = await AttachmentAnalyzer.analyze(ctx.attachments, jiraAuthHeader);
 *   // Mutates .aiSummary on each AttachmentSummary that could be processed
 */

import https from 'https';
import http from 'http';
import { AiControllerService } from '../shared/AiControllerService';
import { AttachmentSummary } from '../../types/jira-context.types';
import { appLogger } from '../../utils/logger';

const MAX_IMAGE_BYTES   = 2 * 1024 * 1024;  //  2 MB
const MAX_PDF_BYTES     = 5 * 1024 * 1024;  //  5 MB
const PDF_TEXT_LIMIT    = 5_000;             // chars of extracted PDF text to send

export class AttachmentAnalyzer {

    /**
     * Enrich attachments with AI summaries in-place (returns new array — immutable).
     *
     * @param attachments  Raw AttachmentSummary[] from JiraContextBuilder
     * @param authHeader   "Basic <base64>" header for Jira download requests
     */
    static async analyze(
        attachments: AttachmentSummary[],
        authHeader: string,
    ): Promise<AttachmentSummary[]> {
        if (attachments.length === 0) return attachments;

        const enriched = await Promise.allSettled(
            attachments.map(att => this.enrichOne(att, authHeader)),
        );

        return enriched.map((result, i) =>
            result.status === 'fulfilled' ? result.value : { ...attachments[i] },
        );
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ──────────────────────────────────────────────────────────────────────────

    private static async enrichOne(att: AttachmentSummary, authHeader: string): Promise<AttachmentSummary> {
        const mime = att.mimeType.toLowerCase();

        try {
            if (mime.startsWith('image/')) {
                return await this.analyzeImage(att, authHeader);
            }
            if (mime === 'application/pdf') {
                return await this.analyzePdf(att, authHeader);
            }
            if (mime.startsWith('video/')) {
                return {
                    ...att,
                    aiSummary: `[Video: ${att.filename}] — manual review recommended; automated frame extraction not available.`,
                };
            }
        } catch (err: any) {
            appLogger.warn(`[AttachmentAnalyzer] Failed to analyze ${att.filename}: ${err.message}`);
        }

        return { ...att };
    }

    /** Download image → base64 → Vertex AI vision → description */
    private static async analyzeImage(att: AttachmentSummary, authHeader: string): Promise<AttachmentSummary> {
        if (att.size > MAX_IMAGE_BYTES) {
            return { ...att, aiSummary: `[Image too large (${this.formatBytes(att.size)}) — skipped vision analysis]` };
        }

        const imageBytes = await this.downloadBytes(att.url, authHeader);
        const base64     = imageBytes.toString('base64');
        const dataUrl    = `data:${att.mimeType};base64,${base64}`;

        // MultiAgentRouter.callVertex() accepts a JSON array prompt where
        // image_url items with data: URLs are converted to Gemini inlineData parts.
        const multimodalPrompt = JSON.stringify([
            {
                type: 'text',
                text:
                    `You are a QA automation analyst. The attached screenshot is from a Jira ticket. ` +
                    `Describe what the screenshot shows in ≤ 3 sentences: ` +
                    `(1) what UI screen or state is shown, ` +
                    `(2) any error messages or highlighted fields, ` +
                    `(3) any data visible that is relevant for test scenario generation.`,
            },
            {
                type: 'image_url',
                image_url: { url: dataUrl },
            },
        ]);

        const description = await AiControllerService.generate('ANALYST', multimodalPrompt);
        return { ...att, aiSummary: description.trim() };
    }

    /** Download PDF → extract text → AI summary */
    private static async analyzePdf(att: AttachmentSummary, authHeader: string): Promise<AttachmentSummary> {
        if (att.size > MAX_PDF_BYTES) {
            return { ...att, aiSummary: `[PDF too large (${this.formatBytes(att.size)}) — skipped analysis]` };
        }

        const pdfBytes = await this.downloadBytes(att.url, authHeader);

        // Lightweight text extraction: look for ASCII/UTF-8 printable text in the PDF binary.
        // For proper extraction, a library like pdf-parse would be needed; this covers common cases.
        const rawText  = pdfBytes.toString('latin1');
        const textOnly = rawText
            .replace(/[^\x20-\x7E\n\r]/g, ' ')  // strip non-printable
            .replace(/\s{3,}/g, '  ')            // collapse excessive whitespace
            .slice(0, PDF_TEXT_LIMIT);

        if (textOnly.trim().length < 50) {
            return { ...att, aiSummary: `[PDF: ${att.filename}] — binary content only; no extractable text found.` };
        }

        const prompt =
            `The following text was extracted from a PDF attached to a Jira ticket named "${att.filename}". ` +
            `Summarize the key points relevant to software QA test generation in ≤ 4 bullet points.\n\n` +
            `PDF TEXT:\n${textOnly}`;

        const summary = await AiControllerService.generate('ANALYST', prompt);
        return { ...att, aiSummary: summary.trim() };
    }

    /** Download bytes from a URL with optional Basic Auth header */
    private static downloadBytes(url: string, authHeader: string): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const parsed    = new URL(url);
            const protocol  = parsed.protocol === 'https:' ? https : http;
            const options   = {
                hostname: parsed.hostname,
                path:     parsed.pathname + parsed.search,
                headers:  { Authorization: authHeader },
                timeout:  20_000,
            };

            const req = protocol.get(options, res => {
                if (res.statusCode && res.statusCode >= 400) {
                    reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
                    return;
                }
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end',  ()         => resolve(Buffer.concat(chunks)));
                res.on('error', reject);
            });

            req.on('timeout', () => { req.destroy(); reject(new Error('Download timed out')); });
            req.on('error', reject);
        });
    }

    private static formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k     = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i     = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
    }
}
