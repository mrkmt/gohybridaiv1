# ISTQB Testing Knowledge — AI Reference Summary

## Core Testing Principles (ISTQB Foundation Level)

### Seven Testing Principles
1. **Testing shows presence of defects** — testing cannot prove software is defect-free.
2. **Exhaustive testing is impossible** — use risk analysis and priorities to focus effort.
3. **Early testing** — start as early as possible in the SDLC.
4. **Defect clustering** — a small number of modules usually contain most defects.
5. **Pesticide paradox** — repeated tests lose effectiveness; update test cases regularly.
6. **Testing is context-dependent** — e-commerce ≠ safety-critical ≠ HR SaaS.
7. **Absence-of-errors fallacy** — fixing bugs doesn't help if the system is unusable.

### Test Levels
| Level | Scope | Who | Tools |
|---|---|---|---|
| Unit | Single function/component | Developer | Jest, Vitest |
| Integration | Module interactions | Developer/QA | Playwright, Supertest |
| System | Full application flow | QA | Playwright, Selenium |
| Acceptance (UAT) | Business requirements | End-user/PM | Manual, BDD |

### Test Types
- **Functional**: Does the feature work as specified? (Login, Leave Request, Payroll Calc)
- **Non-Functional**: Performance, Security, Usability, Accessibility
- **Regression**: Did the fix break something else?
- **Smoke/Sanity**: Quick check after deployment — can the user login and navigate?

## Test Design Techniques

### Black-Box (Specification-Based)
- **Equivalence Partitioning**: Divide inputs into valid/invalid classes. Test one from each.
- **Boundary Value Analysis**: Test at edges (min, min+1, max-1, max).
- **Decision Table**: Map combinations of conditions → actions (e.g., Leave Approval matrix).
- **State Transition**: Model states of an entity (e.g., Leave Request: Draft → Submitted → Approved → Rejected).

### White-Box (Structure-Based)
- **Statement Coverage**: Every line of code executed at least once.
- **Branch Coverage**: Every if/else path taken.

## Defect Management
- **Severity**: Critical > Major > Minor > Trivial
- **Priority**: Urgent > High > Medium > Low
- **Defect Lifecycle**: New → Assigned → Fixed → Verified → Closed (or Reopened)

## Test Automation Principles (ISTQB MAT)
- Automate repetitive regression tests first.
- Use the **Test Automation Pyramid**: Many unit tests, fewer integration, fewest E2E.
- Maintain tests as living documentation — broken tests must be fixed, not skipped.
- Use **Page Object Model (POM)** for UI test maintainability.
- Prefer **stable selectors** (data-testid, name, formcontrolname) over fragile CSS/XPath.
