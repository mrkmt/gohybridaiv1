# Jira Bug Patterns — AI Reference Summary

> Distilled from: Functional/UI Jira (2.5 MB CSV, ~500+ issues) and Leave Jira Issues (887 KB CSV, ~200+ issues).
> Many bug summaries are in Burmese (Myanmar) language — the AI should use BurmeseTranslator when encountering them.

## Bug Distribution by Module

### High-Defect Modules (Defect Clustering)
| Module | Approx. % of Bugs | Common Issue Types |
|---|---|---|
| **Leave Management** | ~35% | Incorrect balance, approval chain failures, policy restriction bypass |
| **Check In/Out (Attendance)** | ~20% | Slow loading (2-4s), GPS permission errors, duplicate records |
| **Employee Setup** | ~15% | Validation failures, duplicate employee codes, UI field misalignment |
| **Payroll** | ~10% | Calculation mismatches, bank export format errors |
| **Login & User Level** | ~10% | Access control bypass, menu visibility bugs |
| **UI/General** | ~10% | Kendo Grid rendering, responsive layout, date format |

## Recurring Bug Patterns

### 1. Leave Module Bugs
- **Balance Mismatch**: After approval, leave balance does not update correctly.
- **Approval Chain Skip**: L1 approver can approve but L2 step is skipped.
- **Restriction Bypass**: Employee can request leave during blackout period.
- **Attach File Failure**: File upload fails on medical leave requests.
- **Duplicate Records**: Same leave request appears multiple times in approval queue.

### 2. Attendance / Check In/Out Bugs
- **Slow First Load**: Application takes 2.5s–4s on first opening (performance regression).
- **Location Permission**: When GPS permission denied, app shows blank instead of error message.
- **Duplicate Punch**: Same check-in/out recorded multiple times from biometric device.

### 3. Employee Setup Bugs
- **Kendo Grid Filter**: Column filter does not reset when navigating away and back.
- **Required Field Missing**: Save button enabled even when required fields are empty.
- **User Level Assignment**: Changing user level does not immediately update menu visibility.

### 4. URL & Navigation Bugs
- **Customer ID Missing**: Some navigations lose the CUSTOMER_ID from the URL.
- **Deep Link Failure**: Direct URL to a sub-page redirects to login instead of target.

## Selectors Commonly Involved in Bugs
These selectors appear frequently in bug reports — they are fragile or commonly broken:
- `kendo-grid .k-grid-content` — grid scroll/render issues
- `kendo-datepicker input` — date formatting bugs
- `kendo-dropdownlist .k-dropdown-wrap` — dropdown not opening
- `[formcontrolname="leaveType"]` — leave type selection bugs
- `[ng-reflect-name="fromDate"]` / `[ng-reflect-name="toDate"]` — date range issues
- `.k-dialog .k-button` — dialog confirmation button misfire

## Test Priority Guidance
Based on defect clustering, the AI should prioritize generating tests for:
1. **Leave Request full flow** (highest defect density)
2. **Login & User Level** (security-critical)
3. **Check In/Out performance** (regressions detected frequently)
4. **Employee CRUD** (data integrity)
5. **Payroll calculation** (financial accuracy)
