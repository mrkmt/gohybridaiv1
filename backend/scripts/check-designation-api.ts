/**
 * Check Designation API
 * 
 * Fetches all designations and checks for test records
 * 
 * Run: npx ts-node backend/scripts/check-designation-api.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import fetch from 'node-fetch';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function checkDesignations() {
    const baseUrl = 'https://apitest.globalhr.com.mm/v2_2api';
    
    console.log('\n' + '='.repeat(70));
    console.log('🔍 CHECKING DESIGNATION API');
    console.log('='.repeat(70));
    console.log(`API URL: ${baseUrl}/api/designation/GetMoreDesignations\n`);
    
    try {
        const response = await fetch(`${baseUrl}/api/designation/GetMoreDesignations`);
        
        console.log(`Status: ${response.status} ${response.statusText}`);
        
        const data: any = await response.json();
        
        // Extract designations array
        const designations = data.data || data.result || data;
        
        console.log(`\n📊 Total Designations: ${Array.isArray(designations) ? designations.length : 'N/A'}`);
        
        if (Array.isArray(designations)) {
            // Show structure of first item
            console.log('\n📋 Sample Designation Structure:');
            console.log(JSON.stringify(designations[0], null, 2));
            
            // Look for test designations
            console.log('\n🔍 Searching for test designations (Design_*, Diagnose_*, Test_*):');
            
            const testPatterns = [/Design_\d+/, /Diagnose_\d+/, /Test_\d+/, /Auto_\d+/];
            const foundTests: any[] = [];
            
            for (const designation of designations) {
                const name = designation.designation_name || designation.name || designation.title || '';
                
                for (const pattern of testPatterns) {
                    if (pattern.test(name)) {
                        foundTests.push({
                            name,
                            order: designation.designation_order || designation.order,
                            id: designation.id || designation.designation_id,
                            status: designation.status || designation.is_active
                        });
                        break;
                    }
                }
            }
            
            if (foundTests.length > 0) {
                console.log(`\n✅ Found ${foundTests.length} test designations:`);
                foundTests.slice(0, 10).forEach((t, i) => {
                    console.log(`  ${i+1}. ${t.name} (Order: ${t.order}, ID: ${t.id})`);
                });
                
                if (foundTests.length > 10) {
                    console.log(`  ... and ${foundTests.length - 10} more`);
                }
            } else {
                console.log('\n❌ No test designations found');
            }
            
            // Show first 10 designations
            console.log('\n📋 First 10 Designations:');
            designations.slice(0, 10).forEach((d: any, i: number) => {
                const name = d.designation_name || d.name || d.title || 'N/A';
                const order = d.designation_order || d.order || 'N/A';
                const id = d.id || d.designation_id || 'N/A';
                console.log(`  ${i+1}. [${order}] ${name} (ID: ${id})`);
            });
        }
        
        // Check for specific recent test name
        console.log('\n' + '='.repeat(70));
        console.log('🔍 CHECKING FOR RECENT TEST RECORDS');
        console.log('='.repeat(70));
        
        // Look for Design_1774862133990 pattern
        const testNamesToCheck = [
            'Design_1774862133990',
            'Design_1774936177833',
            'Design_1774936308419',
            'Diagnose_1774935554032',
            'Diagnose_1774935704308'
        ];
        
        console.log('\nChecking for specific test names:');
        for (const testName of testNamesToCheck) {
            const found = designations.find((d: any) => {
                const name = d.designation_name || d.name || d.title || '';
                return name.includes(testName);
            });
            
            console.log(`  ${found ? '✅' : '❌'} ${testName}: ${found ? 'FOUND' : 'NOT FOUND'}`);
        }
        
    } catch (error: any) {
        console.error('\n❌ ERROR:', error.message);
        if (error.stack) {
            console.error('Stack:', error.stack);
        }
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('✓ Check complete');
    console.log('='.repeat(70) + '\n');
}

checkDesignations();
