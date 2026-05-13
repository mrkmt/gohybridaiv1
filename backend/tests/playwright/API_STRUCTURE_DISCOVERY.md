# 🔍 API Structure Discovery - GlobalHR Designation

**Date:** March 31, 2026  
**Status:** ✅ API Structure Identified

---

## 📊 API Endpoints Discovered

### 1. GetMoreDesignations (READ all)

**Endpoint:** `POST https://apitest.globalhr.com.mm/v2_2api/api/designation/GetMoreDesignations`

**Request:**
```json
{
    "IsInactive": false,
    "OnlyInactive": false
}
```

**Response Structure:**
```json
{
    "data": {
        "data": [
            {
                "DesignationId": 1,
                "Designation": " Active _Updated_2582",
                "ShortCode": "staff",
                "GradeID": 1,
                "DesignationOrder": "11",
                "IsInactive": false,
                "CustomerId": 459,
                "ServerLocationId": 0,
                "LastModifiedDate": "2026-03-25T23:47:43",
                "isdefault": false
            }
        ]
    }
}
```

**⚠️ Important Notes:**
- Response is **nested**: `data.data` (not just `data`)
- Field names use **PascalCase**: `DesignationId`, `Designation`, `DesignationOrder`
- NOT camelCase: not `designation_id`, `designation_name`, `order`

---

### 2. GetMaxDesignationOrder (Before CREATE)

**Endpoint:** `POST https://apitest.globalhr.com.mm/v2_2api/api/designation/GetMaxDesignationOrder`

**Request:**
```json
{}
```

**Response:**
```json
{
    "data": 1111111169,
    "error": null
}
```

---

### 3. CREATE Designation (Unknown - Need to Capture)

**Expected Endpoint:** `POST https://apitest.globalhr.com.mm/v2_2api/api/designation/Create` or similar

**Expected Request Structure:**
```json
{
    "Designation": "Test Designation Name",
    "ShortCode": "TEST_CODE",
    "GradeID": 1,
    "DesignationOrder": 1111111170
}
```

---

## 🔍 Test Designation Search Pattern

To find test designations in the API response, search for:

```javascript
const testDesignations = designations.filter(d => 
    /Design_\d+|Diagnose_\d+|Test_\d+|Auto_\d+|NET_\d+|Network_Test_\d+/.test(d.Designation)
);
```

---

## 📋 Current Test Designations in System

Based on test runs, these should exist (if CREATE worked):

| Name | Timestamp | Status |
|------|-----------|--------|
| `Design_1774862133990` | Earlier test | ❓ Unknown |
| `Design_1774936177833` | Test run 1 | ❓ Unknown |
| `Design_1774936308419` | Test run 2 | ❓ Unknown |
| `Diagnose_1774935554032` | Diagnostic test | ❓ Unknown |
| `Network_Test_XXX` | Network monitor test | ❓ Unknown |

---

## 🛠️ Required Fixes

### Fix 1: Update Skills to Use Correct Field Names

**Current (Wrong):**
```typescript
const recentDesignations = await client.query(`
    SELECT * FROM designations 
    WHERE designation_name ILIKE $1
`);
```

**Should be (API Call):**
```typescript
const response = await fetch(`${baseUrl}/api/designation/GetMoreDesignations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ IsInactive: false, OnlyInactive: false })
});
const json = await response.json();
const designations = json.data.data; // Nested!
const found = designations.find(d => d.Designation.includes(testName));
```

---

### Fix 2: Update READ Skill

**Current Issue:** Searching in database (doesn't exist)

**Should Be:** Search via API or UI grid

```typescript
export async function verifyDesignationInGrid(page: Page, name: string) {
    console.log(`  [Skill] Searching for Designation in grid...`);
    
    // Method 1: Use grid filter
    await page.click('kendo-grid-column-menu button');
    await page.fill('input[placeholder*="Filter"]', name);
    await page.waitForTimeout(1000);
    
    // Check if row exists
    const row = page.locator('kendo-grid tbody tr').first();
    const isVisible = await row.isVisible();
    
    if (!isVisible) {
        throw new Error(`Designation "${name}" not found in grid`);
    }
    
    console.log(`  [Skill] ✓ Designation found: ${name}`);
}
```

---

### Fix 3: Verify CREATE Actually Saves

Add API verification after CREATE:

```typescript
// After CREATE skill completes
await page.waitForTimeout(3000);

// Verify via API
const verifyResponse = await page.evaluate(async (testName) => {
    const response = await fetch('/v2_2api/api/designation/GetMoreDesignations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ IsInactive: false, OnlyInactive: false })
    });
    const json = await response.json();
    const designations = json.data.data;
    return designations.find((d: any) => d.Designation.includes(testName));
}, testData.Designation);

if (verifyResponse) {
    console.log('  [Test] ✅ Record verified via API:', verifyResponse.DesignationId);
} else {
    console.log('  [Test] ❌ Record NOT found via API');
    // Take screenshot, save diagnostic info
}
```

---

## 🎯 Next Steps

1. **Capture CREATE API Call**
   - Run network monitoring test with longer timeout
   - Find exact CREATE endpoint URL
   - Get request/response structure

2. **Verify Test Data**
   - Check if any test designations exist in API
   - List all `Design_*`, `Diagnose_*` records

3. **Fix Skills**
   - Update CREATE to use correct API endpoint
   - Update READ to search via API or grid filter
   - Add API verification after each operation

4. **Update Test Strategy**
   - Don't rely on database (GlobalHR uses separate DB)
   - Use API calls for verification
   - Use UI grid for visual confirmation

---

## 📞 Key Findings

| Finding | Impact |
|---------|--------|
| **Nested Response** (`data.data`) | Scripts expecting `data` will fail |
| **PascalCase Fields** | Scripts using `designation_name` will fail |
| **No Database Table** | Can't verify via PostgreSQL |
| **API Requires Auth** | Must be logged in to call API |
| **Grid Uses API** | UI grid calls `GetMoreDesignations` on load |

---

**Status:** ✅ API Structure Identified  
**Next:** Capture CREATE endpoint, fix skills, verify test data
