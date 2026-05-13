
import { Pool } from 'pg';
import { ModuleElementSchemaService } from '../src/services/discovery/ModuleElementSchemaService';
import { ModuleStateGraphService } from '../src/services/graph/ModuleStateGraph';
import dotenv from 'dotenv';

dotenv.config();

async function seed() {
    const pool = new Pool({
        user: process.env.PG_USER,
        password: process.env.PG_PASSWORD,
        host: process.env.PG_HOST,
        port: parseInt(process.env.PG_PORT || '5432'),
        database: process.env.PG_DATABASE,
    });

    const moduleId = "ATT";
    const route = "#/app/department";

    console.log(`Seeding mock data for ${moduleId}...`);

    // 1. Mock Schema
    const schema = {
        moduleId,
        capturedAt: new Date(),
        visitedUrl: `http://localhost:4200/${route}`,
        snapshotHash: "mock-hash-123",
        pages: {
            [route]: [
                { label: "Add Department", selector: "button:has-text('Add Department')", type: 'button', visible: true, page: route },
                { label: "Department Name", selector: "input[formcontrolname='name']", type: 'input', visible: true, page: route },
                { label: "Short Code", selector: "input[formcontrolname='shortCode']", type: 'input', visible: true, page: route },
                { label: "Save", selector: "button:has-text('Save')", type: 'button', visible: true, page: route },
                { label: "Cancel", selector: "button:has-text('Cancel')", type: 'button', visible: true, page: route },
                { label: "Department List", selector: ".k-grid", type: 'grid', visible: true, page: route }
            ]
        }
    };

    const schemaSvc = new ModuleElementSchemaService(pool);
    await schemaSvc.save(schema as any);
    console.log("✅ Mock Schema saved.");

    // 2. Mock Graph
    const parentId = "ATT/app-department";
    const modalId = `${parentId}/modal:Add_Department`;
    
    const graph = {
        moduleId,
        capturedAt: new Date(),
        entry: parentId,
        terminals: [parentId],
        dependencies: [],
        states: [
            { id: parentId, route, stateType: 'page', requiredElements: ["Department List"] },
            { id: modalId, route, parentId, stateType: 'modal', requiredElements: ["Add Department"] }
        ],
        transitions: [
            { 
                from: parentId, 
                to: modalId, 
                triggerSelector: "Add Department", 
                waitFor: 'modal_open', 
                cost: 2, 
                transitionType: 'open_modal' 
            },
            { 
                from: modalId, 
                to: parentId, 
                triggerSelector: "Save", 
                waitFor: 'api_response', 
                cost: 2, 
                transitionType: 'submit' 
            },
            { 
                from: modalId, 
                to: parentId, 
                triggerSelector: "Cancel", 
                waitFor: 'toast', 
                cost: 1, 
                transitionType: 'rollback' 
            }
        ]
    };

    await ModuleStateGraphService.save(pool, graph as any);
    console.log("✅ Mock Graph saved.");

    await pool.end();
}

seed().catch(console.error);
