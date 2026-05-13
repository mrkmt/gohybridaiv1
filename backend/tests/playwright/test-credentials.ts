/**
 * Test Credentials for GlobalHR
 *
 * Shared credentials used by all generated Playwright tests.
 * Sensitive values are loaded from environment variables first.
 * NEVER commit real credentials — use .env file for secrets.
 */

export const TESTING_CREDENTIALS = {
  baseUrl: process.env.TEST_BASE_URL || process.env.BASE_URL || 'https://test.globalhr.com.mm/ook',
  apiBaseUrl: process.env.TEST_API_BASE_URL || process.env.TEST_API_URL || 'https://apitest.globalhr.com.mm',
  idNumber: process.env.TEST_IDNUMBER || '',
  username: process.env.TEST_USERNAME || '',
  password: process.env.TEST_PASSWORD || '',
};

/**
 * Live / production fallback credentials.
 * Used automatically when the primary test site is unreachable or the login
 * page does not show the expected fields.
 *
 * Login URL: https://www.globalhr.app/userguide#/login
 */
export const FALLBACK_CREDENTIALS = {
  baseUrl:   process.env.LIVE_BASE_URL   || 'https://www.globalhr.app/userguide',
  idNumber:  process.env.LIVE_TEST_IDNUMBER || 'GHR-00001',
  username:  process.env.LIVE_TEST_USERNAME || 'Peterson',
  password:  process.env.LIVE_TEST_PASSWORD || 'Global@2026',
};

// Warn if primary credentials are not configured
if (!TESTING_CREDENTIALS.username || !TESTING_CREDENTIALS.password) {
  console.warn(
    '[test-credentials] WARNING: TEST_USERNAME and/or TEST_PASSWORD not set. ' +
    'Falling back to FALLBACK_CREDENTIALS. Configure them in .env file.'
  );
}
