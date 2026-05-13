/**
 * real-ticket-test.ts
 * 
 * Test the JSON generation system with real Jira tickets (ATT-14, ATT-15)
 * Requires JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN environment variables
 */

import { JsonTestGenerationService } from '../src/services/JsonTestGenerationService';
import { FailureClassificationService } from '../src/services/FailureClassificationService';
import * as dotenv from 'dotenv';

dotenv.config();

interface RealTicketTestOptions {
  ticketIds: string[];
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraApiToken: string;
}

async function fetchTicketFromJira(ticketId: string, options: RealTicketTestOptions) {
  const { jiraBaseUrl, jiraEmail, jiraApiToken } = options;
  
  const response = await fetch(`${jiraBaseUrl}/rest/api/3/issue/${ticketId}`, {
    headers: {
      'Authorization': `Basic ${Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString('base64')}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ticket ${ticketId}: ${response.statusText}`);
  }

  const issue = await response.json();
  return {
    id: issue.key,
    summary: issue.fields.summary,
    description: issue.fields.description,
    issuetype: issue.fields.issuetype?.name,
    priority: issue.fields.priority?.name,
  };
}

async function runRealTicketTests() {
  console.log('🧪 Starting Real Ticket Tests (ATT-14, ATT-15)...\n');

  const jiraBaseUrl = process.env.JIRA_BASE_URL || 'https://your-company.atlassian.net';
  const jiraEmail = process.env.JIRA_EMAIL || '';
  const jiraApiToken = process.env.JIRA_API_TOKEN || '';

  if (!jiraEmail || !jiraApiToken) {
    console.error('❌ Missing Jira credentials. Please set JIRA_EMAIL and JIRA_API_TOKEN environment variables.');
    console.log('You can also set JIRA_BASE_URL (default: https://your-company.atlassian.net)');
    process.exit(1);
  }

  const ticketIds = ['ATT-14', 'ATT-15'];
  const options = {
    ticketIds,
    jiraBaseUrl,
    jiraEmail,
    jiraApiToken,
  };

  const results = [];

  for (const ticketId of ticketIds) {
    console.log(`\n📋 Testing ticket: ${ticketId}`);
    console.log('─'.repeat(60));

    try {
      // Step 1: Fetch ticket from Jira
      console.log(`  1. Fetching ${ticketId} from Jira...`);
      const ticket = await fetchTicketFromJira(ticketId, options);
      console.log(`     ✅ Fetched: ${ticket.summary}`);
      console.log(`     Type: ${ticket.issuetype}, Priority: ${ticket.priority}`);

      // Step 2: Extract description text
      const description = typeof ticket.description === 'string' 
        ? ticket.description 
        : JSON.stringify(ticket.description);

      // Step 3: Generate test specification using new JSON system
      console.log(`  2. Generating JSON test specification...`);
      const generationResult = await JsonTestGenerationService.generateAndCompile({
        ticketId,
        summary: ticket.summary,
        description,
        module: 'auto-detect', // Will be detected from ticket content
        baseUrl: process.env.BASE_URL || 'https://test.globalhr.com.mm/ook',
        credentials: {
          username: process.env.TEST_USERNAME || 'testuser',
          password: process.env.TEST_PASSWORD || 'password123',
        },
      });

      if (generationResult.success && generationResult.specification) {
        console.log(`     ✅ Generated ${generationResult.specification.scenarios.length} scenarios`);
        console.log(`     📄 Script saved to: ${generationResult.scriptPath}`);
        
        // Step 4: Classify any failures (if we were to run them)
        console.log(`  3. Testing failure classification system...`);
        const testErrors = [
          'Error: Timeout 30000ms exceeded. waiting for locator("#save-btn")',
          'Error: expect(received).toBe(expected)\nExpected: "Success"\nReceived: "Error"',
          'Error: net::ERR_CONNECTION_REFUSED at https://api.example.com',
        ];

        for (const error of testErrors) {
          const classification = FailureClassificationService.classifyFailure(error);
          console.log(`     📊 ${classification.category}: ${classification.explanation}`);
        }

        results.push({
          ticketId,
          success: true,
          scenarios: generationResult.specification.scenarios.length,
          scriptPath: generationResult.scriptPath,
        });
      } else {
        console.log(`     ❌ Generation failed: ${generationResult.errors?.join(', ')}`);
        results.push({
          ticketId,
          success: false,
          errors: generationResult.errors,
        });
      }
    } catch (error: any) {
      console.log(`     ❌ Error: ${error.message}`);
      results.push({
        ticketId,
        success: false,
        error: error.message,
      });
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Real Ticket Test Summary');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`Total:  ${results.length}`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ❌`);
  
  if (failed > 0) {
    console.log('\n❌ Failed Tickets:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`  - ${r.ticketId}: ${r.error || r.errors?.join(', ')}`);
    });
  } else {
    console.log('\n🎉 All real ticket tests passed!');
  }

  console.log('\n📝 Next Steps:');
  console.log('  1. Review generated test scripts in tests/generated/');
  console.log('  2. Run tests manually: npx playwright test <script-path>');
  console.log('  3. Or integrate with your CI/CD pipeline');
}

// Run if this is the main module
if (require.main === module) {
  runRealTicketTests().catch(console.error);
}

export { runRealTicketTests };