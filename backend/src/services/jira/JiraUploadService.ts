/**
 * JiraUploadService
 *
 * Handles uploading test artifacts and posting results to Jira.
 * Supports attachment uploads, ADF-formatted comments, and status transitions.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import FormData from 'form-data';
import * as XLSX from 'xlsx';
import { getJiraAxios, jiraRequest } from '../../utils/jiraAxios';
import { JiraTransitionService } from './JiraTransitionService';
import { TestExecutionService, TestResult, TestExecutionSummary } from '../execution/TestExecutionService';
import { JiraBugReportingService } from './JiraBugReportingService';
import { appLogger } from '../../utils/logger';
import {
    buildEnhancedResultsADF,
    buildSingleResultEnhancedADF,
    buildFallbackResultsADF,
} from './JiraCommentBuilder';

// Redundant interface removed and imported from TestExecutionService 

export interface UploadResult {
    attachmentId: string;
    attachmentUrl: string;
    excelAttachmentId?: string;
    commentPosted: boolean;
    transitioned: boolean;
    transitionStatus?: string;
}

export class JiraUploadService {
    private static customFieldCache: Record<string, string> | null = null;

    /**
     * Dynamically resolve custom field ID by its name (e.g., "Verify").
     * Falls back to a hardcoded ID if the field is not found in Jira.
     */
    private static async getCustomFieldId(fieldName: string, fallbackId: string): Promise<string> {
        try {
            if (!this.customFieldCache) {
                this.log(`[JiraUpload] Fetching all Jira fields for dynamic discovery...`);
                const jiraAxios = getJiraAxios();
                const response = await jiraRequest(() => jiraAxios.get('/rest/api/3/field'));
                const fields: Array<{ id: string; name: string }> = response.data;
                
                this.customFieldCache = {};
                fields.forEach(f => {
                    if (f.name) {
                        this.customFieldCache![f.name.toLowerCase()] = f.id;
                    }
                });
                this.log(`[JiraUpload] ✓ Field cache populated with ${Object.keys(this.customFieldCache).length} fields`);
            }

            const foundId = this.customFieldCache[fieldName.toLowerCase()];
            if (foundId) {
                return foundId;
            }
        } catch (err: any) {
            appLogger.warn(`[JiraUpload] Failed to fetch dynamic fields, using fallback: ${err.message}`);
        }
        return fallbackId;
    }

    /**
     * Generate Excel report (delegates to TestExecutionService)
     */
    static async generateExcelReport(
        ticketId: string,
        results: TestResult[],
        summary?: any,
        environment?: string
    ): Promise<string> {
        return TestExecutionService.generateExcelReport(ticketId, results, summary, environment);
    }

    private static readonly MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
    private static readonly ALLOWED_EXTENSIONS = ['.zip', '.webm', '.png', '.jpg', '.json', '.html', '.xlsx'];

    /**
     * Update Jira issue custom fields with test result details
     */
    static async updateJiraTestFields(
        ticketId: string,
        results: TestResult[]
    ): Promise<boolean> {
        this.log(`[JiraUpload] Attempting to update Jira test fields for ${ticketId}...`);

        try {
            const jiraAxios = getJiraAxios();

            // Format steps into a single readable block for Jira text area fields
            const mainResult = results[0]; // Usually the reproduction/main case
            if (!mainResult) return false;

            const verifyContent = mainResult.steps?.map?.(s => `[Step ${s.stepNumber}] ${s.action}`).join('\n') || '';
            const expectedContent = mainResult.steps?.map?.(s => `[Step ${s.stepNumber}] ${s.expectedResult}`).join('\n') || '';
            const actualContent = mainResult.steps?.map?.(s => `[Step ${s.stepNumber}] ${s.status === 'PASS' ? '✅ SUCCESS' : '❌ FAILED: ' + (s.errorMessage || 'Step failed')}`).join('\n') || '';

            // Dynamically discover field IDs by name
            const verifyId = await this.getCustomFieldId('Verify', 'customfield_10011');
            const expectedId = await this.getCustomFieldId('Expected Result', 'customfield_10012');
            const actualId = await this.getCustomFieldId('Actual Result', 'customfield_10013');

            // Map results to Jira custom fields
            const payload = {
                fields: {
                    [verifyId]: verifyContent,
                    [expectedId]: expectedContent,
                    [actualId]: actualContent
                }
            };

            await jiraRequest(() => jiraAxios.put(`/rest/api/3/issue/${ticketId}`, payload));
            this.log(`[JiraUpload] ✓ Jira custom fields updated for ${ticketId}`);
            return true;
        } catch (error: any) {
            // Gracefully handle 400 errors for custom fields not on screen
            if (error.response?.status === 400) {
                this.log(`[JiraUpload] ⚠ Jira custom fields not available on screen, skipping (non-fatal)`);
                return false;
            }
            appLogger.warn(`[JiraUpload] Failed to update Jira custom fields`, { error: error.message, response: error.response?.data });
            return false;
        }
    }

    /**
     * Safe text helper: ensures text is never undefined/null for ADF nodes.
     * Jira ADF requires non-empty strings in text nodes.
     */
    private static safeText(val: any, fallback?: string): string {
        const fb = fallback || '(empty)';
        if (val === undefined || val === null) return fb;
        const str = String(val).trim();
        return str.length > 0 ? str : fb;
    }

    /**
     * safeTextOrNull: returns null when value is empty (for conditional rendering).
     */
    private static safeTextOrNull(val: any): string | null {
        if (val === undefined || val === null) return null;
        const str = String(val).trim();
        return str.length > 0 ? str : null;
    }

    /**
     * Validates ADF document tree — ensures all text nodes have non-empty strings.
     * Returns true if valid, false if ADF would be rejected by Jira.
     */
    private static validateADF(adf: any): boolean {
        if (!adf || adf.version !== 1 || adf.type !== 'doc' || !Array.isArray(adf.content)) {
            return false;
        }
        let valid = true;
        const walk = (node: any, path: string) => {
            if (!node) return;
            if (node.type === 'text') {
                if (!node.text || typeof node.text !== 'string' || node.text.trim().length === 0) {
                    appLogger.warn(`[JiraUpload] Invalid ADF text node at ${path}: text is empty/undefined`);
                    valid = false;
                    // Fix in place: set fallback value
                    node.text = '(empty)';
                }
            }
            if (Array.isArray(node.content)) {
                node.content.forEach((child: any, i: number) => walk(child, `${path}.content[${i}]`));
            }
        };
        adf.content.forEach((child: any, i: number) => walk(child, `doc.content[${i}]`));
        return valid;
    }

    /**
     * Builds a simple plain-text ADF document as a fallback when rich ADF construction fails.
     */
    /**
     * Humanise a step action line for non-technical readers.
     * Strips CSS selectors, class names, and internal type prefixes.
     */
    private static humanStep(action: string): string {
        if (!action) return '';
        return action
            // "Assert assertVisible on '.k-notification-success'" → "Verify success notification appears"
            .replace(/Assert assertVisible on\s+"[^"]*"/gi, 'Verify element is visible on the page')
            .replace(/Assert assertText on\s+"[^"]*"/gi, 'Verify text appears on the page')
            .replace(/Assert assertVisible on\s+[\w.#[\]"=*-]+/gi, 'Verify element is visible on the page')
            .replace(/Assert assertText on\s+[\w.#[\]"=*-]+/gi, 'Verify text appears on the page')
            // "Assert visible: '...'" raw
            .replace(/Assert visible:\s*"[^"]*"/gi, 'Verify element is visible on the page')
            // "Assert text '...'" with expected
            .replace(/Assert text\s+"[^"]*"/gi, (_m, _p, str) => {
                const inner = str.match(/Expected:\s*"([^"]+)"/)?.[1];
                return inner ? `Verify page shows: "${inner}"` : 'Verify expected text appears on the page';
            })
            // "Navigate to /app.something" → "Navigate to module page"
            .replace(/Navigate to\s+\S*#\/app\.\S*/gi, 'Navigate to module page')
            .replace(/Navigate to\s+\/app\.\S*/gi, 'Navigate to module page')
            // Strip Kendo / CSS selector fragments that leaked into action text
            .replace(/\s*\([^)]*k-[^)]*\)/g, '')
            .replace(/\s*\[[^\]]*formcontrolname[^\]]*\]/gi, '')
            .trim();
    }

    /** Plain-text fallback ADF — used on 400 from the rich ADF. */
    private static buildSimpleADF(testCases: any[]): any {
        const paragraphs = testCases.map((tc, i) => {
            const lines: string[] = [
                `Test Case ${i + 1}: ${this.safeText(tc.title || tc.name)}`,
                `Priority: ${this.safeText(tc.priority, 'Medium')}`,
            ];
            if (tc.steps && tc.steps.length > 0) {
                lines.push('Steps:');
                tc.steps.forEach((s: any) => {
                    const action = this.humanStep(this.safeText(s.action));
                    if (action) lines.push(`  ${s.stepNumber || ''}. ${action}`);
                });
            }
            const outcome = this.safeTextOrNull(tc.expectedOutcome);
            if (outcome && !outcome.toLowerCase().includes('test passes without error')) {
                lines.push(`Expected: ${outcome}`);
            }
            return lines.join('\n');
        }).join('\n---\n');

        return {
            version: 1,
            type: "doc",
            content: paragraphs.split('\n').map((line: string) => ({
                type: "paragraph",
                content: [{ type: "text", text: line || ' ' }]
            }))
        };
    }

    /**
     * Update Jira "Test Case" custom field (customfield_10040)
     * This field requires Atlassian Document Format (ADF), not plain text.
     * Uses Jira's update operations format for rich text fields.
     *
     * FIX (April 4, 2026): Added null-safety guards for all ADF text nodes.
     * Jira rejected payloads with undefined/null text values.
     */
    static async updateTestCaseField(ticketId: string, testCases: any[]): Promise<boolean> {
        this.log(`[JiraUpload] Updating Jira Test Case field for ${ticketId}...`);
        try {
            const jiraAxios = getJiraAxios();
            const fallbackId = process.env.JIRA_TESTCASE_FIELD_ID || 'customfield_10040';
            const fieldId = await this.getCustomFieldId('Test Case', fallbackId);

            // Build ADF (Atlassian Document Format) content with null-safety
            const adfContent: any = {
                version: 1,
                type: "doc",
                content: []
            };

            testCases.forEach((tc, index) => {
                // ── Title ────────────────────────────────────────────────────
                const titleText = this.safeText(tc.title || tc.name, `Test Case ${index + 1}`);
                adfContent.content.push({
                    type: "heading",
                    attrs: { level: 2 },
                    content: [
                        { type: "text", text: `${index + 1}. ${titleText}`, marks: [{ type: "strong" }] }
                    ]
                });

                // ── Priority badge (no "Type: Alternative" — not meaningful to readers) ──
                const priorityText = this.safeText(tc.priority, 'Medium');
                adfContent.content.push({
                    type: "paragraph",
                    content: [{ type: "text", text: `Priority: ${priorityText}`, marks: [{ type: "em" }] }]
                });

                // ── Steps as an ordered list ──────────────────────────────
                if (tc.steps && Array.isArray(tc.steps) && tc.steps.length > 0) {
                    adfContent.content.push({
                        type: "heading",
                        attrs: { level: 3 },
                        content: [{ type: "text", text: "Test Steps" }]
                    });

                    const orderedItems = tc.steps.map((s: any) => {
                        const raw   = this.safeText(s.action, '(no action)');
                        const clean = this.humanStep(raw);
                        return {
                            type: "listItem",
                            content: [{
                                type: "paragraph",
                                content: [{ type: "text", text: clean || raw }]
                            }]
                        };
                    });

                    adfContent.content.push({ type: "orderedList", content: orderedItems });
                }

                // ── Expected Outcome (only if it adds real information) ───
                const outcomeText = this.safeTextOrNull(tc.expectedOutcome);
                if (outcomeText && !outcomeText.toLowerCase().includes('test passes without error')) {
                    adfContent.content.push({
                        type: "paragraph",
                        content: [
                            { type: "text", text: "Expected outcome: ", marks: [{ type: "strong" }] },
                            { type: "text", text: outcomeText }
                        ]
                    });
                }

                // ── Separator ─────────────────────────────────────────────
                if (index < testCases.length - 1) {
                    adfContent.content.push({ type: "rule" });
                }
            });

            // Validate ADF before sending — fix any invalid nodes in place
            this.validateADF(adfContent);

            // For rich text custom fields, Jira expects the ADF object DIRECTLY as the value
            const payload = {
                fields: {
                    [fieldId]: adfContent
                }
            };

            this.log(`[JiraUpload] Request body size: ${JSON.stringify(payload).length} bytes`);

            await jiraAxios.put(`/rest/api/3/issue/${ticketId}`, payload);
            this.log(`[JiraUpload] ✓ Jira Test Case field updated for ${ticketId}`);
            return true;
        } catch (error: any) {
            const errorMsg = error.message || 'Unknown error';
            const statusCode = error.response?.status;
            const errorData = error.response?.data;

            appLogger.error(`[JiraUpload] Failed to update Jira Test Case field for ${ticketId}: ${errorMsg}`, { httpStatus: statusCode });

            // Enhanced 400 error logging with fallback attempt
            if (statusCode === 400) {
                try {
                    this.log(`[JiraUpload] 400 error — attempting fallback with simple ADF...`);
                    // Attempt fallback with simple ADF
                    const simpleADF = this.buildSimpleADF(testCases);
                    const fallbackFieldName = process.env.JIRA_TESTCASE_FIELD_ID || 'customfield_10040';
                    const fallbackPayload = { fields: { [fallbackFieldName]: simpleADF } };
                    const jiraAxios = getJiraAxios();
                    await jiraAxios.put(`/rest/api/3/issue/${ticketId}`, fallbackPayload);
                    this.log(`[JiraUpload] ✓ Fallback simple ADF succeeded for ${ticketId}`);
                    return true;
                } catch (fallbackErr: any) {
                    this.log(`[JiraUpload] Simple ADF also failed: ${fallbackErr.message} — attempting plain text fallback...`);
                    try {
                        const plainText = testCases.map((tc: any, i: number) => {
                            const steps = (tc.steps || []).map((s: any) =>
                                `  ${s.stepNumber || i + 1}. Action: ${this.safeText(s.action)}\n     Verify: ${this.safeText(s.expectedResult)}`
                            ).join('\n');
                            const type = tc.isMain ? 'Main' : 'Alternative';
                            return [
                                `Test Case ${i + 1}: ${this.safeText(tc.title || tc.name)}`,
                                `Priority: ${this.safeText(tc.priority, 'Medium')} | Type: ${type}`,
                                `Description: ${this.safeText(tc.description, '-')}`,
                                `Steps:\n${steps || '  (none)'}`,
                                `Expected Outcome: ${this.safeText(tc.expectedOutcome, '-')}`,
                            ].join('\n');
                        }).join('\n\n---\n\n');
                        const fallbackFieldName = process.env.JIRA_TESTCASE_FIELD_ID || 'customfield_10040';
                        const jiraAxios2 = getJiraAxios();
                        await jiraAxios2.put(`/rest/api/3/issue/${ticketId}`, { fields: { [fallbackFieldName]: plainText } });
                        this.log(`[JiraUpload] ✓ Plain text fallback succeeded for ${ticketId}`);
                        return true;
                    } catch (plainTextErr: any) {
                        this.log(`[JiraUpload] Plain text fallback also failed: ${plainTextErr.message}`);
                    }
                }
            }

            if (errorData) {
                const errorStr = typeof errorData === 'string' ? errorData : JSON.stringify(errorData, null, 2);
                appLogger.error(`[JiraUpload] Response body: ${errorStr.substring(0, 2000)}`);
            }

            if (error.response?.config) {
                const reqUrl = error.response.config.url;
                const reqMethod = error.response.config.method;
                appLogger.error(`[JiraUpload] Request: ${reqMethod?.toUpperCase()} ${reqUrl}`);
                // Log request body size (not full body to avoid noise)
                if (error.response.config.data) {
                    const bodySize = typeof error.response.config.data === 'string'
                        ? error.response.config.data.length
                        : JSON.stringify(error.response.config.data).length;
                    appLogger.error(`[JiraUpload] Request body size: ${bodySize} bytes`);
                }
            }

            return false;
        }
    }

    /**
     * Find linked Jira issues (e.g., bugs that are tested by this test execution ticket)
     */
    static async getTestedByLinkedIssues(ticketId: string): Promise<string[]> {
        try {
            const jiraAxios = getJiraAxios();
            const response = await jiraAxios.get(`/rest/api/3/issue/${ticketId}?fields=issuelinks`);
            const links = response.data.fields?.issuelinks || [];
            
            const targetTickets: string[] = [];
            for (const link of links) {
                const linkedIssue = link.outwardIssue || link.inwardIssue;
                if (linkedIssue && linkedIssue.key) {
                    targetTickets.push(linkedIssue.key);
                }
            }
            
            return targetTickets;
        } catch (error: any) {
            this.log(`[JiraUpload] Failed to fetch linked issues for ${ticketId}: ${error.message}`);
            return [];
        }
    }

    /**
     * Validate file before upload
     */
    private static validateFile(filePath: string): { valid: boolean; error?: string } {
        if (!fs.existsSync(filePath)) {
            return { valid: false, error: 'File does not exist' };
        }

        const stats = fs.statSync(filePath);
        if (stats.size > this.MAX_FILE_SIZE) {
            return { valid: false, error: `File exceeds ${this.MAX_FILE_SIZE / 1024 / 1024}MB limit` };
        }

        const ext = path.extname(filePath).toLowerCase();
        if (!this.ALLOWED_EXTENSIONS.includes(ext)) {
            return { valid: false, error: `File type ${ext} not allowed` };
        }

        return { valid: true };
    }

    private static log(message: string, isError: boolean = false) {
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] ${message}\n`;
        const logFile = path.join(process.cwd(), 'jira_upload_debug.log');
        fs.appendFileSync(logFile, logLine);
        if (isError) { appLogger.error(message); }
        else { appLogger.info(message); }
    }

    /**
     * Compress a video file using ffmpeg to reduce attachment size.
     * Falls back to original if ffmpeg is not available.
     */
    private static async compressVideo(inputPath: string): Promise<string> {
        try {
            // 1. Check if ffmpeg is available
            try {
                execSync('ffmpeg -version', { stdio: 'ignore' });
            } catch (err) {
                this.log(`[JiraUpload] FFmpeg not found, skipping compression for ${path.basename(inputPath)}`);
                return inputPath;
            }

            // 2. Generate output path
            const dir = path.dirname(inputPath);
            const ext = path.extname(inputPath);
            const base = path.basename(inputPath, ext);
            const outputPath = path.join(dir, `compressed_${base}${ext}`);

            // 3. Run compression
            // scale: 720p height, bitrate: 500k for WebM/VP8
            this.log(`[JiraUpload] Compressing video: ${path.basename(inputPath)}...`);
            const command = `ffmpeg -i "${inputPath}" -vf "scale=-2:720" -b:v 500k -y "${outputPath}"`;
            execSync(command, { stdio: 'ignore' });

            if (fs.existsSync(outputPath)) {
                const oldSize = fs.statSync(inputPath).size;
                const newSize = fs.statSync(outputPath).size;
                const ratio = ((1 - newSize / oldSize) * 100).toFixed(1);
                this.log(`[JiraUpload] ✓ Video compressed: ${ratio}% reduction (${(newSize/1024/1024).toFixed(1)}MB)`);
                return outputPath;
            }
        } catch (err: any) {
            this.log(`[JiraUpload] Compression failed for ${path.basename(inputPath)}: ${err.message}`);
        }
        return inputPath;
    }

    /**
     * Upload a file attachment to a Jira issue
     * @param ticketId - Jira ticket ID (e.g., "AB-15")
     * @param filePath - Path to the file to upload
     * @param fileName - Optional custom filename
     * @returns Attachment ID and URL
     */
    static async uploadAttachment(
        ticketId: string,
        filePath: string,
        fileName?: string
    ): Promise<{ attachmentId: string; attachmentUrl: string }> {
        this.log(`[JiraUpload] Uploading attachment to ${ticketId}: ${filePath}`);

        if (!fs.existsSync(filePath)) {
            this.log(`[JiraUpload] ❌ File does not exist: ${filePath}`, true);
            throw new Error(`File does not exist at path: ${filePath}`);
        }

        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
            appLogger.warn(`[JiraUpload] Path is a directory: ${filePath}. Artifacts might be missing or not zipped yet.`);
            // In a real scenario, we might want to zip here, but for now, we'll throw a descriptive error
            throw new Error(`Cannot upload a directory directly. Ensure artifacts are zipped first. Path: ${filePath}`);
        }

        // Validate file
        const validation = this.validateFile(filePath);
        if (!validation.valid) {
            throw new Error(`Invalid file: ${validation.error}`);
        }

        try {
            const jiraAxios = getJiraAxios();
            const actualFileName = fileName || path.basename(filePath);

            // Read file as buffer
            const fileContent = fs.readFileSync(filePath);

            // Create form-data for multipart upload
            const formData = new FormData();
            formData.append('file', fileContent, {
                filename: actualFileName,
                contentType: this.getContentType(actualFileName)
            } as FormData.AppendOptions);

            const response = await jiraAxios.post(
                `/rest/api/3/issue/${ticketId}/attachments`,
                formData,
                {
                    headers: {
                        ...formData.getHeaders(),
                        'X-Atlassian-Token': 'no-check'
                    }
                }
            );

            const attachment = response.data[0];
            if (!attachment) {
                throw new Error('No attachment returned from Jira API');
            }

            this.log(`[JiraUpload] Successfully uploaded ${actualFileName} to ${ticketId}`);

            return {
                attachmentId: attachment.id,
                attachmentUrl: attachment.content
            };
        } catch (error: any) {
            appLogger.error(`[JiraUpload] Upload failed for ${ticketId}`, { error: error.message, details: error.response?.data });
            throw new Error(`Failed to upload attachment: ${error.message}`);
        }
    }

    /**
     * Get content type for a file extension
     */
    private static getContentType(fileName: string): string {
        const ext = path.extname(fileName).toLowerCase();
        const contentTypes: Record<string, string> = {
            '.zip': 'application/zip',
            '.webm': 'video/webm',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.json': 'application/json',
            '.html': 'text/html'
        };
        return contentTypes[ext] || 'application/octet-stream';
    }

    /**
     * Build ADF (Atlassian Document Format) comment for test results
     */
    private static buildResultsADF(
        results: TestResult[],
        summary: TestExecutionSummary,
        environment?: string,
        excelReportName?: string
    ): any {
        const timestamp = new Date().toLocaleString();
        const passColor = '#36B37E'; // Jira green
        const failColor = '#FF5630'; // Jira red
        const skipColor = '#FFAB00'; // Jira yellow

        return {
            version: 1,
            type: 'doc',
            content: [
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [
                        { type: 'text', text: '🧪 Test Execution Results' }
                    ]
                },
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: `Executed: ${timestamp} | Environment: ${environment || 'testing'}` }
                    ]
                },
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: `✅ ${summary.passed} Passed`, marks: [{ type: 'textColor', attrs: { color: passColor } }, { type: 'strong' }] },
                        { type: 'text', text: ` | ` },
                        { type: 'text', text: `❌ ${summary.failed} Failed`, marks: [{ type: 'textColor', attrs: { color: failColor } }, { type: 'strong' }] },
                        { type: 'text', text: ` | ` },
                        { type: 'text', text: `⏭️ ${summary.skipped} Skipped`, marks: [{ type: 'textColor', attrs: { color: skipColor } }, { type: 'strong' }] },
                        { type: 'text', text: ` | ` },
                        { type: 'text', text: `Pass Rate: ${summary.passRate.toFixed(1)}%`, marks: [{ type: 'strong' }] }
                    ]
                },
                {
                    type: 'table',
                    attrs: { layout: 'fixed-width' },
                    content: [
                        {
                            type: 'tableRow',
                            content: [
                                {
                                    type: 'tableHeader',
                                    attrs: {},
                                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Test Case', marks: [{ type: 'strong' }] }] }]
                                },
                                {
                                    type: 'tableHeader',
                                    attrs: {},
                                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Status', marks: [{ type: 'strong' }] }] }]
                                },
                                {
                                    type: 'tableHeader',
                                    attrs: {},
                                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Duration', marks: [{ type: 'strong' }] }] }]
                                },
                                {
                                    type: 'tableHeader',
                                    attrs: {},
                                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Error', marks: [{ type: 'strong' }] }] }]
                                }
                            ]
                        },
                        ...results.map(r => {
                            const isFault = (r as any).isExecutionFault;
                            const statusLabel = r.status === 'PASS'
                                ? '✅ PASS'
                                : r.status === 'FAIL'
                                    ? (isFault ? '⚠️ EXEC FAULT' : '❌ FAIL')
                                    : '⏭️ SKIP';
                            const statusColor = r.status === 'PASS'
                                ? passColor
                                : r.status === 'FAIL'
                                    ? (isFault ? '#FFAB00' : failColor)
                                    : skipColor;
                            const errorText = r.status === 'FAIL'
                                ? (r.errorMessage ? r.errorMessage.replace(/\x1b\[[0-9;]*m/g, '').substring(0, 200) : 'Unknown')
                                : '-';

                            return {
                                type: 'tableRow',
                                content: [
                                    {
                                        type: 'tableCell',
                                        attrs: { colspan: 1, rowspan: 1 },
                                        content: [{ type: 'paragraph', content: [{ type: 'text', text: `${r.testCaseId}: ${r.testCaseTitle}` }] }]
                                    },
                                    {
                                        type: 'tableCell',
                                        attrs: { colspan: 1, rowspan: 1 },
                                        content: [{
                                            type: 'paragraph',
                                            content: [{
                                                type: 'text',
                                                text: statusLabel,
                                                marks: [{ type: 'strong' }, { type: 'textColor', attrs: { color: statusColor } }]
                                            }]
                                        }]
                                    },
                                    {
                                        type: 'tableCell',
                                        attrs: { colspan: 1, rowspan: 1 },
                                        content: [{ type: 'paragraph', content: [{ type: 'text', text: `${(r.duration / 1000).toFixed(1)}s` }] }]
                                    },
                                    {
                                        type: 'tableCell',
                                        attrs: { colspan: 1, rowspan: 1 },
                                        content: [{ type: 'paragraph', content: [{ type: 'text', text: errorText }] }]
                                    }
                                ]
                            };
                        })
                    ]
                },
                // Per-failure detailed sections
                ...results.filter(r => r.status === 'FAIL').flatMap((r, _index) => {
                    const isFault = (r as any).isExecutionFault;
                    const steps = r.steps || [];
                    const failedSteps = steps.filter(s => s.status === 'FAIL');
                    return [
                        {
                            type: 'heading',
                            attrs: { level: 4 },
                            content: [
                                { type: 'text', text: `Failed: ${r.testCaseId} — ${r.testCaseTitle}` }
                            ]
                        },
                        ...(r.aiInsight ? [
                            {
                                type: 'panel',
                                attrs: { panelType: 'info' },
                                content: [
                                    {
                                        type: 'paragraph',
                                        content: [
                                            { type: 'text', text: 'AI Analysis: ', marks: [{ type: 'strong' }] },
                                            { type: 'text', text: r.aiInsight.likelyCause || 'Analysis pending' },
                                        ]
                                    },
                                    ...(r.aiInsight.suggestedFix ? [{
                                        type: 'paragraph',
                                        content: [
                                            { type: 'text', text: 'Suggested Fix: ', marks: [{ type: 'strong' }] },
                                            { type: 'text', text: r.aiInsight.suggestedFix },
                                        ]
                                    } as any] : [])
                                ]
                            }
                        ] : []),
                        ...(failedSteps.length > 0 ? [{
                            type: 'heading',
                            attrs: { level: 5 },
                            content: [
                                { type: 'text', text: `Failed Steps (${failedSteps.length}):` }
                            ]
                        }] : []),
                        ...failedSteps.map(s => ({
                            type: 'bulletList',
                            content: [{
                                type: 'listItem',
                                content: [
                                    {
                                        type: 'paragraph',
                                        content: [
                                            { type: 'text', text: `Step ${s.stepNumber}: `, marks: [{ type: 'strong' }] },
                                            { type: 'text', text: s.action || '' },
                                        ]
                                    },
                                    {
                                        type: 'paragraph',
                                        content: [
                                            { type: 'text', text: 'Expected: ', marks: [{ type: 'strong' }] },
                                            { type: 'text', text: s.expectedResult || '-' },
                                        ]
                                    },
                                    {
                                        type: 'paragraph',
                                        content: [
                                            { type: 'text', text: 'Actual: ', marks: [{ type: 'strong' }] },
                                            { type: 'text', text: r.errorMessage || s.action || 'Step failed', marks: [{ type: 'textColor', attrs: { color: '#FF5630' } }] },
                                        ]
                                    }
                                ]
                            }]
                        } as any))
                    ];
                }),
                ...(results.filter(r => r.status === 'FAIL').length > 0
                    ? [{
                        type: 'paragraph',
                        content: [
                            { type: 'text', text: `Screenshots for failed steps are attached to this ticket.` }
                        ]
                    } as any]
                    : []),
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: 'Full artifacts (HTML Report, ZIP bundle, Excel Report) are attached.' }
                    ]
                },
                excelReportName ? {
                    type: 'heading',
                    attrs: { level: 4 },
                    content: [
                        { type: 'text', text: `📊 Attached: ${excelReportName}` }
                    ]
                } as any : null,
            ]
        };
    }

    private static buildTableRow(r: TestResult): any {
        return {
            type: 'tableRow',
            content: [
                {
                    type: 'tableCell',
                    attrs: { colspan: 1, rowspan: 1, colwidth: [200] },
                    content: [{
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: `${r.testCaseId}: ${r.testCaseTitle}`,
                                marks: r.status === 'PASS' ? [{
                                    type: 'textColor',
                                    attrs: { color: '#10b981' }
                                }] : undefined
                            }
                        ]
                    }]
                },
                {
                    type: 'tableCell',
                    attrs: { colspan: 1, rowspan: 1, colwidth: [100] },
                    content: [{
                        type: 'paragraph',
                        content: [{
                            type: 'text',
                            text: r.status === 'PASS' ? '✅ PASS' : r.status === 'FAIL' ? '❌ FAIL' : '⏭️ SKIP',
                            marks: [{
                                type: 'textColor',
                                attrs: {
                                    color: r.status === 'PASS' ? '#10b981' :
                                           r.status === 'FAIL' ? '#f43f5e' : '#f59e0b'
                                }
                            }]
                        }]
                    }]
                },
                {
                    type: 'tableCell',
                    attrs: { colspan: 1, rowspan: 1, colwidth: [100] },
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: r.duration ? `${(r.duration / 1000).toFixed(1)}s` : 'N/A' }] }]
                },
                {
                    type: 'tableCell',
                    attrs: { colspan: 1, rowspan: 1, colwidth: [250] },
                    content: [{
                        type: 'paragraph',
                        content: [{
                            type: 'text',
                            text: r.errorMessage ? r.errorMessage.substring(0, 100) + (r.errorMessage.length > 100 ? '...' : '') : '-',
                            marks: r.errorMessage ? [{
                                type: 'textColor',
                                attrs: { color: '#f43f5e' }
                            }] : undefined
                        }]
                    }]
                },
                {
                    type: 'tableCell',
                    attrs: { colspan: 1, rowspan: 1, colwidth: [350] },
                    content: [{
                        type: 'paragraph',
                        content: [{
                            type: 'text',
                            text: r.aiInsight ? `${r.aiInsight.likelyCause}. ${r.aiInsight.suggestedFix}` : '-',
                            marks: r.aiInsight ? [{
                                type: 'textColor',
                                attrs: { color: r.aiInsight.isScriptIssue ? '#f59e0b' : '#3b82f6' }
                            }] : undefined
                        }]
                    }]
                }
            ]
        };
    }

    private static buildSingleResultADF(r: TestResult, environment?: string): any {
        const timestamp = new Date().toLocaleString();
        const statusColor = r.status === 'PASS' ? '#10b981' : (r.status === 'FAIL' ? '#f43f5e' : '#f59e0b');
        const statusText = r.status === 'PASS' ? '✅ PASS' : (r.status === 'FAIL' ? '❌ FAIL' : '⏭️ SKIP');

        return {
            version: 1,
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: `${statusText} | `, marks: [{ type: 'strong' }, { type: 'textColor', attrs: { color: statusColor } }] },
                        { type: 'text', text: `${r.testCaseId}: ${r.testCaseTitle}`, marks: [{ type: 'strong' }] },
                        { type: 'text', text: ` | ${(r.duration / 1000).toFixed(1)}s | Env: ${environment || 'N/A'}` }
                    ]
                },
                ...(r.status === 'FAIL' ? [
                    {
                        type: 'paragraph',
                        content: [
                            { type: 'text', text: 'ErrorMessage: ', marks: [{ type: 'strong' }] },
                            { type: 'text', text: (r.errorMessage || 'Unknown').substring(0, 500), marks: [{ type: 'textColor', attrs: { color: '#f43f5e' } }] }
                        ]
                    },
                    {
                        type: 'paragraph',
                        content: [
                            { type: 'text', text: '💡 AI Root Cause Analysis:', marks: [{ type: 'strong' }] }
                        ]
                    },
                    {
                        type: 'paragraph',
                        content: [
                            { type: 'text', text: r.aiInsight?.summary || 'Analyzing failure...' }
                        ]
                    }
                ] : [])
            ]
        };
    }

    /**
     * Build simple summary ADF using paragraphs instead of complex tables
     */
    private static buildSimpleResultsADF(
        results: TestResult[],
        summary: TestExecutionSummary,
        environment?: string
    ): any {
        const passColor = '#36B37E';
        const failColor = '#FF5630';
        const skipColor = '#FFAB00';
        const faultCount = results.filter(r => r.status === 'FAIL' && (r as any).isExecutionFault).length;

        return {
            version: 1,
            type: 'doc',
            content: [
                {
                    type: 'heading',
                    attrs: { level: 3 },
                    content: [{ type: 'text', text: 'Test Execution Summary' }]
                },
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: `Environment: ${environment || 'testing'}` }
                    ]
                },
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: 'Results: ', marks: [{ type: 'strong' }] },
                        { type: 'text', text: 'Pass: ', marks: [{ type: 'textColor', attrs: { color: passColor } }, { type: 'strong' }] },
                        { type: 'text', text: `${summary.passed} (${summary.passRate}%)` },
                        { type: 'text', text: ' | Fail: ', marks: [{ type: 'strong' }] },
                        { type: 'text', text: `${summary.failed}`, marks: [{ type: 'textColor', attrs: { color: failColor } }] },
                        { type: 'text', text: ` | Skipped: `, marks: [{ type: 'strong' }] },
                        { type: 'text', text: `${summary.skipped}`, marks: [{ type: 'textColor', attrs: { color: skipColor } }] },
                        ...(faultCount > 0 ? [
                            { type: 'text', text: ` | Execution Code Fault: `, marks: [{ type: 'strong' }] },
                            { type: 'text', text: `${faultCount}` }
                        ] : [])
                    ]
                },
                {
                    type: 'bulletList',
                    content: results.map(r => ({
                        type: 'listItem',
                        content: [{
                            type: 'paragraph',
                            content: [
                                {
                                    type: 'text',
                                    text: `${r.testCaseId}: ${r.status}`,
                                    marks: [{
                                        type: 'textColor',
                                        attrs: {
                                            color: r.status === 'PASS' ? passColor :
                                                r.status === 'FAIL' ? failColor : skipColor
                                        }
                                    }]
                                },
                                { type: 'text', text: ` - ${r.testCaseTitle}` },
                                ...(r.status === 'FAIL' && r.errorMessage ? [
                                    { type: 'text', text: ` (${r.errorMessage.substring(0, 80)})` }
                                ] : [])
                            ]
                        }]
                    }))
                }
            ]
        };
    }

    /**
     * Build a plain text fallback comment for test results (third-level fallback).
     * Used when both enhanced ADF and bullet ADF fail.
     */
    private static buildPlainTextResultsComment(
        results: TestResult[],
        summary: TestExecutionSummary,
        environment?: string
    ): string {
        const timestamp = new Date().toLocaleString();
        const lines: string[] = [
            `🧪 Test Execution Results`,
            `Executed: ${timestamp} | Environment: ${environment || 'testing'}`,
            ``,
            `✅ Pass: ${summary.passed} | ❌ Fail: ${summary.failed} | ⚠️ Fault: ${summary.faults || 0} | ⏭️ Skipped: ${summary.skipped || 0}`,
            `Pass Rate: ${summary.passRate.toFixed(1)}%`,
            ``,
            `─── Test Details ───`,
        ];

        for (const r of results) {
            const status = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⏭️';
            lines.push(`${status} ${r.testCaseId}: ${r.testCaseTitle} (${(r.duration / 1000).toFixed(1)}s)`);
            if (r.status === 'FAIL' && r.errorMessage) {
                const shortError = r.errorMessage.substring(0, 200);
                lines.push(`   Error: ${shortError}`);
            }
        }

        lines.push(``, `─── End of Results ───`);
        return lines.join('\n');
    }

    /**
     * Post test results summary as a comment (ADF format)
     * Uses enhanced JiraCommentBuilder for Excel-style table with
     * Pass | Failed | Code Fault columns and root cause analysis logs.
     *
     * @param ticketId - Jira ticket ID
     * @param results - Array of test results
     * @param summary - Execution summary statistics
     * @param environment - Optional environment name
     * @param excelReportName - Optional Excel report filename
     * @param artifacts - Optional artifact upload status
     */
    static async postTestResultsComment(
        ticketId: string,
        results: TestResult[],
        summary: TestExecutionSummary,
        environment?: string,
        excelReportName?: string,
        artifacts?: { zipUploaded?: boolean; htmlReportUploaded?: boolean; excelUploaded?: boolean }
    ): Promise<void> {
        this.log(`[JiraUpload] Posting enhanced results to ${ticketId}`);

        try {
            const jiraAxios = getJiraAxios();

            // 1. Post individual comments for each test case (with root cause panel)
            for (const result of results) {
                try {
                    const singleAdf = buildSingleResultEnhancedADF(result, environment);
                    // Sanitize ADF in-place so empty/undefined text nodes
                    // don't trigger a 400 from Jira.
                    this.validateADF(singleAdf);
                    await jiraRequest(() => jiraAxios.post(`/rest/api/3/issue/${ticketId}/comment`, { body: singleAdf }));
                    this.log(`[JiraUpload] ✓ Individual comment posted for ${result.testCaseId}`);
                } catch (err: any) {
                    appLogger.error(`[JiraUpload] Failed to post individual comment for ${result.testCaseId}`, { error: err.message });
                }
            }

            // 2. Post final summary table (enhanced format)
            try {
                const summaryAdf = buildEnhancedResultsADF(results, summary, environment, excelReportName, artifacts);
                this.validateADF(summaryAdf);
                await jiraRequest(() => jiraAxios.post(`/rest/api/3/issue/${ticketId}/comment`, { body: summaryAdf }));
            } catch (adfErr: any) {
                // Fallback 1: Bullet list ADF
                try {
                    appLogger.warn(`[JiraUpload] Enhanced ADF rejected, falling back to bullet list`, { error: adfErr.message });
                    const bulletAdf = buildFallbackResultsADF(results, summary, environment);
                    this.validateADF(bulletAdf);
                    await jiraRequest(() => jiraAxios.post(`/rest/api/3/issue/${ticketId}/comment`, { body: bulletAdf }));
                } catch (bulletErr: any) {
                    // Fallback 2: Plain text comment (last resort)
                    appLogger.warn(`[JiraUpload] Bullet ADF also rejected, falling back to plain text`, { error: bulletErr.message });
                    const plainText = this.buildPlainTextResultsComment(results, summary, environment);
                    await jiraRequest(() => jiraAxios.post(`/rest/api/3/issue/${ticketId}/comment`, { body: { body: plainText } }));
                }
            }

            this.log(`[JiraUpload] Successfully posted enhanced summary comment to ${ticketId}`);
        } catch (error: any) {
            appLogger.error(`[JiraUpload] Failed to post summary comment to ${ticketId}`, { error: error.message });
            throw new Error(`Failed to post results comment: ${error.message}`);
        }
    }

    /**
     * Transition issue to final status (Done or Bug Done)
     * @param ticketId - Jira ticket ID
     * @param status - Target status
     * @param comment - Optional comment to add with transition
     */
    static async transitionToFinalStatus(
        ticketId: string,
        status: 'Done' | 'Bug Done',
        comment?: string
    ): Promise<{ success: boolean; status: string; message?: string }> {
        this.log(`[JiraUpload] Transitioning ${ticketId} to ${status}`);

        try {
            let result: Awaited<ReturnType<typeof JiraTransitionService.transitionToStatus>>;

            if (status === 'Done') {
                result = await JiraTransitionService.transitionToDone(
                    ticketId,
                    comment || '✅ Testing completed successfully. All test cases passed.'
                );
            } else {
                result = await JiraTransitionService.transitionToBugDone(
                    ticketId,
                    comment || '🐞 Testing completed. Bug verified and fixed.'
                );
            }

            return {
                success: result.success,
                status: result.toStatus,
                message: result.message
            };
        } catch (error: any) {
            appLogger.error(`[JiraUpload] Transition failed for ${ticketId}`, { error: error.message });
            return {
                success: false,
                status: '',
                message: error.message
            };
        }
    }

    /**
     * Upload individual screenshots for failed test cases
     * Uploads up to maxScreenshots per test case to give visual evidence
     */
    static async uploadFailureScreenshots(
        ticketId: string,
        results: TestResult[],
        maxScreenshots: number = 3
    ): Promise<Array<{ testCaseId: string; screenshotPath: string; success: boolean }>> {
        const uploadResults: Array<{ testCaseId: string; screenshotPath: string; success: boolean }> = [];

        for (const result of results) {
            if (result.status !== 'FAIL' || !result.screenshotPaths || result.screenshotPaths.length === 0) {
                continue;
            }

            const screenshotsToUpload = result.screenshotPaths.slice(0, maxScreenshots);
            for (const screenshotPath of screenshotsToUpload) {
                try {
                    if (!fs.existsSync(screenshotPath)) {
                        appLogger.warn(`[JiraUpload] Screenshot not found: ${screenshotPath}`);
                        uploadResults.push({ testCaseId: result.testCaseId, screenshotPath, success: false });
                        continue;
                    }

                    const fileName = `${ticketId}_${result.testCaseId}_${path.basename(screenshotPath)}`;
                    await this.uploadAttachment(ticketId, screenshotPath, fileName);
                    this.log(`[JiraUpload] Screenshot uploaded for ${result.testCaseId}`);
                    uploadResults.push({ testCaseId: result.testCaseId, screenshotPath, success: true });
                } catch (err: any) {
                    appLogger.warn(`[JiraUpload] Failed to upload screenshot for ${result.testCaseId}`, { error: err.message, path: screenshotPath });
                    uploadResults.push({ testCaseId: result.testCaseId, screenshotPath, success: false });
                }
            }
        }

        return uploadResults;
    }

    /**
     * Upload individual video recordings for each test case.
     * Videos provide visual evidence of test execution for debugging.
     * Uploads one video per test case regardless of pass/fail status.
     */
    static async uploadVideoRecordings(
        ticketId: string,
        results: TestResult[],
        maxVideosPerCase: number = 1
    ): Promise<Array<{ testCaseId: string; videoPath: string; success: boolean }>> {
        const uploadResults: Array<{ testCaseId: string; videoPath: string; success: boolean }> = [];

        for (const result of results) {
            if (!result.videoPath) {
                continue;
            }

            const videosToUpload = [result.videoPath].slice(0, maxVideosPerCase);
            for (const videoPath of videosToUpload) {
                try {
                    if (!fs.existsSync(videoPath)) {
                        appLogger.warn(`[JiraUpload] Video not found: ${videoPath}`);
                        uploadResults.push({ testCaseId: result.testCaseId, videoPath, success: false });
                        continue;
                    }

                    const fileName = `${ticketId}_${result.testCaseId}_video.webm`;
                    
                    // Compress video if possible before uploading
                    const finalVideoPath = await this.compressVideo(videoPath);
                    const finalFileName = finalVideoPath !== videoPath ? `${ticketId}_${result.testCaseId}_video_compressed.webm` : fileName;

                    await this.uploadAttachment(ticketId, finalVideoPath, finalFileName);
                    this.log(`[JiraUpload] Video uploaded for ${result.testCaseId} (${result.status})`);
                    uploadResults.push({ testCaseId: result.testCaseId, videoPath, success: true });
                } catch (err: any) {
                    appLogger.warn(`[JiraUpload] Failed to upload video for ${result.testCaseId}`, { error: err.message, path: videoPath });
                    uploadResults.push({ testCaseId: result.testCaseId, videoPath, success: false });
                }
            }
        }

        return uploadResults;
    }

    /**
 * Complete workflow: Upload ZIP + Post comment + Transition (optional)
 * @param ticketId - Jira ticket ID
 * @param zipPath - Path to the ZIP file with artifacts
 * @param results - Array of test results
 * @param summary - Execution summary
 * @param transitionTo - Optional final status transition
 * @param environment - Optional environment name for the comment
 * @returns UploadResult plus a list of step-level errors for observability
 */
static async completeWorkflow(
    ticketId: string,
    zipPath: string,
    results: TestResult[],
    summary: TestExecutionSummary,
    transitionTo?: 'Done' | 'Bug Done' | 'In Testing',
    environment?: string
): Promise<UploadResult & { errors: string[] }> {
    this.log(`[JiraUpload] Starting complete workflow for ${ticketId}`);

    let attachmentId = '';
    let attachmentUrl = '';
    let excelAttachmentId = '';
    let commentPosted = false;
    let transitioned = false;
    let transitionStatus: string | undefined;
    const errors: string[] = [];

    // For 'In Testing', skip all transition and non-critical steps
    const isKeepInTesting = transitionTo === 'In Testing';

    const trackError = (step: string, err: any) => {
        const msg = `[${step}] ${err.message || 'Unknown error'}`;
        errors.push(msg);
        appLogger.error(`[JiraUpload] ${msg}`, { error: err.message, httpStatus: err.response?.status, data: err.response?.data });
    };

    // === CRITICAL STEP 1: Generate Excel Report (non-blocking if fails) ===
    let excelPath = '';
    try {
        excelPath = await this.generateExcelReport(ticketId, results, summary, environment || 'N/A');
        this.log(`[JiraUpload] ✓ Excel report generated: ${excelPath}`);
    } catch (err: any) {
        trackError('Excel generation', err);
    }

    // === CRITICAL STEP 1.5: Find and upload HTML Report ===
    try {
        const htmlReportDir = path.join(process.cwd(), 'test-results', ticketId);
        if (fs.existsSync(htmlReportDir)) {
            const htmlFiles = fs.readdirSync(htmlReportDir).filter(f => f.startsWith(`${ticketId}_Report_`) && f.endsWith('.html'));
            if (htmlFiles.length > 0) {
                const latestHtml = htmlFiles.sort().pop();
                const htmlPath = path.join(htmlReportDir, latestHtml!);
                await this.uploadAttachment(ticketId, htmlPath, `${ticketId}_Report.html`);
                this.log(`[JiraUpload] ✓ HTML report uploaded to ${ticketId}`);
            }
        }
    } catch (err: any) {
        trackError('HTML report upload', err);
    }

    // === CRITICAL STEP 2: Update Jira Custom Fields ===
    try {
        await this.updateJiraTestFields(ticketId, results);
    } catch (err: any) {
        // Non-blocking: custom fields may not be on screen
        if (err.response?.status !== 400) {
            trackError('Custom field update', err);
        }
    }

    // === CRITICAL STEP 3: Upload Artifacts (ZIP and Excel) — BLOCKING ===
    try {
        this.log(`[JiraUpload] Attempting to upload zip to runner ticket: ${ticketId}`);
        const uploadResult = await this.uploadAttachment(ticketId, zipPath);
        attachmentId = uploadResult.attachmentId;
        attachmentUrl = uploadResult.attachmentUrl;

        if (excelPath) {
            const excelResult = await this.uploadAttachment(ticketId, excelPath);
            excelAttachmentId = excelResult.attachmentId;
        }
        this.log(`[JiraUpload] ✓ Artifacts uploaded to ${ticketId}`);
    } catch (err: any) {
        trackError('Artifact upload', err);
    }

    // === CRITICAL STEP 3.5: Upload individual screenshots for failed test cases ===
    try {
        const screenshotResults = await this.uploadFailureScreenshots(ticketId, results);
        const uploadCount = screenshotResults.filter(r => r.success).length;
        this.log(`[JiraUpload] Uploaded ${uploadCount}/${screenshotResults.length} failure screenshots`);
    } catch (err: any) {
        trackError('Screenshots upload', err);
    }

    // === CRITICAL STEP 3.6: Upload individual video recordings for each test case ===
    try {
        const videoUploadResults = await this.uploadVideoRecordings(ticketId, results);
        const videoCount = videoUploadResults.filter(r => r.success).length;
        this.log(`[JiraUpload] Uploaded ${videoCount}/${videoUploadResults.length} video recordings`);
    } catch (err: any) {
        trackError('Video upload', err);
    }

    // === CRITICAL STEP 3.7: Automated Bug Reporting for definitive defects ===
    try {
        this.log(`[JiraUpload] Checking for definitive defects to auto-report as bugs...`);
        for (const result of results) {
            if (result.status === 'FAIL') {
                const bugId = await JiraBugReportingService.reportDefectIfApplicable(ticketId, result);
                if (bugId) {
                    this.log(`[JiraUpload] ✓ Auto-reported defect as Bug: ${bugId}`);
                }
            }
        }
    } catch (err: any) {
        appLogger.warn(`[JiraUpload] Automated bug reporting failed`, { error: err.message });
    }

    // === CRITICAL STEP 4: Post results comment — BLOCKING ===
    try {
        const excelFileName = excelPath ? path.basename(excelPath) : undefined;
        this.log(`[JiraUpload] Posting comment to ${ticketId}`);
        await this.postTestResultsComment(ticketId, results, summary, environment, excelFileName, {
            zipUploaded: !!attachmentId,
            htmlReportUploaded: true, // HTML report upload happens before this step
            excelUploaded: !!excelAttachmentId
        });
        commentPosted = true;
        this.log(`[JiraUpload] ✓ Results comment posted to ${ticketId}`);
    } catch (err: any) {
        trackError('Comment post', err);
    }

    // === CRITICAL STEP 5: Transition if requested (skip for 'In Testing') ===
    if (transitionTo && transitionTo !== 'In Testing') {
        try {
            const passRate = summary.passRate;
            let transitionComment: string;

            if (transitionTo === 'Bug Done') {
                transitionComment = `🐞 Bug fix verified. ${summary.passed}/${summary.total} tests passed (${passRate}%).`;
            } else {
                transitionComment = `✅ Testing completed. ${summary.passed}/${summary.total} tests passed (${passRate}%). All acceptance criteria verified.`;
            }

            const transitionResult = await this.transitionToFinalStatus(
                ticketId,
                transitionTo,
                transitionComment
            );

            transitioned = transitionResult.success;
            transitionStatus = transitionResult.status;
            this.log(`[JiraUpload] ✓ Transitioned to ${transitionStatus}: ${transitioned}`);
        } catch (err: any) {
            trackError('Transition', err);
        }
    } else if (transitionTo === 'In Testing') {
        this.log(`[JiraUpload] Skipping transition - ticket stays in "In Testing"`);
    }

    // Log summary of accumulated errors
    if (errors.length > 0) {
        appLogger.warn(`[JiraUpload] Workflow completed with ${errors.length} error(s) for ${ticketId}`, { errors });
    }

    this.log(`[JiraUpload] Complete workflow finished for ${ticketId}`);

    return {
        attachmentId,
        attachmentUrl,
        excelAttachmentId,
        commentPosted,
        transitioned,
        transitionStatus,
        errors
    };
}

    /**
     * Upload multiple artifacts individually (videos + screenshots)
     * @param ticketId - Jira ticket ID
     * @param artifactPaths - Array of file paths to upload
     * @returns Array of upload results
     */
    static async uploadMultipleArtifacts(
        ticketId: string,
        artifactPaths: string[]
    ): Promise<Array<{ path: string; attachmentId: string; success: boolean }>> {
        const results: Array<{ path: string; attachmentId: string; success: boolean }> = [];

        for (const artifactPath of artifactPaths) {
            try {
                const result = await this.uploadAttachment(ticketId, artifactPath);
                results.push({
                    path: artifactPath,
                    attachmentId: result.attachmentId,
                    success: true
                });
            } catch (error: any) {
                appLogger.warn(`[JiraUpload] Failed to upload ${artifactPath}`, { error: error.message });
                results.push({
                    path: artifactPath,
                    attachmentId: '',
                    success: false
                });
            }
        }

        return results;
    }

    /**
     * Generate HTML report from test results
     * @param results - Array of test results
     * @param summary - Execution summary
     * @returns HTML content
     */
    static generateHTMLReport(
        results: TestResult[],
        summary: TestExecutionSummary,
        ticketId: string
    ): string {
        const timestamp = new Date().toLocaleString();

        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test Report - ${ticketId}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); padding: 24px; }
        h1 { color: #1a1a1a; margin-bottom: 8px; }
        .meta { color: #666; margin-bottom: 24px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin-bottom: 32px; }
        .stat-card { padding: 16px; border-radius: 8px; text-align: center; }
        .stat-card.total { background: #f3f4f6; }
        .stat-card.passed { background: #d1fae5; }
        .stat-card.failed { background: #fee2e2; }
        .stat-card.skipped { background: #fef3c7; }
        .stat-value { font-size: 32px; font-weight: bold; }
        .stat-label { color: #666; font-size: 14px; margin-top: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 24px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e5e5; }
        th { background: #f9fafb; font-weight: 600; }
        .status-pass { color: #059669; font-weight: 600; }
        .status-fail { color: #dc2626; font-weight: 600; }
        .status-skip { color: #d97706; font-weight: 600; }
        .error-msg { color: #dc2626; font-size: 13px; max-width: 400px; overflow: hidden; text-overflow: ellipsis; }
        .test-case-title { font-weight: 500; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🧪 Test Execution Report</h1>
        <div class="meta">
            <strong>Ticket:</strong> ${ticketId} |
            <strong>Generated:</strong> ${timestamp}
        </div>

        <div class="summary">
            <div class="stat-card total">
                <div class="stat-value">${summary.total}</div>
                <div class="stat-label">Total</div>
            </div>
            <div class="stat-card passed">
                <div class="stat-value">${summary.passed}</div>
                <div class="stat-label">Passed</div>
            </div>
            <div class="stat-card failed">
                <div class="stat-value">${summary.failed}</div>
                <div class="stat-label">Failed</div>
            </div>
            <div class="stat-card skipped">
                <div class="stat-value">${summary.skipped}</div>
                <div class="stat-label">Skipped</div>
            </div>
        </div>

        <h2>Test Results</h2>
        <table>
            <thead>
                <tr>
                    <th>Test Case</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Error</th>
                </tr>
            </thead>
            <tbody>
                ${results.map(r => `
                <tr>
                    <td class="test-case-title">${r.testCaseId}: ${r.testCaseTitle}</td>
                    <td class="status-${r.status.toLowerCase()}">${r.status}</td>
                    <td>${(r.duration / 1000).toFixed(1)}s</td>
                    <td class="error-msg">${r.errorMessage || '-'}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
</body>
</html>
`.trim();
    }

    /**
     * Save HTML report to file
     * @param results - Test results
     * @param summary - Execution summary
     * @param ticketId - Jira ticket ID
     * @param outputPath - Optional custom output path
     * @returns Path to saved HTML file
     */
    static async saveHTMLReport(
        results: TestResult[],
        summary: TestExecutionSummary,
        ticketId: string,
        outputPath?: string
    ): Promise<string> {
        const htmlContent = this.generateHTMLReport(results, summary, ticketId);
        const defaultPath = path.join(
            process.cwd(),
            'local_storage',
            'test-artifacts',
            ticketId,
            `${ticketId}_report_${Date.now()}.html`
        );
        const finalPath = outputPath || defaultPath;

        // Ensure directory exists
        const dir = path.dirname(finalPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(finalPath, htmlContent, 'utf-8');
        this.log(`[JiraUpload] HTML report saved to ${finalPath}`);

        return finalPath;
    }
}
