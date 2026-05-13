/**
 * Full Flow Test: ATT-15
 * 
 * Tests the complete module extraction → menu discovery → test generation flow.
 * 
 * 1. Orchestration → extract module from dev tickets → store draft
 * 2. Menu discovery → call GetUserLevelMenuData API → match draft → confirm
 * 3. Test generation → use concise prompt + confirmed navigation paths
 * 4. Verify output
 */

import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { JiraTicketOrchestrator } from '../src/services/JiraTicketOrchestrator';
import { ModuleRegistry } from '../src/services/ModuleRegistry';
import { MenuDiscoveryService } from '../src/services/MenuDiscoveryService';
import { JsonTestGenerationService } from '../src/services/JsonTestGenerationService';

async function loginAndGetAuthHeaders(): Promise<Record<string, string>> {
    const baseUrl = process.env.BASE_URL || 'https://test.globalhr.com.mm/ook';

    console.log('[Step 0] Attempting menu API access...');
    console.log('[Step 0] Note: GlobalHR requires browser-based login for session cookies.');
    console.log('[Step 0] Menu discovery will use cached data if available, or skip for now.');

    // The GlobalHR login requires a browser session — direct API returns 405.
    // Menu discovery works when called from the actual web app (with browser cookies).
    // For CLI testing, we check cache first and skip if no session available.
    return {};
}

async function main() {
    console.log('\n' + '='.repeat(60));
    console.log('  Full Flow Test: ATT-15');
    console.log('='.repeat(60) + '\n');

    // Clean previous data
    ModuleRegistry.clearCache();
    MenuDiscoveryService.clearCache();

    // ── STEP 1: Orchestration ──────────────────────────────────
    console.log('\n── STEP 1: Orchestration (Extract Module from Dev Tickets) --\n');

    const orchResult = await JiraTicketOrchestrator.orchestrate('ATT-15');

    console.log('Main Ticket:', orchResult.mainTicket?.key, `(${orchResult.mainTicket?.issueType})`);
    console.log('Summary:', orchResult.mainTicket?.summary);
    console.log('Linked:', orchResult.linkedTickets.map(t => t.key).join(', '));

    // Check draft module
    const draft = ModuleRegistry.resolve('ATT-15');
    if (draft) {
        console.log('\nDraft Module Extracted:');
        console.log('  Name:', draft.moduleName);
        console.log('  Menu:', draft.menuName || 'N/A');
        console.log('  API Route:', draft.apiRoute || 'N/A');
        console.log('  Confirmed:', draft.confirmed ? '✅ Yes' : '❌ No (draft)');
    } else {
        console.log('\n⚠️ No draft module stored');
    }

    // ── STEP 2: Menu Discovery ─────────────────────────────────
    console.log('\n── STEP 2: Menu Discovery (Confirm Navigation Paths) --\n');

    const authHeaders = await loginAndGetAuthHeaders();
    const baseUrl = process.env.BASE_URL || 'https://test.globalhr.com.mm/ook';

    if (Object.keys(authHeaders).length > 0) {
        try {
            const menuResult = await MenuDiscoveryService.discoverWithAuthHeaders(baseUrl, authHeaders);

            console.log('Total Menus:', menuResult.totalMenus);
            console.log('Matched Modules:', menuResult.matchedModules);

            if (menuResult.confirmedPaths.length > 0) {
                console.log('\nConfirmed Paths:');
                for (const path of menuResult.confirmedPaths) {
                    console.log(`  Ticket: ${path.ticketId}`);
                    console.log(`  Module: ${path.moduleName}`);
                    console.log(`  Menu: ${path.menuName}`);
                    console.log(`  Navigation: ${path.fullNavigationPath}`);
                    console.log(`  URL: ${path.url}`);
                    console.log(`  Status: ✅ CONFIRMED`);
                }
            } else {
                console.log('\n⚠️ No modules matched menu items');
                console.log('  Checking menu items for "Performance"...');

                // Show what menus were fetched
                const cache = MenuDiscoveryService['loadCache']();
                if (cache) {
                    const perfMenus = cache.filter(m =>
                        m.menuName.toLowerCase().includes('performance') ||
                        m.menuName.toLowerCase().includes('journal')
                    );
                    if (perfMenus.length > 0) {
                        console.log('  Found matching menus:');
                        perfMenus.forEach(m => {
                            console.log(`    - ${m.menuName} (parent: ${m.parentMenu}, route: ${m.route || m.url || 'N/A'})`);
                        });
                    } else {
                        console.log('  No menus contain "performance" or "journal"');
                        console.log('  First 5 menu items:');
                        cache.slice(0, 5).forEach(m => {
                            console.log(`    - ${m.menuName} (parent: ${m.parentMenu})`);
                        });
                    }
                }
            }
        } catch (menuError: any) {
            console.warn('⚠️ Menu discovery failed:', menuError.message);
            console.warn('  Will proceed with draft module only');
        }
    } else {
        console.log('⚠️ No auth headers available - skipping menu discovery');
        console.log('  Will proceed with draft module only');
    }

    // Check confirmed status after discovery
    const afterDiscovery = ModuleRegistry.resolve('ATT-15');
    if (afterDiscovery) {
        console.log('\nModule Status After Discovery:');
        console.log('  Name:', afterDiscovery.moduleName);
        console.log('  Navigation:', afterDiscovery.fullNavigationPath || afterDiscovery.menuName || 'N/A');
        console.log('  URL:', afterDiscovery.uiRoute || 'N/A');
        console.log('  Confirmed:', afterDiscovery.confirmed ? '✅ Yes' : '❌ No (draft)');
        console.log('  Source:', afterDiscovery.source);
    }

    // ── STEP 3: Test Generation ────────────────────────────────
    console.log('\n── STEP 3: Test Generation (Concise Prompt + Confirmed Paths) --\n');

    // Build generation options using the resolved module info
    const moduleInfo = afterDiscovery || draft;
    const rawIssueType = orchResult.mainTicket?.issueType;
    const genOptions = {
        ticketId: 'ATT-15',
        summary: orchResult.mainTicket?.summary || 'Unknown',
        description: orchResult.mainTicket?.description?.substring(0, 500) || '',
        module: moduleInfo?.moduleName || 'Unknown',
        baseUrl: baseUrl,
        issueType: (rawIssueType === 'Bug' || rawIssueType === 'Story' ? rawIssueType : undefined) as 'Bug' | 'Story' | undefined,
        maxRetries: 1,
    };

    console.log('Generation Options:');
    console.log('  Ticket:', genOptions.ticketId);
    console.log('  Module:', genOptions.module);
    console.log('  Issue Type:', genOptions.issueType);

    const genResult = await JsonTestGenerationService.generateTestSpecification(genOptions);

    console.log('\nGeneration Result:');
    console.log('  Success:', genResult.success);
    if (genResult.specification) {
        console.log('  Scenarios:', genResult.specification.scenarios?.length || 0);
        if (genResult.specification.scenarios?.length > 0) {
            console.log('  First Scenario:');
            const sc = genResult.specification.scenarios[0];
            console.log(`    ID: ${sc.id}`);
            console.log(`    Name: ${sc.name}`);
            console.log(`    Steps: ${sc.steps?.length || 0}`);
            if (sc.steps?.length > 0) {
                const gotoStep = sc.steps.find(s => s.type === 'goto');
                if (gotoStep) {
                    console.log(`    Navigate to: ${gotoStep.url}`);
                }
            }
        }
    }
    if (!genResult.success && genResult.errors) {
        console.log('  Errors:', genResult.errors);
    }

    // ── SUMMARY ────────────────────────────────────────────────
    console.log('\n' + '='.repeat(60));
    console.log('  SUMMARY');
    console.log('='.repeat(60));
    console.log('1. Module Extraction:', draft ? '✅ Done' : '❌ Failed');
    if (draft) {
        console.log('   Module:', draft.moduleName);
    }
    console.log('2. Menu Discovery:', afterDiscovery?.confirmed ? '✅ Confirmed' : '⚠️ Draft only');
    if (afterDiscovery?.confirmed) {
        console.log('   Navigation:', afterDiscovery.fullNavigationPath);
        console.log('   URL:', afterDiscovery.uiRoute);
    }
    console.log('3. Test Generation:', genResult.success ? '✅ Generated' : '❌ Failed');
    if (genResult.specification) {
        console.log('   Scenarios:', genResult.specification.scenarios?.length || 0);
    }
    console.log('='.repeat(60) + '\n');
}

main().catch(err => {
    console.error('\n❌ Test failed:', err.message);
    console.error(err.stack);
    process.exit(1);
});
