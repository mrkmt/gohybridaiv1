/**
 * Network Log Capture for Playwright
 * 
 * Captures all network requests/responses during test execution
 * Similar to the extension's chrome.debugger approach
 */

import { Page, BrowserContext } from '@playwright/test';

export interface NetworkLogEntry {
    requestId: string;
    timestamp: number;
    url: string;
    method: string;
    status?: number;
    statusText?: string;
    requestHeaders?: Record<string, string>;
    responseHeaders?: Record<string, string>;
    requestBody?: string;
    responseBody?: string;
    resourceType: string;
    duration?: number;
    error?: string;
}

export interface NetworkCaptureResult {
    requests: NetworkLogEntry[];
    apiCalls: NetworkLogEntry[];  // Only XHR/Fetch
    failed: NetworkLogEntry[];
    startTime: number;
    endTime: number;
}

/**
 * Setup network capture for a page
 * Call this before navigation
 */
export function setupNetworkCapture(page: Page): () => NetworkCaptureResult {
    const networkLogs: NetworkLogEntry[] = [];
    const startTime = Date.now();
    
    // Track pending requests
    const pendingRequests = new Map<string, NetworkLogEntry & { startMs: number }>();
    
    // Listen for all requests
    page.on('request', request => {
        const requestId = request.url() + Date.now().toString() + Math.random().toString();
        
        const entry: NetworkLogEntry & { startMs: number } = {
            requestId,
            timestamp: Date.now(),
            url: request.url(),
            method: request.method(),
            requestHeaders: request.headers(),
            resourceType: request.resourceType(),
            startMs: Date.now()
        };
        
        pendingRequests.set(requestId, entry);
    });
    
    // Listen for responses
    page.on('response', response => {
        const request = response.request();
        const url = request.url();
        
        // Find matching pending request
        for (const [id, entry] of pendingRequests.entries()) {
            if (entry.url === url && entry.method === request.method()) {
                const duration = Date.now() - entry.startMs;
                
                entry.status = response.status();
                entry.statusText = response.statusText();
                entry.responseHeaders = response.headers();
                entry.duration = duration;
                
                // Try to get response body (only for text/JSON)
                const contentType = response.headers()['content-type'] || '';
                if (contentType.includes('application/json') || contentType.includes('text')) {
                    response.text().then(text => {
                        entry.responseBody = text.substring(0, 10000); // Limit to 10KB
                    }).catch(() => {});
                }
                
                networkLogs.push(entry);
                pendingRequests.delete(id);
                break;
            }
        }
    });
    
    // Listen for failed requests
    page.on('requestfailed', request => {
        const url = request.url();
        
        for (const [id, entry] of pendingRequests.entries()) {
            if (entry.url === url && entry.method === request.method()) {
                entry.error = request.failure()?.errorText || 'Unknown error';
                entry.duration = Date.now() - entry.startMs;
                
                networkLogs.push(entry);
                pendingRequests.delete(id);
                break;
            }
        }
    });
    
    // Return function to get captured logs
    return () => {
        const endTime = Date.now();
        
        // Add any remaining pending requests
        for (const entry of pendingRequests.values()) {
            entry.error = 'Request did not complete';
            entry.duration = endTime - entry.startMs;
            networkLogs.push(entry);
        }
        
        const result: NetworkCaptureResult = {
            requests: networkLogs,
            apiCalls: networkLogs.filter(log => 
                log.resourceType === 'xhr' || 
                log.resourceType === 'fetch' ||
                log.url.includes('/api/')
            ),
            failed: networkLogs.filter(log => log.error || (log.status && log.status >= 400)),
            startTime,
            endTime
        };
        
        return result;
    };
}

/**
 * Get network logs captured so far
 */
export function getNetworkLogs(getLogs: () => NetworkCaptureResult): NetworkCaptureResult {
    return getLogs();
}

/**
 * Print network logs in readable format
 */
export function printNetworkLogs(result: NetworkCaptureResult, options: { showApiOnly?: boolean } = {}): void {
    console.log('\n' + '='.repeat(70));
    console.log('NETWORK LOGS');
    console.log('='.repeat(70));
    console.log(`Capture Duration: ${result.endTime - result.startTime}ms`);
    console.log(`Total Requests: ${result.requests.length}`);
    console.log(`API Calls: ${result.apiCalls.length}`);
    console.log(`Failed: ${result.failed.length}`);
    
    if (options.showApiOnly) {
        console.log('\n📡 API CALLS:');
        result.apiCalls.forEach((log, i) => {
            const status = log.status ? (log.status < 400 ? '✓' : '✗') : '⏳';
            const duration = log.duration ? `${log.duration}ms` : '-';
            console.log(`  ${i + 1}. ${status} ${log.method} ${truncateUrl(log.url)}`);
            console.log(`     Status: ${log.status || 'Pending'} | Duration: ${duration}`);
            
            // Show response preview for JSON
            if (log.responseBody?.startsWith('{')) {
                try {
                    const preview = JSON.stringify(JSON.parse(log.responseBody)).substring(0, 200);
                    console.log(`     Response: ${preview}...`);
                } catch {
                    console.log(`     Response: ${log.responseBody?.substring(0, 100)}...`);
                }
            }
        });
    }
    
    if (result.failed.length > 0) {
        console.log('\n❌ FAILED REQUESTS:');
        result.failed.forEach((log, i) => {
            console.log(`  ${i + 1}. ${log.method} ${truncateUrl(log.url)}`);
            console.log(`     Error: ${log.error || `HTTP ${log.status}`}`);
        });
    }
    
    console.log('\n' + '='.repeat(70) + '\n');
}

/**
 * Find specific API call in network logs
 */
export function findApiCall(result: NetworkCaptureResult, urlPattern: string | RegExp): NetworkLogEntry | undefined {
    return result.apiCalls.find(log => {
        if (typeof urlPattern === 'string') {
            return log.url.includes(urlPattern);
        }
        return urlPattern.test(log.url);
    });
}

/**
 * Extract data from API response
 */
export function extractFromResponse(log: NetworkLogEntry | undefined, jsonPath: string): any {
    if (!log?.responseBody) return undefined;
    
    try {
        const data = JSON.parse(log.responseBody);
        
        // Simple JSON path support (e.g., "data.items", "menu[0].name")
        return jsonPath.split('.').reduce((obj, key) => {
            if (obj === undefined) return undefined;
            
            // Handle array index
            const arrayMatch = key.match(/^(\w+)\[(\d+)\]$/);
            if (arrayMatch) {
                const [, arrKey, index] = arrayMatch;
                return obj[arrKey]?.[parseInt(index)];
            }
            
            return obj[key];
        }, data as any);
    } catch {
        return undefined;
    }
}

function truncateUrl(url: string, maxLength = 60): string {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength - 3) + '...';
}
