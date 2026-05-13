import { ModuleRegistry } from '../src/services/shared/ModuleRegistry';
import { JiraService } from './JiraService';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function demoClassification() {
    console.log('🧪 [DEMO] AI-Driven Module Classification\n');

    // 1. Manually add some modules to the registry to simulate a learned system
    console.log('Step 1: Registering modules in ModuleRegistry...');
    
    // Confirmed modules (learned from successful discovery)
    ModuleRegistry.confirmModule('MOCK-1', {
        moduleName: 'Department',
        menuName: 'Master > Department',
        uiRoute: '/#/app.department'
    });

    ModuleRegistry.confirmModule('MOCK-2', {
        moduleName: 'Grade',
        menuName: 'Master > Grade',
        uiRoute: '/#/app.grade'
    });

    // A brand new "Draft" module (simulated extraction from a dev ticket)
    ModuleRegistry.storeDraft('MOCK-3', {
        moduleName: 'Training Management',
        menuName: 'Employee > Training',
        requirements: ['Add Training Course', 'Assign Employee to Course', 'Training Evaluation']
    });

    console.log('✅ Modules registered: Department, Grade, Training Management.\n');

    // 2. Test AI classification against these modules
    const testTickets = [
        {
            id: 'PROD-101',
            summary: 'Bug: Cannot save new Grade when salary range is empty',
            description: 'When I try to create a new salary grade in the Master settings, the save button is disabled if the range is not filled. This should be optional.'
        },
        {
            id: 'PROD-102',
            summary: 'Story: Implement Training Course Evaluation Form',
            description: 'We need a new screen under the Training module where employees can submit feedback after completing a course.'
        }
    ];

    console.log('Step 2: Testing AI classification (No hardcoded keywords for "Training")...\n');

    for (const ticket of testTickets) {
        console.log(`Ticket ${ticket.id}: "${ticket.summary}"`);
        
        // We call the private method via 'any' cast for demo purposes
        const detection: any = await (JiraService as any).detectModuleViaAI(ticket.summary, ticket.description);
        
        if (detection) {
            console.log(`🤖 AI Result:`);
            console.log(`   - Target Module: ${detection.module}`);
            console.log(`   - Target Menu:   ${detection.menu}`);
            console.log(`   - Confidence:    ${(detection.confidence * 100).toFixed(0)}%`);
        } else {
            console.log(`❌ AI failed to classify.`);
        }
        console.log('---------------------------------------------------\n');
    }

    process.exit(0);
}

demoClassification().catch(err => {
    console.error('Demo error:', err);
    process.exit(1);
});
