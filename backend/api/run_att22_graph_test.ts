
import { TestingExecutionOrchestrator } from '../src/services/execution/TestingExecutionOrchestrator';
import { ModuleStateGraphService } from '../src/services/graph/ModuleStateGraph';
import { JsonTestGenerationService } from '../src/services/generation/JsonTestGenerationService';
import { Pool } from 'pg';
import { appLogger } from '../src/utils/logger';
import dotenv from 'dotenv';

dotenv.config();

async function runGraphVerification() {
    console.log("🚀 Starting Phase 3: Graph-Constrained Generation Test (ATT-22)");
    
    const pool = new Pool({
        user: process.env.PG_USER,
        password: process.env.PG_PASSWORD,
        host: process.env.PG_HOST,
        port: parseInt(process.env.PG_PORT || '5432'),
        database: process.env.PG_DATABASE,
    });

    const ticketId = "ATT-22";
    const moduleId = "ATT";

    try {
        // 1. Check if graph exists for ATT
        let graph = await ModuleStateGraphService.load(pool, moduleId);
        
        if (!graph) {
            console.log(`⚠️ No state graph found for module "${moduleId}".`);
            console.log("Running McpDiscoveryService.discover to seed data...");
            
            const { McpDiscoveryService } = require('../src/services/mcp/McpDiscoveryService');
            await McpDiscoveryService.discover({
                module: "Department",
                baseUrl: process.env.BASE_URL || "http://localhost:4200",
                credentials: {
                    username: process.env.TEST_USERNAME || "admin",
                    password: process.env.TEST_PASSWORD || "admin",
                    idNumber: process.env.TEST_IDNUMBER || "test"
                }
            }, pool);

            // Wait a bit for fire-and-forget save
            await new Promise(r => setTimeout(r, 2000));
            
            graph = await ModuleStateGraphService.load(pool, moduleId);
            if (!graph) {
                // Try fallback module name
                graph = await ModuleStateGraphService.load(pool, "DEPARTMENT");
            }

            if (!graph) {
                throw new Error("Critical: Discovery ran but no graph was saved to DB.");
            }
            console.log("✅ Graph seeded and loaded successfully.");
        } else {
            console.log("✅ State graph found.");
        }

        // 2. Generate test cases with graph paths
        console.log("\n--- Step 2: Generating Graph-Constrained Test Cases ---");
        
        // This will call generateAndCompile which now uses the graph
        const result = await JsonTestGenerationService.generateAndCompile({
            ticketId,
            module: moduleId, // Correct property name
            summary: "Test Bug: Department Short Code validation missing",
            description: "When creating a new Department, the Short Code field accepts more than 5 characters.",
            acceptanceCriteria: ["Verify validation error when Short Code exceeds 5 characters"],
            baseUrl: "http://localhost:4200",
            enableLiveDiscovery: false,
            pool
        });

        console.log("✅ Generation complete.");
        console.log(`- Compiled Script Path: ${result.scriptPath}`); // Correct property name
        
        // 3. Verify coverage metric
        const coverage = graph ? ModuleStateGraphService.coverageRatio(graph, new Set()) : 0;
        console.log(`\n--- Coverage Metric ---`);
        console.log(`Graph Coverage: ${(coverage * 100).toFixed(1)}%`);

    } catch (err: any) {
        console.error("❌ Test Failed:", err.message);
        if (err.stack) console.error(err.stack);
    } finally {
        await pool.end();
    }
}

runGraphVerification().catch(console.error);
