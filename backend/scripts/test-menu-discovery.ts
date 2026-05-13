/**
 * Test script: Menu Discovery Flow
 * 
 * Tests:
 * 1. Login to get auth token
 * 2. Call GetUserLevelMenuData API
 * 3. Match draft modules against real menu structure
 * 4. Store confirmed navigation paths
 */

import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { MenuDiscoveryService } from '../src/services/MenuDiscoveryService';
import { ModuleRegistry } from '../src/services/ModuleRegistry';

async function loginAndGetToken(): Promise<string> {
    const baseUrl = process.env.BASE_URL || 'https://test.globalhr.com.mm/ook';
    const apiUrl = baseUrl.replace(/\/+$/, '') + '/v2_2api/api/Account/Login';

    console.log('[Test] Logging in to get auth token...');

    const response = await axios.post(apiUrl, {
        UserName: process.env.TEST_USERNAME || 'testook_HR 1',
        Password: process.env.TEST_PASSWORD || 'Global@2024',
        CustomerID: process.env.CUSTOMER_ID || 'ook',
    });

    const token = response.data?.Token || response.data?.token || response.data?.data?.Token;
    if (!token) {
        throw new Error('No token in login response: ' + JSON.stringify(response.data).substring(0, 200));
    }

    console.log('[Test] Login successful, token received');
    return token;
}

async function main() {
    console.log('\n========== Menu Discovery Test ==========\n');

    // Step 1: Clear previous data
    ModuleRegistry.clearCache();
    MenuDiscoveryService.clearCache();

    // Step 2: Login
    const token = await loginAndGetToken();
    const baseUrl = process.env.BASE_URL || 'https://test.globalhr.com.mm/ook';

    // Step 3: Discover menus and match drafts
    const result = await MenuDiscoveryService.discoverAndMatch(baseUrl, token);

    console.log('\n========== Discovery Results ==========\n');
    console.log('Total menus fetched:', result.totalMenus);
    console.log('Matched modules:', result.matchedModules);

    if (result.confirmedPaths.length > 0) {
        console.log('\nConfirmed Paths:');
        for (const path of result.confirmedPaths) {
            console.log(`  Ticket: ${path.ticketId}`);
            console.log(`  Module: ${path.moduleName}`);
            console.log(`  Menu: ${path.menuName}`);
            console.log(`  Parent: ${path.parentMenu}`);
            console.log(`  Navigation: ${path.fullNavigationPath}`);
            console.log(`  URL: ${path.url}`);
            console.log('');
        }
    } else {
        console.log('\nNo modules matched — checking drafts...');
        const drafts = ModuleRegistry.getAllDrafts();
        console.log('Draft modules waiting:', drafts.length);
        for (const d of drafts) {
            console.log(`  - ${d.ticketId}: ${d.moduleName}`);
        }
    }

    console.log('\n========== Test Complete ==========\n');
}

main().catch(err => {
    console.error('[Test] Error:', err.message);
    process.exit(1);
});
