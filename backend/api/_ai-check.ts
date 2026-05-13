import { config } from './config';
import { MultiAgentRouter } from './MultiAgentRouter';
import axios from 'axios';
const { Pool } = require('pg');

async function runAiCheck() {
    console.log("=== 🧠 AI & BRAIN CONNECTIVITY CHECK ===");
    
    // Check OpenRouter
    console.log("\n1. Checking OpenRouter Config...");
    const aiConfig = MultiAgentRouter.getConfig();
    console.log("   - Base URL:", config.ai.openRouterBaseUrl);
    console.log("   - Default Model:", config.ai.defaultModel);
    console.log("   - API Key length:", process.env.OPENROUTER_API_KEY?.length || 0);
    
    if (process.env.OPENROUTER_API_KEY) {
        try {
            console.log("\n2. Pinging OpenRouter Models API (Connectivity Test)...");
            const res = await axios.get(`${config.ai.openRouterBaseUrl}/models`, {
                headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY.split(',')[0]}`, 'HTTP-Referer': 'http://localhost:3000' },
                timeout: 5000
            });
            console.log(`   ✅ Success! Status: ${res.status}. Found ${res.data?.data?.length || 0} models.`);
            
        } catch (e: any) {
            console.log(`   ❌ Failed to ping OpenRouter: ${e.message}`);
            if (e.response) {
               console.log(`      Status: ${e.response.status}, Data: ${JSON.stringify(e.response.data)}`);
            }
        }
    } else {
        console.log("   ⚠️ No OPENROUTER_API_KEY found in environment.");
    }
    
    // Optional: test a simple completion if requested
    console.log("\n3. Testing Agent Router System...");
    try {
        const pool = new Pool(config.postgres);
        await pool.connect();
        
        // This validates if the router itself is compiling and instantiable
        const result = await MultiAgentRouter.route('ASSISTANT', 'Return the word OK', false);
        console.log(`   ✅ MultiAgentRouter executed successfully. Result: ${result.response.trim()}`);
        console.log(`   - Model Used: ${result.model}`);
        await pool.end();
    } catch(e:any) {
         console.log(`   ❌ MultiAgentRouter test failed: ${e.message}`);
    }
    
    console.log("\n=== DONE ===");
}

runAiCheck();
