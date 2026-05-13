# GlobalHR Cloud — System User Guide (AI Reference Summary)

> Distilled from: GlobalHR Cloud Training User Guide v2.0.0 and Mobile Approver Level Guide v5.

## System Overview
GlobalHR Cloud is a multi-tenant HR SaaS built with **Angular + Kendo UI**. Each tenant (customer) has a unique `CUSTOMER_ID` used in the URL pattern:
```
https://{domain}/{CUSTOMER_ID}/login
https://{domain}/{CUSTOMER_ID}/dashboard
```

## Core Modules & Navigation

### 1. Security & Access Control
- **Login**: Username + Password → redirects to `/{CUSTOMER_ID}/dashboard`
- **User Level**: Controls menu visibility, feature access, and data scope.
  - Key fields: `Allow Web Login`, `Restricted IP`, `Menu List`, `Employee List`
- **Customer Selection**: Admin users can switch between customers.

### 2. Employee Master
- **Employee Setup**: Create/edit employees with unique Employee Code.
- Critical fields: Name, Department, Designation, Branch, Joining Date.
- Kendo Grid used for listing — supports filtering, sorting, Excel export.

### 3. Leave Management
- **Leave Policy**: Define leave types (Annual, Medical, Casual, etc.) per company.
- **Leave Request Flow**: Employee Request → L1 Approver → L2 Approver → HR → Balance Update
- **Leave Balance**: Auto-calculated based on policy, accrual rules, and carry-forward.
- **Restriction Rules**: Min/max days, advance notice, blackout periods.
- Mobile: Approvers can Approve/Reject via Mobile Approver app.

### 4. Attendance & Check In/Out
- **Biometric Integration**: Imports punch data from devices.
- **Shift Roster**: Maps employees to shifts (Regular, Night, Rotational).
- **OT Calculation**: Based on shift end-time vs actual check-out.
- **Mobile Check-in**: GPS-based location verification. Requires location permission.

### 5. Payroll
- **Payroll Setup**: Earning heads (Basic, Allowances) + Deduction heads (Tax, SSB).
- **Calculation Engine**: Net Pay = ∑ Earnings − ∑ Deductions.
- **Bank Export**: Generates bank-format files for salary disbursement.
- Critical rule: Leave without pay must reduce Basic proportionally.

### 6. Recruitment (v2.0.0)
- **Job Posting → Applicant Tracking → Interview → Offer → Onboarding**
- Integrated with Employee Master for automatic profile creation.

## Common UI Patterns (Kendo UI)
- **Grid**: All tabular data uses `kendo-grid`. Filter via column headers or toolbar.
- **DatePicker**: `kendo-datepicker` with `[ng-reflect-name]` attribute.
- **DropdownList**: `kendo-dropdownlist` — always wait for data to load before selecting.
- **Dialog/Modal**: `kendo-dialog` — appears for confirmations, forms. Use `.k-dialog` selector.
- **TabStrip**: `kendo-tabstrip` — navigation between sub-sections.
- **Upload**: `kendo-upload` — file attachments (e.g., leave request documents).

## Critical Test Paths
1. **Login → Dashboard**: Verify URL contains CUSTOMER_ID, verify menu items match User Level.
2. **Leave Request E2E**: Create → Submit → L1 Approve → L2 Approve → Check Balance.
3. **Employee Create**: Fill form → Save → Verify in grid → Verify details page.
4. **Payroll Run**: Select period → Calculate → Verify Net Pay → Export.
5. **Attendance**: Import punches → Map to roster → Verify hours → OT calculation.
