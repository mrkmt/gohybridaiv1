# KMT Selector Rules: Kendo UI Stable Selector Strategy

### GOAL: NEVER use auto-generated IDs from Kendo UI (e.g., #k-73ac82-...). NEVER use Angular ng-reflect attributes (stripped in production builds).

### PRIMARY RULES (in priority order):
1. **Playwright Smart Locators** (when available):
   - `page.getByTestId('...')` — most stable, never breaks
   - `page.getByRole('button', { name: '...' })` — accessibility-aligned
   - `page.getByLabel('...')` — for labeled inputs
   - `page.getByPlaceholder('...')` — when no label exists
   - `page.getByText('...', { exact: true })` — for text content

2. **Stable HTML Attributes**:
   - `[formcontrolname="fieldname"]` — Angular form control binding (stable)
   - `[name="fieldname"]` — standard HTML name attribute (stable)
   - `[data-testid="..."]` — custom test IDs (most stable if present)
   - `[data-role="dropdownlist"]` — Kendo data-role (stable)
   - `[title*="Add" i]` — Kendo button tooltips (stable, case-insensitive)
   - `[aria-label*="..." i]` — accessibility labels (stable)

3. **⚠️ AVOID — These break in production**:
   - `[ng-reflect-name="..."]` — Angular strips these in production builds
   - `#k-73ac82-...` — auto-generated Kendo IDs change every render
   - `.k-grid > tbody > tr:nth-child(2)` — DOM structure changes with sorting/paging
   - XPath expressions — brittle, hard to maintain

4. **Kendo Specifics**:
   - For Kendo Grids: use `.k-grid` container, `.k-master-row` for rows, `.k-table-td` for cells
   - For Dropdowns: use `[data-role="dropdownlist"]` or the container class
   - For Kendo Dialogs: use `kendo-dialog` or `.k-dialog`
   - Icon-only buttons: use `[title*="..." i]` or `[aria-label*="..." i]` — NOT `button:has-text("...")`

### ICON-ONLY BUTTON RULE (CRITICAL):
Many GlobalHR toolbar buttons are ICON-ONLY (e.g., blue "+" icon for "Add New", pencil for Edit, trash for Delete). These have NO text content and NO aria-label.

**WRONG:** `button:has-text("Add New")` — will ALWAYS fail on icon-only buttons
**RIGHT:** `button[title*="Add" i], button[aria-label*="Add" i], .k-button-add`

### EXAMPLES:
- ❌ BAD: `await page.click('#k-123-input')` — auto-generated Kendo ID
- ❌ BAD: `await page.locator('[ng-reflect-name="EmployeeCode"]')` — stripped in production
- ❌ BAD: `await page.click('button:has-text("Add New")')` — icon-only button has no text
- ✅ GOOD: `await page.locator('[formcontrolname="EmployeeCode"]').fill('KMT-001')`
- ✅ GOOD: `await page.locator('[name="password"]').fill('Admin@123')`
- ✅ GOOD: `await page.locator('button[title*="Add" i]').click()` — icon-first selector
- ✅ GOOD: `await page.getByRole('button', { name: 'Save' }).click()` — text-based button
