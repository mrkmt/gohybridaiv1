# Playwright Standards for Go-Hybrid Forensic

### CODE STRUCTURE:
1. **Modular Steps**: Every logical action must be wrapped in `await test.step('Description', async () => { ... });`.
2. **Async/Await**: Ensure all Playwright actions are properly awaited.
3. **User Intelligence**:
   - Locate the "annotations" or "notes" in the Harvester JSON.
   - Automatically inject these notes as `// [USER NOTE]: text` comments directly above the relevant code step.
4. **Environment Variables**:
   - Use `process.env.BASE_URL`, `process.env.CUSTOMER_ID`, `process.env.TEST_USER`, and `process.env.TEST_PASS`.

### VERIFICATION PATTERNS:
- **Visual**: Use `await expect(page).toHaveScreenshot();` after navigating to complex dashboards.
- **Behavior**: Use BDD-style step names (Given/When/Then).
- **Math**: For currency or days, verify value ranges using Delta ($\Delta$).
