# GlobalHR System Context: Business Logic & Flows

> Source: Master.docx, GlobalHR Cloud Training User Guide v2.0.0

## System Overview
GlobalHR Cloud is a multi-tenant HR SaaS built with **Angular 19 + Kendo UI**. Each tenant has a unique `CUSTOMER_ID`:
```
https://{domain}/{CUSTOMER_ID}/login
https://{domain}/{CUSTOMER_ID}/#/dashboard
```

## CORE MODULES:

### 1. Security & Access
- **Login**: ID Number + Username + Password → Customer Selection → Dashboard
- **User Level**: Controls menu visibility, feature access, data scope
- **Customer Selection**: Admin users can switch between customers

### 2. Master Data (Setup Modules)
All Master modules share a common pattern:
- Navigate: Left menu → "Master" → Select module
- Button: **"Add New"** to create → Fill form → **"Save"** to submit
- Grid: Kendo Grid with filtering, sorting, Excel export
- Status: Active/Inactive filtering available

| Module | Route | Key Fields | Unique Rules |
|--------|-------|-----------|--------------|
| **Company Profile** | `#/master-company` | Name, Email, Phone, Address, SSB No., Leave Period | Multiple tabs (Basic, Generate Number, Additional) |
| **Department** | `#/master-department` | Short Code (5 max), Name, Order, Company, Parent Dept, Shift | Hierarchical via Parent Department, Import from Excel |
| **Grade** | `#/master-grade` | Name, Order, Upper Grade, Default, Topmost | Hierarchy via Upper Grade |
| **Designation** | `#/master-designation` | Short Code (5 max), Name, Order, Grade | Linked to Grade, Import/Export Excel |
| **Team Setup** | `#/master-team` | Name, Description, Product, Type (Team/Project) | Type: Team or Project |
| **Label Setup** | `#/master-label` | Name, Description, Type (Claim/Attendance/OT/Leave) | Cross-module labels |
| **Leave Type** | `#/master-leave-type` | Short Code (5 max), Name, Gender Option, Reason Mandatory | Gender-specific leaves |
| **Keyword** | `#/master-keyword` | Name, Default, Inactive | Sub-types: Division, Location, Section, Group, Cost Center |
| **Public Holiday** | `#/master-public-holiday` | Date/Range, Description, Default | Generate from Default or Government Holiday |
| **GPS Location** | `#/master-gps-location` | Location (By Map/By Location), Radius, Division | Map or Address-based |

### 3. Employee Master
- **Employee Setup**: Unique Employee Code + Name + Department + Designation + Branch + Joining Date
- Kendo Grid listing with filter, sort, Excel export

### 4. Leave Management
- **Leave Policy**: Define per company leave types
- **Flow**: Employee Request → L1 Approver → L2 Approver → HR → Balance Update
- **Restrictions**: Min/max days, advance notice, blackout periods
- **Mobile**: Approvers can Approve/Reject from Mobile Approver app

### 5. Attendance & Check In/Out
- **Biometric Integration**: Import punch data from devices
- **Shift Roster**: Regular, Night, Rotational shifts
- **OT Calculation**: Based on shift end-time vs actual check-out
- **Mobile Check-in**: GPS-based location verification

### 6. Payroll
- **Setup**: Earning heads (Basic, Allowances) + Deduction heads (Tax, SSB)
- **Calculation**: Net Pay = ∑ Earnings − ∑ Deductions
- **Bank Export**: Bank-format files for salary disbursement
- **Rule**: Leave without pay must reduce Basic proportionally

### 7. Recruitment (v2.0.0)
- **Flow**: Job Posting → Applicant Tracking → Interview → Offer → Onboarding

## Common UI Patterns (Kendo UI)
- **Grid**: `kendo-grid` / `.k-grid` — Filter via column headers or toolbar
- **DatePicker**: `kendo-datepicker` with `[ng-reflect-name]` attribute
- **DropdownList**: `kendo-dropdownlist` — always wait for data to load before selecting
- **Dialog/Modal**: `kendo-dialog` / `.k-dialog` — forms appear here
- **TabStrip**: `kendo-tabstrip` — navigation between sub-sections
- **Upload**: `kendo-upload` — file attachments
- **Buttons**: "Add New" (create), "Save" (submit), "Edit" icon, "Delete" icon

## Critical Business Rules
1. **Short Code**: All modules with Short Code field are limited to **5 characters max**
2. **All Master forms** use **"Add New"** button to open form and **"Save"** to submit
3. **No "Post" or "Draft" workflow** in Master modules — data saves immediately
4. **Login is auto-handled** by test template — do NOT include login steps in test cases
5. **Inactive filter**: All Master grids support "Include Inactive" / "Inactive Only" toggle

## Module Knowledge Location
Detailed form fields and selectors for each module are stored in:
```
backend/skills/GlobalHR/forms/{module-name}.json
```
