/**
 * Manual test script for ATT-15 and ATT-18
 * Tests /refresh, /session, /sessions/cleanup endpoints
 */
import axios from 'axios';

const BASE = 'http://localhost:4200/api/testing';
const API_KEY = process.env.TEST_API_KEY || 'test-key';

async function get(path: string, label: string) {
  console.log(`\n--- ${label} ---`);
  try {
    const res = await axios.get(`${BASE}${path}`, {
      headers: { 'x-api-key': API_KEY },
      timeout: 30000,
    });
    console.log(`Status: ${res.status}`);
    console.log(JSON.stringify(res.data, null, 2).slice(0, 2000));
    return res.data;
  } catch (e: any) {
    console.log(`Error: ${e.response?.status || e.code || e.message}`);
    if (e.response?.data) {
      console.log(JSON.stringify(e.response.data, null, 2).slice(0, 1000));
    } else {
      console.log(e.message || 'No response body');
    }
    return null;
  }
}

async function post(path: string, body: any, label: string) {
  console.log(`\n--- ${label} ---`);
  try {
    const res = await axios.post(`${BASE}${path}`, body, {
      headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
      timeout: 60000,
    });
    console.log(`Status: ${res.status}`);
    console.log(JSON.stringify(res.data, null, 2).slice(0, 2000));
    return res.data;
  } catch (e: any) {
    console.log(`Error: ${e.response?.status || e.code || e.message}`);
    if (e.response?.data) {
      console.log(JSON.stringify(e.response.data, null, 2).slice(0, 1000));
    } else {
      console.log(e.message || 'No response body');
    }
    return null;
  }
}

async function main() {
  console.log('=== Testing ATT-15 and ATT-18 ===');

  // 1. Test /refresh for both tickets
  await get('/ATT-15/refresh', 'ATT-15 Refresh');
  await get('/ATT-18/refresh', 'ATT-18 Refresh');

  // 2. Test /session for both
  await get('/ATT-15/session', 'ATT-15 Session');
  await get('/ATT-18/session', 'ATT-18 Session');

  // 3. Test cleanup
  await get('/sessions/cleanup', 'Cleanup Sessions');

  // 4. Test startTesting (may block based on Jira status)
  await post('/ATT-15/start', { testType: 'regression', provider: 'gemini', model: 'gemini-2.5-flash' }, 'ATT-15 Start');
  await post('/ATT-18/start', { testType: 'regression', provider: 'gemini', model: 'gemini-2.5-flash' }, 'ATT-18 Start');

  // 5. List all sessions
  await get('/sessions', 'List All Sessions');

  console.log('\n=== Done ===');
}

main().catch(console.error);
