import { CloudAIService } from './CloudAIService';
import * as path from 'path';
import * as fs from 'fs';
import * as XLSX from 'xlsx';
import fetch from 'node-fetch';
import archiver from 'archiver';
import { KnowledgeService } from './KnowledgeService';
import { LocalAIService } from './LocalAIService';
import { config } from './config';
import { getJiraAxios } from '../src/utils/jiraAxios';
import { JiraIssue as AIJiraIssue } from '../src/engine/AIBrainEngine';
import { ModuleRegistry } from '../src/services/shared/ModuleRegistry';

export interface TestCase {
    caseId: string;
    title: string;
    isMain: boolean;
    steps: {
        stepNumber: number;
        action: string;
        expectedResult: string;
        selectorHint?: string;
    }[];
    expectedOutcome: string;
}

export interface JiraPlaybook {
    jiraId: string;
    summary: string;
    description: string;
    module: string;
    menu: string;
    testCases: TestCase[];
    requiredRoles: string[];
    tokensUsed: {
        prompt: number;
        completion: number;
        total: number;
    };
    generatedAt: string;
}

/**
 * Test Result Interface for Jira Evidence Upload
 */
export interface TestResult {
    testCaseId: string;
    title: string;
    status: 'PASS' | 'FAIL' | 'SKIP';
    error?: string;
    screenshotPath?: string;
    tracePath?: string;
    videoPath?: string;
    duration: number;
}

export class JiraService {
    private static CACHE_DIR = path.join(config.storage.baseDir, 'cache', 'jira');

    private static ensureCacheDir() {
        if (!fs.existsSync(this.CACHE_DIR)) {
            fs.mkdirSync(this.CACHE_DIR, { recursive: true });
        }
        this.cleanupOldPlaybooks();
    }

    /**
     * Remove playbooks older than 7 days to save space.
     */
    private static cleanupOldPlaybooks() {
        try {
            const files = fs.readdirSync(this.CACHE_DIR);
            const now = Date.now();
            const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                const filePath = path.join(this.CACHE_DIR, file);
                const stats = fs.statSync(filePath);
                if (now - stats.mtimeMs > TTL_MS) {
                    fs.unlinkSync(filePath);
                }
            }
        } catch (err) {
            console.error('[JiraService] Cache cleanup failed:', (err as Error).message);
        }
    }

    private static getCachePath(jiraId: string): string {
        return path.join(this.CACHE_DIR, `${jiraId.replace(/[^a-zA-Z0-9-]/g, '_')}.json`);
    }

    /**
     * Phase A: One-Time Cloud/Local AI Playbook Generation with Multi-Case Support & Knowledge Expansion
     */
    static async generatePlaybook(
        jiraId: string, 
        summary: string, 
        description: string, 
        comments: any[] = [],
        modelOverride?: string
    ): Promise<JiraPlaybook> {
        this.ensureCacheDir();
        const cachePath = this.getCachePath(jiraId);

        // Check Cache first
        if (fs.existsSync(cachePath)) {
            console.log(`[JiraService] Cache hit for ${jiraId}. Reusing existing playbook.`);
            const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            return cached as JiraPlaybook;
        }

        // 1. Detect Module
        let detection = this.detectModuleAndMenu(summary, description);

        // AI Fallback if keyword matching is weak
        if (detection.confidence < 0.3) {
            console.log(`[JiraService] Low confidence (${detection.confidence}) for ${jiraId}, attempting AI classification...`);
            const aiDetection = await this.detectModuleViaAI(summary, description);
            if (aiDetection) {
                detection = {
                    ...aiDetection,
                    alternatives: [ `${detection.module}/${detection.menu} (Keyword fallback)` ]
                };
            }
        }

        const { module, menu } = detection;
        const isBug = summary.toLowerCase().includes('bug') || description.toLowerCase().includes('reproduce');
        
        console.log(`[JiraService] Mission Type: ${isBug ? 'BUG REPRODUCTION' : 'STORY VALIDATION'}`);
        console.log(`[JiraService] Target: ${module} > ${menu}`);

        // 2. Fetch relevant knowledge from User Guide/Manuals
        const docs = await KnowledgeService.findSemanticDocs(`${module} ${menu} ${summary}`, 2);
        const businessContext = docs.map(d => `--- From ${d.title} ---\n${d.snippet}`).join('\n\n');

        const prompt = `
            # Role: ${isBug ? 'Forensic QA Detective' : 'Feature Validation Expert'}
            # Mission: ${isBug ? `Reproduction of Bug [${jiraId}]` : `Verification of User Story [${jiraId}]`}
            # Project: GlobalHR Cloud ERP (Kendo UI / Angular)

            ## JIRA DATA:
            - ID: ${jiraId}
            - Summary: ${summary}
            - Description: ${description}
            - Context: ${module} > ${menu}

            ## DISCUSSION & HISTORY:
            ${comments.length > 0 ? comments.map(c => `- [${c.author}] ${c.body}`).join('\n') : 'No additional discussion found.'}

            ## ${isBug ? 'CRITICAL FAILURE POINT' : 'ACCEPTANCE CRITERIA'}:
            ${isBug ? 'Focus on the "Short Code" or "Validation" errors mentioned.' : 'Ensure the dropdowns, lists, and file persistence work as per the AC.'}

            ## BUSINESS RULES:
            ${businessContext || "No specific rules found. Use general HR logic."}

            ## TASK:
            ${isBug 
                ? 'Generate negative test scenarios to REPRODUCE the reported failure. Identify exactly which fields to break.' 
                : 'Generate a comprehensive test suite to VALIDATE all acceptance criteria. Focus on the end-to-end user journey.'}

            ## OUTPUT FORMAT (STRICT JSON ONLY):
            {
                "jiraId": "${jiraId}",
                "summary": "${summary}",
                "module": "${module}",
                "menu": "${menu}",
                "testCases": [
                    {
                        "caseId": "MAIN_BUG",
                        "title": "Reproduction of reported issue",
                        "isMain": true,
                        "steps": [
                            { "stepNumber": 1, "action": "...", "expectedResult": "...", "selectorHint": "..." }
                        ],
                        "expectedOutcome": "Identify the reported failure point"
                    }
                ],
                "requiredRoles": ["Admin"]
            }

            ## CONSTRAINTS:
            1. Generate 3-5 test cases total.
            2. At least 1 case MUST be derived from the BUSINESS RULES.
            3. Return ONLY the JSON object. No markdown, no pre-amble.
        `;

        const targetModel = modelOverride || config.ai.defaultModel;
        let responseJson: string | null;

        if (targetModel.includes('gemini') || targetModel.includes('gpt')) {
            responseJson = await CloudAIService.conductFinalAudit(prompt, "Output MUST be valid JSON.");
        } else {
            console.log(`[JiraService] Using local model: ${targetModel}`);
            responseJson = await LocalAIService.simpleGenerate('qwen', prompt);
        }

        if (!responseJson) throw new Error("AI returned empty response.");

        // Token Estimation
        const tokensUsed = {
            prompt: Math.ceil(prompt.length / 4),
            completion: Math.ceil(responseJson.length / 4),
            total: Math.ceil((prompt.length + responseJson.length) / 4)
        };

        let playbook: JiraPlaybook;
        try {
            // Robust extraction for balanced braces
            let jsonText = responseJson.trim();
            const firstOpen = jsonText.indexOf('{');
            if (firstOpen === -1) throw new Error('No JSON object found in response');

            let depth = 0;
            let lastClose = -1;
            for (let i = firstOpen; i < jsonText.length; i++) {
                if (jsonText[i] === '{') depth++;
                else if (jsonText[i] === '}') {
                    depth--;
                    if (depth === 0) {
                        lastClose = i;
                        break;
                    }
                }
            }

            if (lastClose === -1) throw new Error('No balanced JSON found');

            playbook = JSON.parse(jsonText.substring(firstOpen, lastClose + 1));
            playbook.jiraId = jiraId;
            playbook.description = description;
            playbook.tokensUsed = tokensUsed;
            playbook.generatedAt = new Date().toISOString();

            // Store in Cache
            fs.writeFileSync(cachePath, JSON.stringify(playbook, null, 2));
            console.log(`[JiraService] Playbook generated and cached for ${jiraId}. Tokens: ${tokensUsed.total}`);

            return playbook;
        } catch (e: any) {
            console.error('[JiraService] Parse Error. Raw Response:', responseJson);
            throw new Error('Failed to parse playbook JSON: ' + e?.message);
        }
    }

    /**
     * Use local AI to classify a ticket against ALL known modules in the registry.
     */
    private static async detectModuleViaAI(summary: string, description: string): Promise<{ module: string, menu: string, confidence: number } | null> {
        try {
            const confirmedModules = ModuleRegistry.getAllConfirmed();
            const moduleList = confirmedModules.map(m => `- ${m.moduleName} (Path: ${m.fullNavigationPath || m.menuName})`).join('\n');
            
            const prompt = `
                # Task: Classify a Jira ticket into the correct software module.
                # Project: GlobalHR Cloud ERP
                
                # Available Modules:
                ${moduleList}
                
                # Ticket Summary: ${summary}
                # Ticket Description: ${description.substring(0, 1000)}
                
                # Instructions:
                1. Identify which module and menu from the list above is the most likely target for this ticket.
                2. If no exact match exists, pick the closest one.
                3. Return your answer as a JSON object: {"module": "ModuleName", "menu": "MenuName", "confidence": 0.0-1.0}
                
                # Response (JSON only):
            `;

            const response = await LocalAIService.simpleGenerate(prompt, 'qwen');
            const json = this.extractJSON(response);
            if (json && json.module) {
                return {
                    module: json.module,
                    menu: json.menu || json.module,
                    confidence: json.confidence || 0.8
                };
            }
        } catch (err: any) {
            console.warn(`[JiraService] AI classification failed: ${err.message}`);
        }
        return null;
    }

    private static extractJSON(text: string): any {
        try {
            // Find the outermost braces
            const firstOpen = text.indexOf('{');
            const lastClose = text.lastIndexOf('}');
            
            if (firstOpen === -1 || lastClose === -1 || lastClose <= firstOpen) {
                return null;
            }

            const jsonCandidate = text.substring(firstOpen, lastClose + 1);
            
            // Try direct parse first
            try {
                return JSON.parse(jsonCandidate);
            } catch (e) {
                // If it fails, try a more aggressive cleanup (removing markdown code blocks)
                const cleaned = jsonCandidate
                    .replace(/```json/g, '')
                    .replace(/```/g, '')
                    .trim();
                return JSON.parse(cleaned);
            }
        } catch {
            return null;
        }
    }

    private static GLOBALHR_KNOWLEDGE: Record<string, { menus: string[], keywords: Record<string, string[]> }> = {
        "Master": {
            "menus": ["Department", "Grade", "Designation", "Leave Type", "Shift Policy"],
            "keywords": {
                "Department": ["department", "dept", "division", "unit"],
                "Grade": ["grade", "grades", "grade scale", "salary grade", "level"],
                "Designation": ["designation", "designations", "role", "job title", "position", "title"],
                "Leave Type": ["leave", "annual", "sick", "casual", "maternity"],
                "Shift Policy": ["shift", "timing", "roster", "schedule"]
            }
        },
        "Employee": {
            "menus": ["Employee Setup", "Employee Policy", "Employee Resignation"],
            "keywords": {
                "Employee Setup": ["employee", "staff", "registration", "employee information"],
                "Employee Resignation": ["resign", "exit", "separation", "termination"]
            }
        },
        "Time Attendance": {
            "menus": ["Leave Request", "Leave Approve", "OT Request", "Attendance Process"],
            "keywords": {
                "Leave Request": ["apply leave", "submit leave", "leave request"],
                "Leave Approve": ["approve leave", "leave approval"],
                "OT Request": ["overtime", "ot request", "extra hours"],
                "Attendance Process": ["attendance", "check-in", "check-out", "timesheet"]
            }
        },
        "Payroll Management": {
            "menus": ["Payment Calculation", "Payment Approve", "Salary Adjustment"],
            "keywords": {
                "Payment Calculation": ["payroll", "calculate salary", "salary calculation", "payment"],
                "Payment Approve": ["approve salary", "payment approval"],
                "Salary Adjustment": ["salary adjustment", "bonus", "deduction"]
            }
        }
    };

    static detectModuleAndMenu(title: string, description: string): { module: string, menu: string, confidence: number, alternatives: string[] } {
        const content = `${title} ${description}`.toLowerCase();
        let bestModule = "Unknown";
        let bestMenu = "Unknown";
        let maxScore = 0;
        const candidates: { module: string; menu: string; score: number }[] = [];

        for (const [module, data] of Object.entries(this.GLOBALHR_KNOWLEDGE)) {
            for (const [menu, keywords] of Object.entries(data.keywords)) {
                const matches = keywords.filter(k => content.includes(k.toLowerCase())).length;
                if (matches > 0) {
                    candidates.push({ module, menu, score: matches });
                }
                if (matches > maxScore) {
                    maxScore = matches;
                    bestModule = module;
                    bestMenu = menu;
                }
            }
        }

        if (maxScore === 0) {
            const words = content.split(/[\s,]+/).filter(w => w.length > 3);
            for (const [module, data] of Object.entries(this.GLOBALHR_KNOWLEDGE)) {
                for (const [menu, keywords] of Object.entries(data.keywords)) {
                    for (const word of words) {
                        for (const keyword of keywords) {
                            const similarity = this.levenshteinSimilarity(word, keyword);
                            if (similarity > 0.7) {
                                candidates.push({ module, menu, score: similarity });
                                if (similarity > maxScore) {
                                    maxScore = similarity;
                                    bestModule = module;
                                    bestMenu = menu;
                                }
                            }
                        }
                    }
                }
            }
        }

        const maxPossible = Math.max(...candidates.map(c => c.score), 1);
        const confidence = maxScore > 0 ? Math.min(maxScore / maxPossible, 1.0) : 0;

        const alternatives = candidates
            .filter(c => !(c.module === bestModule && c.menu === bestMenu))
            .sort((a, b) => b.score - a.score)
            .slice(0, 3)
            .map(c => `${c.module}/${c.menu} (${c.score.toFixed(2)})`);

        if (bestModule === "Unknown") {
            bestModule = "Master";
            bestMenu = "General";
        }

        return { module: bestModule, menu: bestMenu, confidence, alternatives };
    }

    static levenshteinSimilarity(s1: string, s2: string): number {
        const longer = s1.length > s2.length ? s1 : s2;
        const shorter = s1.length > s2.length ? s2 : s1;
        if (longer.length === 0) return 1.0;
        return (longer.length - this.editDistance(longer, shorter)) / longer.length;
    }

    private static editDistance(s1: string, s2: string): number {
        const costs = [];
        for (let i = 0; i <= s1.length; i++) {
            let lastValue = i;
            for (let j = 0; j <= s2.length; j++) {
                if (i === 0) costs[j] = j;
                else if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    }
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
            if (i > 0) costs[s2.length] = lastValue;
        }
        return costs[s2.length];
    }

    static async fetchTicket(jiraId: string): Promise<AIJiraIssue> {
        try {
            const jiraAxiosInstance = getJiraAxios();
            const response = await jiraAxiosInstance.get(`/rest/api/3/issue/${jiraId}`);
            const data = response.data;
            const description = data.fields.description ? this.extractADFText(data.fields.description) : '';
            const comments = data.fields.comment?.comments?.map((c: any) => this.extractADFText(c.body)).join('\n') || '';

            return {
                ticketId: jiraId,
                summary: data.fields.summary,
                description,
                status: data.fields.status.name,
                projectKey: data.fields.project.key,
                comments
            } as any;
        } catch (error: any) {
            throw new Error(`Failed to fetch Jira ticket ${jiraId}: ${error.message}`);
        }
    }

    private static extractADFText(node: any): string {
        if (!node) return '';
        if (typeof node === 'string') return node;
        let text = '';
        if (node.text) text += node.text;
        if (node.content) {
            for (const child of node.content) {
                text += this.extractADFText(child) + ' ';
            }
        }
        return text.trim();
    }

    static async uploadTestEvidence(ticketId: string, resultsPath: string): Promise<string | null> {
        if (!fs.existsSync(resultsPath)) return null;
        try {
            const zipPath = path.join(path.dirname(resultsPath), `${ticketId}_evidence.zip`);
            await this.createEvidenceZip(resultsPath, zipPath);
            const attachmentId = await this.uploadAttachment(ticketId, zipPath);
            return attachmentId;
        } catch (error: any) {
            console.error(`[JiraService] Failed to upload evidence: ${error.message}`);
            return null;
        }
    }

    private static async createEvidenceZip(sourceDir: string, zipFilePath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const output = fs.createWriteStream(zipFilePath);
            const archive = archiver('zip', { zlib: { level: 9 } });
            output.on('close', () => resolve());
            archive.on('error', (err) => reject(err));
            archive.pipe(output);
            archive.directory(sourceDir, false);
            archive.finalize();
        });
    }

    private static async uploadAttachment(ticketId: string, filePath: string): Promise<string> {
        const jiraAxiosInstance = getJiraAxios();
        const fileName = path.basename(filePath);
        const form = new (require('form-data'))();
        form.append('file', fs.createReadStream(filePath), { filename: fileName });

        const response = await jiraAxiosInstance.post(`/rest/api/3/issue/${ticketId}/attachments`, form, {
            headers: {
                ...form.getHeaders(),
                'X-Atlassian-Token': 'no-check'
            }
        });

        return response.data[0].id;
    }

    static async transitionBasedOnResults(ticketId: string, results: TestResult[]): Promise<{ success: boolean; newStatus?: string }> {
        const allPassed = results.every(r => r.status === 'PASS');
        const targetStatus = allPassed ? 'Resolved' : 'In Progress';
        try {
            await this.transitionToStatus(ticketId, targetStatus);
            return { success: true, newStatus: targetStatus };
        } catch (error: any) {
            console.error(`[JiraService] Transition failed: ${error.message}`);
            return { success: false };
        }
    }

    static async transitionToStatus(ticketId: string, statusName: string): Promise<void> {
        const jiraAxiosInstance = getJiraAxios();
        const res = await jiraAxiosInstance.get(`/rest/api/3/issue/${ticketId}/transitions`);
        const transition = res.data.transitions.find((t: any) => t.to.name.toLowerCase() === statusName.toLowerCase());
        if (transition) {
            await jiraAxiosInstance.post(`/rest/api/3/issue/${ticketId}/transitions`, {
                transition: { id: transition.id }
            });
        }
    }

    /**
     * Search Jira tickets using JQL with pagination
     * @param query - Optional text search or partial ticket ID
     * @param startAt - Zero-based index of the first issue to return
     * @param maxResults - Maximum number of issues to return (max 100)
     */
    static async searchTickets(query: string = '', startAt: number = 0, maxResults: number = 50): Promise<{ tickets: any[], total: number }> {
        const jiraAxiosInstance = getJiraAxios();
        
        // Build JQL query
        // 1. Filter by configured project prefixes
        const projects = [config.jira.backlogPrefix, config.jira.testingPrefix, config.jira.developmentPrefix]
            .filter(Boolean)
            .map(p => `project = "${p}"`)
            .join(' OR ');
        
        let jql = `(${projects})`;
        
        // 2. Add text search if provided
        if (query) {
            // Check if query looks like a ticket ID
            if (/^[A-Z]+-\d+$/i.test(query)) {
                jql += ` AND (key = "${query.toUpperCase()}" OR text ~ "${query}*")`;
            } else {
                jql += ` AND (summary ~ "${query}*" OR description ~ "${query}*" OR comment ~ "${query}*")`;
            }
        }
        
        // 3. Order by last updated
        jql += ' ORDER BY updated DESC';

        try {
            const response = await jiraAxiosInstance.post('/rest/api/3/search', {
                jql,
                startAt,
                maxResults,
                fields: ['summary', 'description', 'status', 'priority', 'updated']
            });

            const issues = response.data.issues || [];
            const tickets = issues.map((issue: any) => ({
                id: issue.key,
                summary: issue.fields.summary,
                description: issue.fields.description ? this.extractADFText(issue.fields.description) : '',
                status: issue.fields.status.name,
                priority: issue.fields.priority?.name || 'Medium',
                url: `https://${process.env.JIRA_DOMAIN}/browse/${issue.key}`,
                updatedAt: issue.fields.updated
            }));

            return { tickets, total: response.data.total || 0 };
        } catch (error: any) {
            console.error('[JiraService] Search failed:', error.message);
            return { tickets: [], total: 0 };
        }
    }

    static async postComment(ticketId: string, comment: string): Promise<void> {
        const jiraAxiosInstance = getJiraAxios();
        await jiraAxiosInstance.post(`/rest/api/3/issue/${ticketId}/comment`, {
            body: {
                type: 'doc',
                version: 1,
                content: [{
                    type: 'paragraph',
                    content: [{ type: 'text', text: comment }]
                }]
            }
        });
    }

    /**
     * Parse Jira CSV export content into JSON rows
     */
    static processJiraCsv(content: string): any[] {
        const workbook = XLSX.read(content, { type: 'string' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        return XLSX.utils.sheet_to_json(worksheet);
    }

    /**
     * Parse Jira XLSX/XLS export buffer into JSON rows
     */
    static processJiraXlsx(buffer: Buffer): any[] {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        return XLSX.utils.sheet_to_json(worksheet);
    }
}
