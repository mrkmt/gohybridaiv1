# Test Environment Configuration Guide

## Environment URLs

| Environment | Base URL | API URL | Purpose |
|-------------|----------|---------|---------|
| **Testing** | `https://test.globalhr.com.mm/ook` | `https://apitest.globalhr.com.mm/v2_2api/api` | Development & Testing |
| **UAT** | `https://app1.globalhr.com.mm/ook` | `https://apitest.globalhr.com.mm/v2_2api/api` | User Acceptance Testing |
| **Live** | `https://www.globalhr.app/ook` | `https://api.globalhr.app/v2_2api/api` | Production |

## Quick Start

### Run Tests on Testing Environment (Default)
```bash
npm run test:e2e -- tests/playwright/att-16-designation-create.spec.ts
```

### Run Tests on UAT Environment
```bash
TEST_ENV=uat npm run test:e2e -- tests/playwright/att-16-designation-create.spec.ts
```

### Run Tests on Live Environment
```bash
TEST_ENV=live npm run test:e2e -- tests/playwright/att-16-designation-create.spec.ts
```

## Configure Credentials

Edit `backend/tests/playwright/test-credentials.ts` to add your credentials:

```typescript
export const UAT_CREDENTIALS: TestCredentials = {
    baseUrl: 'https://app1.globalhr.com.mm/ook',
    apiBaseUrl: 'https://apitest.globalhr.com.mm/v2_2api/api',
    idNumber: 'your_uat_id',        // ← Add your UAT ID
    username: 'your_uat_username',   // ← Add your UAT username
    password: 'your_uat_password',   // ← Add your UAT password
    browser: 'chromium',
    headless: false
};

export const LIVE_CREDENTIALS: TestCredentials = {
    baseUrl: 'https://www.globalhr.app/ook',
    apiBaseUrl: 'https://api.globalhr.app/v2_2api/api',
    idNumber: 'your_live_id',        // ← Add your Live ID
    username: 'your_live_username',   // ← Add your Live username
    password: 'your_live_password',   // ← Add your Live password
    browser: 'chromium',
    headless: false
};
```

## Using in Your Tests

### Option 1: Use Pre-defined Credentials
```typescript
import { test } from '@playwright/test';
import { TESTING_CREDENTIALS, UAT_CREDENTIALS } from './test-credentials';
import { loginAndNavigate } from './login-helper';

test.beforeEach(async ({ page }) => {
    await loginAndNavigate(
        page,
        TESTING_CREDENTIALS,  // or UAT_CREDENTIALS, LIVE_CREDENTIALS
        'Designation',         // Menu name to navigate to
        'fallback-url'
    );
});
```

### Option 2: Use Environment Variable
```typescript
import { test } from '@playwright/test';
import { getCredentialsForEnvironment } from './test-credentials';
import { loginAndNavigate } from './login-helper';

test.beforeEach(async ({ page }) => {
    const credentials = getCredentialsForEnvironment();
    await loginAndNavigate(
        page,
        credentials,
        'Designation',
        'fallback-url'
    );
});
```

## Environment Variable Reference

| TEST_ENV Value | Environment | Credentials Used |
|----------------|-------------|------------------|
| `testing` (default) | Testing | TESTING_CREDENTIALS |
| `uat` | UAT | UAT_CREDENTIALS |
| `live` or `production` | Live | LIVE_CREDENTIALS |

## Smart Navigation Features

The `loginAndNavigate` function provides:

1. **Session Check** - Skips login if already logged in
2. **Kendo UI Support** - Handles readonly password fields
3. **API Menu Fetch** - Gets actual menu structure from API
4. **Direct Navigation** - Goes straight to target page via menu URL
5. **Fallback Support** - Uses hardcoded URL if API fails

## Example Test Structure

```typescript
import { test, expect } from '@playwright/test';
import { loginAndNavigate } from './login-helper';
import { TESTING_CREDENTIALS } from './test-credentials';
import { healedClick, safeFill } from './playwright-self-healing';

test.describe('My Feature Test', () => {
    test.beforeEach(async ({ page }) => {
        // Login and navigate to target page
        await loginAndNavigate(
            page,
            TESTING_CREDENTIALS,
            'Designation',  // Menu name
            'https://test.globalhr.com.mm/ook#/app.designation'
        );
    });

    test('should create new item', async ({ page }) => {
        await healedClick(page, 'button:has-text("Add")');
        await safeFill(page, 'input[name="name"]', 'Test Item');
        await healedClick(page, 'button:has-text("Save")');
        // ... rest of test
    });
});
```

## Troubleshooting

### Login Fails
- Check credentials in `test-credentials.ts`
- Verify network connectivity to the environment
- Check if account is active in that environment

### Menu Navigation Fails
- Verify API endpoint is accessible
- Check if user has permission for target menu
- Menu name must match exactly (case-insensitive search)

### Timeout Errors
- Increase timeouts in test file
- Check network speed
- Consider using `headless: false` for debugging

## Best Practices

1. **Never commit real credentials** - Use placeholders and `.env` files
2. **Use environment variables** for sensitive data
3. **Test on Testing environment first** before UAT/Live
4. **Keep menu names updated** as application evolves
5. **Add comments** when updating credentials

---
**Last Updated:** March 30, 2026
