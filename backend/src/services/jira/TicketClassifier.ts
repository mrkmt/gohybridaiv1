/**
 * TicketClassifier
 *
 * Classifies a Jira ticket into structured dimensions used to customize
 * the AI test generation prompt:
 *
 *   platform          — web | mobile | api | mixed
 *   completionStatus  — complete | api_pending | mobile_pending | partial
 *   testingScope      — full | ui_only | regression_only | api_only
 *   ticketSubtype     — new_feature | enhancement | flow_change |
 *                       reproduced_bug | live_bug | testing_discovered_bug
 *
 * Pure function — no DB access, no async.
 *
 * Usage:
 *   const classification = TicketClassifier.classify(context);
 *   // Pass to JsonGenerationOptions.ticketClassification
 */

import {
    JiraTicketContext,
    TicketClassification,
    Platform,
    CompletionStatus,
    TestingScope,
    TicketSubtype,
} from '../../types/jira-context.types';
import { JiraContextBuilder } from './JiraContextBuilder';

export class TicketClassifier {

    static classify(ctx: JiraTicketContext): TicketClassification {
        const platform         = this.classifyPlatform(ctx);
        const completionStatus = this.classifyCompletion(ctx);
        const ticketSubtype    = this.classifySubtype(ctx);
        const testingScope     = this.classifyScope(completionStatus, ticketSubtype);
        const incompleteItems  = this.buildIncompleteItems(ctx);
        const scopeInstructions = this.buildScopeInstructions(
            platform, completionStatus, ticketSubtype, testingScope, incompleteItems,
        );

        return { platform, completionStatus, testingScope, ticketSubtype, incompleteItems, scopeInstructions };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Platform
    // ──────────────────────────────────────────────────────────────────────────

    private static classifyPlatform(ctx: JiraTicketContext): Platform {
        const ownPlatform = JiraContextBuilder.detectPlatform(ctx.labels, ctx.components, ctx.summary);

        if (ownPlatform !== 'web') return ownPlatform;

        // Check linked tickets — mobile linked ticket → mixed
        const hasMobileLinked = ctx.linkedTickets.some(t => t.platform === 'mobile');
        if (hasMobileLinked) return 'mixed';

        return ownPlatform;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Completion status
    // ──────────────────────────────────────────────────────────────────────────

    private static classifyCompletion(ctx: JiraTicketContext): CompletionStatus {
        const incomplete = ctx.linkedTickets.filter(t => !t.isComplete);

        const hasIncompleteApi = incomplete.some(t =>
            t.platform === 'api' || /\bapi\b|\bbackend\b|\brest\b/i.test(t.summary),
        );
        const hasIncompleteMobile = incomplete.some(t =>
            t.platform === 'mobile' || /\bmobile\b|\bandroid\b|\bios\b/i.test(t.summary),
        );

        if (hasIncompleteApi && hasIncompleteMobile) return 'partial';
        if (hasIncompleteApi) return 'api_pending';
        if (hasIncompleteMobile) return 'mobile_pending';
        return 'complete';
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Ticket subtype
    // ──────────────────────────────────────────────────────────────────────────

    private static classifySubtype(ctx: JiraTicketContext): TicketSubtype {
        const isBug     = ctx.issueType.toLowerCase() === 'bug';
        const content   = `${ctx.summary} ${ctx.description}`.toLowerCase();

        if (isBug) {
            if (/\blive\b|\bproduction\b|\bprod\b|\bcustomer report/i.test(content)) return 'live_bug';
            if (/testing discovered|qa found|found in qa|found during test/i.test(content)) return 'testing_discovered_bug';
            // Any bug with explicit repro steps, or fallback
            return 'reproduced_bug';
        }

        // Story / Task / Epic
        if (/\bexisting\b|\bupdate\b|\bchange\b|\bmodify\b|\benhance\b|\bimprove\b|\badd to\b|\bextend\b/i.test(ctx.summary)) {
            if (/\bflow\b|\bprocess\b|\bworkflow\b|\bsequence\b|\bstep\b/i.test(content)) return 'flow_change';
            return 'enhancement';
        }

        return 'new_feature';
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Testing scope
    // ──────────────────────────────────────────────────────────────────────────

    private static classifyScope(
        completion: CompletionStatus,
        subtype: TicketSubtype,
    ): TestingScope {
        if (subtype === 'live_bug') return 'regression_only';  // smoke test only for live bugs
        if (completion === 'api_pending') return 'ui_only';     // skip submit/save flows
        return 'full';
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Incomplete items list
    // ──────────────────────────────────────────────────────────────────────────

    private static buildIncompleteItems(ctx: JiraTicketContext): string[] {
        return ctx.linkedTickets
            .filter(t => !t.isComplete)
            .map(t => `${t.key} [${t.issueType}]: "${t.summary.slice(0, 80)}" — ${t.status}`);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Scope instructions (injected verbatim into AgentOrchestrator prompt)
    // ──────────────────────────────────────────────────────────────────────────

    private static buildScopeInstructions(
        platform: Platform,
        completion: CompletionStatus,
        subtype: TicketSubtype,
        scope: TestingScope,
        incompleteItems: string[],
    ): string {
        const lines: string[] = [];

        // ── Platform ───────────────────────────────────────────────────────────
        switch (platform) {
            case 'mixed':
                lines.push('PLATFORM: Web + Mobile. Generate Web UI tests only. Mobile is out of scope for this pipeline.');
                break;
            case 'mobile':
                lines.push('PLATFORM: Mobile only. Generate basic navigation smoke test — full mobile automation is out of scope.');
                break;
            case 'api':
                lines.push('PLATFORM: API/Backend. Focus on API response validation (status codes, response body assertions) using browser network interception steps.');
                break;
            default:
                break; // web — no extra instruction needed
        }

        // ── Completion / scope restriction ────────────────────────────────────
        switch (completion) {
            case 'api_pending':
                lines.push(
                    'SCOPE RESTRICTION: API development is NOT complete. ' +
                    'Do NOT generate form submission or save/create/update/delete flows. ' +
                    'Test UI navigation and field validation errors ONLY.',
                );
                if (incompleteItems.length > 0) {
                    lines.push(`Pending: ${incompleteItems.slice(0, 3).join(' | ')}`);
                }
                break;

            case 'mobile_pending':
                lines.push('NOTE: Mobile development pending — focus on Web UI tests only. Skip mobile-specific scenarios.');
                break;

            case 'partial':
                lines.push(
                    'NOTE: Some development tickets are still incomplete. ' +
                    'Test visible UI elements only; skip submission flows that require incomplete backend.',
                );
                if (incompleteItems.length > 0) {
                    lines.push(`Pending: ${incompleteItems.slice(0, 3).join(' | ')}`);
                }
                break;

            default:
                break; // complete — no restriction
        }

        // ── Ticket subtype instructions ───────────────────────────────────────
        switch (subtype) {
            case 'new_feature':
                lines.push(
                    'TICKET TYPE: New Feature. ' +
                    'Generate full CRUD scenarios: Create (happy path), Create (validation errors), ' +
                    'Read/List, Update, Delete. At least one assertion per scenario.',
                );
                break;

            case 'enhancement':
                lines.push(
                    'TICKET TYPE: Enhancement to existing feature. ' +
                    'Include one regression scenario verifying the existing behaviour still works, ' +
                    'then add scenarios for the new addition.',
                );
                break;

            case 'flow_change':
                lines.push(
                    'TICKET TYPE: Flow Change. ' +
                    'Test that the old flow steps are replaced correctly. ' +
                    'Verify no data loss between the changed steps. Include a before/after comparison assertion.',
                );
                break;

            case 'reproduced_bug':
                lines.push(
                    'TICKET TYPE: Reproduced Bug. ' +
                    'First scenario MUST reproduce the exact bug steps ending with the observed failure assertion. ' +
                    'Second scenario verifies the fix (same steps, now expect success). ' +
                    'Third scenario: regression check of adjacent functionality.',
                );
                break;

            case 'live_bug':
                lines.push(
                    'TICKET TYPE: Live Customer Bug — SMOKE TEST ONLY. ' +
                    'Generate minimal steps to verify the fix without disturbing production-like data. ' +
                    'Maximum 2 scenarios, 5 steps each. No destructive operations.',
                );
                break;

            case 'testing_discovered_bug':
                lines.push(
                    'TICKET TYPE: Testing-Discovered Bug. ' +
                    'Reproduce the exact testing steps that surfaced the bug. ' +
                    'Add a verification scenario that the fix is in place. ' +
                    'Reference any testing ticket context in the preconditions.',
                );
                break;
        }

        return lines.join('\n');
    }
}
