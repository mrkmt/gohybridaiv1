import * as path from 'path';
import * as fs from 'fs';

interface ValidationResult {
  errors: string[];    // Blocking — server should not start
  warnings: string[];  // Non-blocking — degraded functionality
}

export function validateEnvironment(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const required = (varName: string, description: string) => {
    if (!process.env[varName]) {
      errors.push(`${varName} is required — ${description}`);
    }
  };

  const warn = (varName: string, description: string) => {
    if (!process.env[varName]) {
      warnings.push(`${varName} not set — ${description}`);
    }
  };

  const warnDefault = (varName: string, badDefault: string, description: string) => {
    const val = process.env[varName];
    if (!val || val === badDefault) {
      warnings.push(`${varName} is using insecure default "${badDefault}" — ${description}`);
    }
  };

  // ── Hard failures ──────────────────────────────────────────────────────
  required('PG_PASSWORD', 'PostgreSQL password cannot be empty');
  required('BASE_URL', 'Target application URL — used by Playwright and discovery');
  required('TEST_USERNAME', 'Test account username — required for Playwright login');
  required('TEST_PASSWORD', 'Test account password — required for Playwright login');
  required('JIRA_DOMAIN', 'Jira domain (e.g. yourcompany.atlassian.net)');
  required('JIRA_EMAIL', 'Jira account email');
  required('JIRA_API_TOKEN', 'Jira API token');

  // JWT_SECRET — block start if using the dev default in non-dev environments
  const jwtSecret = process.env.JWT_SECRET;
  const jwtDefault = 'gohybridai-dev-secret-change-in-production';
  if (!jwtSecret) {
    errors.push('JWT_SECRET is not set — generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  } else if (jwtSecret === jwtDefault && process.env.NODE_ENV === 'production') {
    errors.push('JWT_SECRET is using the insecure development default in production — set a random 32-byte hex string');
  } else if (jwtSecret === jwtDefault) {
    warnings.push('JWT_SECRET is using the development default — change before deploying to production');
  }

  // ── Soft warnings ──────────────────────────────────────────────────────
  warn('OPENROUTER_API_KEY', 'Required for embeddings and HTTP AI fallback — generation will use CLI only');
  warn('GEMINI_API_KEY', 'Optional — enables Gemini REST API fallback');
  warn('GROQ_API_KEY', 'Optional — enables Groq as secondary HTTP fallback');
  warn('TEST_IDNUMBER', 'Required for GlobalHR login (employee ID number field)');
  warn('CUSTOMER_ID', 'Required for multi-tenant URL construction');

  warnDefault('API_KEY', 'your-dev-api-key', 'Change before exposing to external clients');

  // ── New variables from Priority 3 ──────────────────────────────────────
  if (!process.env.UNIFIED_AI_MODEL) {
    warnings.push('UNIFIED_AI_MODEL not set — AgentOrchestrator will use DEFAULT_AI_MODEL as fallback');
  }

  if (!process.env.LOCAL_STORAGE_PATH) {
    // Not an error — defaults to backend/local_storage — but log it
    const defaultPath = path.join(__dirname, '..', '..', 'local_storage');
    console.info(`[EnvironmentValidator] LOCAL_STORAGE_PATH not set — using default: ${defaultPath}`);
  }

  if (!process.env.DISCOVERY_ALLOWED_MODELS) {
    warnings.push('DISCOVERY_ALLOWED_MODELS not set — defaulting to "gemini,qwen"');
  }

  return { errors, warnings };
}

/**
 * Call at server startup in server.ts, before app.listen().
 * Throws on any error so the server refuses to start with bad config.
 */
export function assertEnvironmentValid(): void {
  const { errors, warnings } = validateEnvironment();

  warnings.forEach(w => console.warn(`[ENV] ⚠ ${w}`));

  if (errors.length > 0) {
    console.error('\n[ENV] ✖ Server cannot start — fix these environment variables:\n');
    errors.forEach(e => console.error(`  ✖ ${e}`));
    console.error('\nCopy backend/.env.example to backend/.env and fill in the required values.\n');
    process.exit(1);
  }

  console.info(`[ENV] ✓ Environment validated — ${warnings.length} warning(s)`);
}

/**
 * path helper (also useful in other services)
 */
export function getLocalStoragePath(...segments: string[]): string {
  const base = process.env.LOCAL_STORAGE_PATH
    ? path.resolve(process.env.LOCAL_STORAGE_PATH)
    : path.join(__dirname, '..', '..', 'local_storage');
  return path.join(base, ...segments);
}
