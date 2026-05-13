# GlobalHR Investigation Skill: Login & Access Control

This skill defines the business rules for investigating login failures and access permission discrepancies within the GlobalHR Cloud platform.

## 1. Scope: Login & User Level Integration
When a user reports "Cannot Login" but claims permissions are set, the AI must verify the relationship between three main forms:
1. **GlobalHR Login Page** (Authentication)
2. **User Level Control** (Authorization/Flags)
3. **Employee Setup** (Identity/Assignment)

---

## 2. Investigation Rules (Phase 2 Checklist Logic)

### A. Authentication Check (Login)
- [ ] Verify if the `CustomerURL` matches the environment.
- [ ] Check if the `idnumber` (Initial) is correctly formatted.
- [ ] Detect if any `401 Unauthorized` or `403 Forbidden` network codes occurred during the `POST /api/token` call.

### B. Authorization Check (User Level Control)
- [ ] **Inactive Flag**: Verify that `chkInactive` is NOT checked for the assigned User Level.
- [ ] **Access Flags**:
    - `Allow Web Login`: Must be TRUE for browser access.
    - `Allow Mobile Login`: Must be TRUE for mobile app access.
- [ ] **Menu Permissions**: Verify that the specific menu the user is trying to access is included in the `MenuList` JSON or `Menu Permission` grid.
- [ ] **Restricted IP**: Check if `txtRestrictedIP` contains values that might block the user's current IP.

### C. Identity Check (Employee Setup)
- [ ] Verify that the `Employee Code` exists and is active.
- [ ] Confirm the `UserLevel` assigned in Employee Setup matches the one modified in User Level Control.

---

## 3. Reproduction Logic (Phase 4 Plan Logic)

### Stage 1: Admin Environment Prep
1. **Navigate**: `User Level Management > User Level Control`.
2. **Action**: Search for the reported `User Level Name`.
3. **Verification**: Ensure all "Allow Login" checkboxes are checked.
4. **Action**: `Employee > Employee Setup`.
5. **Verification**: Find the test employee and link them to the target User Level.

### Stage 2: Verification Flow
1. **Logout**: Ensure admin session is cleared.
2. **Login**: Attempt login with the test employee credentials.
3. **Success Criteria**: Redirection to `/dashboard` or `/home`.
4. **Failure Analysis**: Capture screenshot of error message and check browser console for 404/500 errors on menu URLs.

---

## 4. Expected Object Signatures
- **User Level Grid**: `.user-level-grid`
- **Employee Search**: `#txtSearch`
- **Login Button**: `#btnLogin`
- **Update Feedback**: `button.btn-success:has-text('Ok')`
