/**
 * Full Jira Ticket Automation Runner
 * 
 * Runs the complete flow:
 * 1. Start session (auto-transition to "In Testing")
 * 2. Generate test cases from Jira ticket
 * 3. Approve test cases
 * 4. Execute tests with Playwright
 * 5. Upload results to Jira + transition to "Bug Done"
 * 
 * Usage: npx ts-node scripts/run-full-ticket.ts ATT-16
 */

const ticketId = process.argv[2] || 'ATT-16';
const API_BASE = 'http://localhost:3000/api/testing';

// Environment config
const ENV = {
  stage: 'testing',
  baseUrl: 'https://test.globalhr.com.mm/ook',
  username: 'testook_HR 1',
  password: 'Global@2024',
  idNumber: 'testook_HR 1',
  customerId: 'ook',
  browser: 'chromium',
  headless: true,
  timeout: 180000,
  autoHeal: true,
  platform: 'LOCAL'
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function api(method: string, path: string, body?: any): Promise<any> {
  const url = `${API_BASE}${path}`;
  console.log(`\n📡 ${method} ${url}`);
  if (body && method !== 'GET') console.log(`   Body: ${JSON.stringify(body).slice(0, 200)}`);

  try {
    const opts: any = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body && method !== 'GET') {
      opts.body = JSON.stringify(body);
    }

    const resp = await fetch(url, opts);

    const data = await resp.json();
    console.log(`   Status: ${resp.status}`);
    if (data.success !== undefined) console.log(`   Success: ${data.success}`);
    if (data.message) console.log(`   Message: ${data.message}`);
    
    if (!resp.ok && !data.success) {
      console.log(`   ❌ Error: ${JSON.stringify(data).slice(0, 300)}`);
    }
    
    return data;
  } catch (e: any) {
    console.log(`   ❌ Request failed: ${e.message}`);
    return { success: false, error: e.message };
  }
}

async function pollExecution(ticketId: string, maxMinutes: number = 15): Promise<any> {
  const maxAttempts = maxMinutes * 12; // poll every 5 seconds
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    await sleep(5000);
    attempts++;
    
    const statusResp = await api('GET', `/${ticketId}/session`);
    const session = statusResp.session;
    if (!session) continue;
    
    const phase = session.phase;
    const results = session.results || [];
    
    if (phase === 'reporting' && results.length > 0) {
      return { success: true, results };
    } else if (phase === 'execution') {
      if (attempts % 6 === 0) {
        console.log(`   ⏳ Still executing... (${results.length} tests so far)`);
      }
    } else if (phase === 'completed') {
      return { success: true, results };
    } else {
      console.log(`   ⚠ Unexpected phase: ${phase}`);
      return { success: false, phase, results };
    }
  }
  
  console.log(`   ⏱️ Execution polling timeout (${maxMinutes} min)`);
  return { success: false, error: 'timeout' };
}

async function runFullFlow() {
  console.log('═'.repeat(60));
  console.log(`🎯 Full Jira Ticket Automation: ${ticketId}`);
  console.log('═'.repeat(60));

  // Step 1: Start Session
  console.log('\n' + '─'.repeat(40));
  console.log('📋 Step 1: Start Testing Session');
  console.log('─'.repeat(40));
  const startResult = await api('POST', `/${ticketId}/start`, { autoTransition: true });
  if (!startResult.success) {
    console.log('❌ Failed to start session. Stopping.');
    return;
  }
  console.log(`   Status: ${startResult.currentStatus}`);
  console.log(`   Ticket Type: ${startResult.orchestration?.ticketType || 'Unknown'}`);

  // Step 2: Generate Test Cases
  console.log('\n' + '─'.repeat(40));
  console.log('🧠 Step 2: Generate Test Cases');
  console.log('─'.repeat(40));
  const generateResult = await api('POST', `/${ticketId}/test-cases/generate`, {});
  if (!generateResult.success) {
    console.log('❌ Failed to generate test cases. Stopping.');
    return;
  }
  console.log(`   Generated: ${generateResult.testCases?.length || 0} test cases`);
  if (generateResult.testCases) {
    generateResult.testCases.forEach((tc: any, i: number) => {
      console.log(`     ${i+1}. ${tc.caseId}: ${tc.title}`);
    });
  }

  // Step 3: Approve Test Cases
  console.log('\n' + '─'.repeat(40));
  console.log('✅ Step 3: Approve Test Cases');
  console.log('─'.repeat(40));
  const approveResult = await api('POST', `/${ticketId}/test-cases/approve`, {});
  if (!approveResult.success) {
    console.log('❌ Failed to approve test cases. Stopping.');
    return;
  }
  console.log(`   Approved: ${approveResult.testCasesCount || 'unknown'} test cases`);

  // Step 4: Execute Tests (poll for completion)
  console.log('\n' + '─'.repeat(40));
  console.log('🚀 Step 4: Execute Tests');
  console.log('─'.repeat(40));
  console.log('   Starting execution (this will take several minutes)...');
  
  // Start execution (fire and forget)
  const execPromise = fetch(`${API_BASE}/${ticketId}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ environment: ENV })
  }).then(async r => {
    const data = await r.json();
    console.log(`\n   Execution response: ${data.message || 'Started'}`);
    return data;
  }).catch(err => {
    console.log(`   Execution request timed out (normal - tests are running)`);
    return null;
  });

  // Poll for completion
  const execResult = await pollExecution(ticketId, 15);
  
  if (execResult.success) {
    const results = execResult.results || [];
    const passed = results.filter((r: any) => r.status === 'PASS').length;
    const failed = results.filter((r: any) => r.status === 'FAIL').length;
    console.log(`\n   ✅ Execution complete!`);
    console.log(`   Results: ${passed} passed, ${failed} failed (${results.length} total)`);
    results.forEach((r: any) => {
      const icon = r.status === 'PASS' ? '✅' : '❌';
      console.log(`     ${icon} ${r.testCaseId}: ${r.testCaseTitle?.substring(0, 50) || '?'} (${r.status})`);
    });
  } else {
    console.log(`   ❌ Execution failed or timed out`);
  }

  // Step 5: Upload Results to Jira + Transition
  console.log('\n' + '─'.repeat(40));
  console.log('📤 Step 5: Upload Results to Jira + Transition');
  console.log('─'.repeat(40));
  
  const uploadResult = await api('POST', `/${ticketId}/results/upload`, {
    postComment: true,
    uploadAttachment: true,
    transitionTo: 'Bug Done',
    environment: 'testing'
  });

  if (!uploadResult.success) {
    console.log('❌ Upload failed.');
    return;
  }

  console.log('\n' + '═'.repeat(60));
  console.log('✅ FULL FLOW COMPLETE');
  console.log('═'.repeat(60));
  console.log(`   Ticket: ${ticketId}`);
  console.log(`   Attachment: ${uploadResult.results?.attachment?.attachmentUrl || 'N/A'}`);
  console.log(`   Comment Posted: ${uploadResult.results?.commentPosted || false}`);
  console.log(`   Transitioned: ${uploadResult.results?.transitioned || false}`);
  console.log(`   New Status: ${uploadResult.results?.transitionStatus || 'Unknown'}`);
  console.log('═'.repeat(60));
}

// Run
runFullFlow().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
