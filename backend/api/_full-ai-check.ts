import { MultiAgentRouter } from './MultiAgentRouter';
import { config } from './config';
const { Pool } = require('pg');

async function checkAllProfiles() {
    console.log("🔍 DETAILED AI PROFILE HEALTH CHECK\n");
    const routerConfig = MultiAgentRouter.getConfig();
    const pool = new Pool(config.postgres);
    
    for (const profile of routerConfig.profiles) {
        console.log(`--- Checking Profile: ${profile.name} [${profile.model}] ---`);
        try {
            // Test each profile individually
            const result = await MultiAgentRouter.routeWithProfile(profile.name, "Return exactly the word 'READY'", false);
            if (result && result.response.includes('READY')) {
                console.log(`✅ WORKING: ${profile.name} responded correctly.`);
                console.log(`   Model: ${result.model}`);
            } else {
                console.log(`⚠️ PARTIAL: ${profile.name} responded but content was unexpected: "${result?.response.trim()}"`);
            }
        } catch (err: any) {
            console.log(`❌ FAILED: ${profile.name} is down.`);
            console.log(`   Error: ${err.message}`);
        }
        console.log("");
    }
    
    await pool.end();
    console.log("🏁 Health check complete.");
}

checkAllProfiles().catch(console.error);
