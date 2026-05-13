import { Request, Response } from 'express';
import { getJiraAxios } from '../utils/jiraAxios';
import { appLogger } from '../utils/logger';

export interface JiraSearchResult {
    key: string;
    summary: string;
    description: string;
    status: string;
    priority: string;
    issueType: string;
    created: string;
    updated: string;
}

export class JiraSearchController {
    /**
     * Search Jira issues via JQL
     * GET /api/jira/search?jql=PROJECT=ATT&maxResults=50
     */
    static async search(req: Request, res: Response) {
        try {
            const { jql, maxResults = 50 } = req.query;
            
            if (!jql) {
                return res.status(400).json({ 
                    error: 'JQL query required', 
                    example: 'project=ATT AND status="In Testing"' 
                });
            }

            const jiraAxios = getJiraAxios();
            // Migrate to /rest/api/3/search/jql as per Atlassian update
            const response = await jiraAxios.get('/rest/api/3/search/jql', {
                params: {
                    jql: jql,
                    maxResults: parseInt(maxResults as string, 10) || 50,
                    // Fetching all relevant fields, including potentially custom AI fields
                    fields: 'key,summary,description,status,priority,issuetype,created,updated,comment'
                }
            });

            const issues = response.data.issues.map((issue: any): JiraSearchResult => ({
                key: issue.key,
                summary: issue.fields.summary || '',
                description: issue.fields.description || '',
                status: issue.fields.status?.name || 'Unknown',
                priority: issue.fields.priority?.name || 'Medium',
                issueType: issue.fields.issuetype?.name || 'Unknown',
                created: issue.fields.created || '',
                updated: issue.fields.updated || ''
            }));

            res.json({
                total: response.data.total,
                issues
            });
        } catch (error: any) {
            appLogger.error('[JiraSearch] Search failed', { error: error.message });
            const status = error.response?.status || 500;
            const message = error.response?.data?.errorMessages?.[0] || error.message;
            res.status(status).json({ error: 'Jira search failed', details: message });
        }
    }

    /**
     * Get issues from a specific project
     * GET /api/jira/project/ATT
     */
    static async getProjectIssues(req: Request, res: Response) {
        try {
            const { projectKey } = req.params;
            const { maxResults = 50 } = req.query;

            if (!projectKey) {
                return res.status(400).json({ error: 'Project key required' });
            }

            const jiraAxios = getJiraAxios();
            const response = await jiraAxios.get('/rest/api/3/search/jql', {
                params: {
                    jql: `project=${projectKey} ORDER BY updated DESC`,
                    maxResults: parseInt(maxResults as string, 10) || 50,
                    fields: 'key,summary,description,status,priority,issuetype,created,updated'
                }
            });

            const issues = response.data.issues.map((issue: any): JiraSearchResult => ({
                key: issue.key,
                summary: issue.fields.summary || '',
                description: issue.fields.description || '',
                status: issue.fields.status?.name || 'Unknown',
                priority: issue.fields.priority?.name || 'Medium',
                issueType: issue.fields.issuetype?.name || 'Unknown',
                created: issue.fields.created || '',
                updated: issue.fields.updated || ''
            }));

            res.json({
                project: projectKey,
                total: response.data.total,
                issues
            });
        } catch (error: any) {
            appLogger.error('[JiraSearch] Project search failed', { error: error.message });
            const status = error.response?.status || 500;
            const message = error.response?.data?.errorMessages?.[0] || error.message;
            res.status(status).json({ error: 'Failed to fetch project issues', details: message });
        }
    }

    /**
     * Get a single ticket by ID
     * GET /api/jira/ticket/ATT-123
     */
    static async getTicket(req: Request, res: Response) {
        try {
            const { ticketId } = req.params;

            const jiraAxios = getJiraAxios();
            const response = await jiraAxios.get(`/rest/api/3/issue/${ticketId}`);
            const issue = response.data;

            res.json({
                key: issue.key,
                summary: issue.fields.summary || '',
                description: issue.fields.description,
                status: issue.fields.status?.name || 'Unknown',
                priority: issue.fields.priority?.name || 'Medium',
                issueType: issue.fields.issuetype?.name || 'Unknown',
                project: issue.fields.project?.key || '',
                created: issue.fields.created || '',
                updated: issue.fields.updated || '',
                comments: issue.fields.comment?.comments?.map((c: any) => ({
                    author: c.author?.displayName || 'Unknown',
                    body: c.body,
                    created: c.created
                })) || []
            });
        } catch (error: any) {
            appLogger.error('[JiraSearch] Get ticket failed', { error: error.message });
            const status = error.response?.status || 500;
            const message = error.response?.data?.errorMessages?.[0] || error.message;
            res.status(status).json({ error: 'Failed to fetch ticket', details: message });
        }
    }

    /**
     * Get available projects
     * GET /api/jira/projects
     */
    static async getProjects(req: Request, res: Response) {
        try {
            const jiraAxios = getJiraAxios();
            const response = await jiraAxios.get('/rest/api/3/project');

            const projects = response.data.map((p: any) => ({
                key: p.key,
                name: p.name,
                type: p.projectTypeKey,
                avatarUrl: p.avatarUrls?.['48x48'] || ''
            }));

            res.json({ projects });
        } catch (error: any) {
            appLogger.error('[JiraSearch] Get projects failed', { error: error.message });
            const status = error.response?.status || 500;
            const message = error.response?.data?.errorMessages?.[0] || error.message;
            res.status(status).json({ error: 'Failed to fetch projects', details: message });
        }
    }
}
