/**
 * IstqbKnowledgeService
 * Hidden Gem from ai_25 and ai_30.
 * Provides specialized testing domain knowledge to the AI investigator.
 */

export const ISTQB_STANDARDS = {
    test_design_techniques: [
        "Equivalence Partitioning: Test representative values from each valid/invalid range.",
        "Boundary Value Analysis: Test exact boundaries (e.g., 0, 1, max, max+1).",
        "Decision Table Testing: For complex business rules with multiple conditions.",
        "State Transition Testing: For workflows like Approval -> Pending -> Approved.",
        "Use Case Testing: For end-to-end user journeys."
    ],
    quality_attributes: [
        "Atomicity: Each test case should focus on one single condition.",
        "Traceability: Link every test back to a Jira requirement.",
        "Independence: Tests should not depend on the outcome of other tests.",
        "Repeatability: Must produce the same result every time."
    ]
};

export class IstqbKnowledgeService {
    static getPromptInjection(): string {
        return `
### THE THREE PILLARS OF GLOBALHR TESTING:
1. **The Math (API & Logic)**: Use Delta ($\Delta$) comparison for all calculations (Salaries, Leave Balances). Verify API response values against database state.
2. **The Visual (UI & CSS)**: Use Playwright 'toHaveScreenshot' for all Kendo Widgets and Dashboards. Detect layout shifts or CSS regressions.
3. **The Behavior (Workflow)**: Follow BDD (Behavior Driven Development) patterns. Validate end-to-end journeys against the User Guide.

### ISTQB COMPLIANCE GUIDELINES:
- Use Equivalence Partitioning and Boundary Value Analysis for all numeric/date fields.
- For workflows, use State Transition Testing.
- Ensure all test cases are Atomic and Independent.
- Include clear Pass/Fail criteria for every step.
        `;
    }
}
