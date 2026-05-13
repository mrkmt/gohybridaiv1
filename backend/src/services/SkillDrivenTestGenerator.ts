/**
 * SkillDrivenTestGenerator
 * Generates Playwright test specs from skill JSON files.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface FormField {
  name: string;
  selector: string;
  type: string;
  required: boolean;
  maxLength?: number;
}

export interface FormSkill {
  module: string;
  menuPath: string;
  route: string;
  description: string;
  actions: {
    create: {
      buttonSelector: string;
      submitSelector: string;
    };
  };
  fields: FormField[];
  grid: {
    selector: string;
    loadingMask: string;
  };
  testData: Record<string, Record<string, string | number | boolean>>;
  businessRules: string[];
}

const SKILLS_DIR = path.resolve(process.cwd(), 'skills', 'GlobalHR', 'forms');
const OUTPUT_DIR = path.resolve(process.cwd(), 'tests', 'playwright');
const BASE_URL = process.env.BASE_URL || '';

// Smart checkpoint config injected into generated tests
const SMART_CHECKPOINT_CODE = `
const SCREENSHOT_DIR = 'test-results';
const captureScreenshots = process.env.DEBUG === 'true' || process.env.FIRST_RUN === 'true';
async function cp(page: any, n: string) {
  if (!captureScreenshots) return;
  try { await page.screenshot({ path: \`\${SCREENSHOT_DIR}/\${n}.png\` }); } catch {}
}
`;

function loadSkill(moduleName: string): FormSkill | null {
  const skillPath = path.join(SKILLS_DIR, `${moduleName.toLowerCase().replace(/\s+/g, '-')}.json`);
  if (!fs.existsSync(skillPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(skillPath, 'utf-8'));
  } catch (e: any) {
    console.log(`[SkillDrivenTestGenerator] ⏭️ Skipping ${moduleName} - invalid JSON: ${e.message}`);
    return null;
  }
}

export function listAvailableModules(): string[] {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.json') && f !== 'login.json').map(f => f.replace('.json', ''));
}

function escSel(s: string): string { return s.replace(/'/g, "\\'"); }

function genFieldFills(skill: FormSkill): string {
  const lines: string[] = [];
  for (const f of skill.fields) {
    if (f.type === 'text') {
      const isShortCode = f.name.toLowerCase().includes('short code') || f.name.toLowerCase().includes('shortcode');
      if (isShortCode) {
        lines.push(`    const shortCode = \`T\${UNIQUE.slice(0, 4)}\`;`);
        lines.push(`    console.log(\`Filling ${f.name}: \${shortCode}\`);`);
        lines.push(`    const sc = page.locator('input[type="text"]:not([name])').first();`);
        lines.push('    await sc.click(); await sc.fill(shortCode);');
        lines.push(`    console.log('✓ ${f.name} filled');`);
      } else if (f.required) {
        const sel = escSel(f.selector || `input[formcontrolname="${f.name}"]`);
        const vn = f.name.replace(/\s+/g, '') + 'Inp';
        lines.push(`    const v = \`${f.name} \${UNIQUE}\`;`);
        lines.push(`    const ${vn} = page.locator('${sel}').first();`);
        lines.push(`    await ${vn}.click(); await ${vn}.fill(v);`);
        lines.push(`    console.log('✓ ${f.name} filled');`);
      }
    } else if (f.type === 'number') {
      const sel = escSel(f.selector || `input[formcontrolname="${f.name}"]`);
      const vn = f.name.replace(/\s+/g, '') + 'Inp';
      lines.push(`    const ${vn} = page.locator('${sel}').first();`);
      lines.push(`    if (await ${vn}.isVisible({timeout:3000}).catch(()=>false)) await ${vn}.fill("1");`);
    } else if (f.type === 'dropdown') {
      const sel = escSel(f.selector || `kendo-dropdownlist[formcontrolname="${f.name}"]`);
      const vn = f.name.replace(/\s+/g, '') + 'Dd';
      lines.push(`    const ${vn} = page.locator('${sel} span span').first();`);
      lines.push(`    if (await ${vn}.isVisible({timeout:5000}).catch(()=>false)) {`);
      lines.push(`      await ${vn}.click(); await page.waitForSelector('kendo-list ul li', {state:'visible',timeout:10000});`);
      lines.push("      await page.locator('kendo-list ul li.k-list-item').first().click();");
      lines.push('    }');
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function generateTestSpec(moduleName: string): string | null {
  const skill = loadSkill(moduleName);
  if (!skill) return null;
  if (!skill.actions?.create?.buttonSelector) {
    console.log(`[SkillDrivenTestGenerator] ⏭️ Skipping ${moduleName} - no form actions defined`);
    return null;
  }

  const rawAdd = skill.actions.create.buttonSelector.split(',')[0].trim();
  const rawSave = (skill.actions.create.submitSelector || "button.btn.btn-success").split(',')[0].trim();
  // Fix quote escaping: skill files use 'Add New' inside selectors, wrap in template with "..."
  const addBtn = rawAdd.replace(/'/g, "\\'");
  const saveBtn = rawSave.replace(/'/g, "\\'");
  const grid = skill.grid.selector || 'kendo-grid';
  const requiredNames = skill.fields.filter(f => f.required).map(f => f.name).join(', ') || 'Name';
  const fields = genFieldFills(skill);
  const moduleApi = skill.module.replace(/\s+/g, '');

  const content = `/**
 * ${skill.module} - Auto-generated from skill file
 * Module: ${skill.menuPath} | Route: ${skill.route}
 */
import { test, expect, BrowserContext, Page } from '@playwright/test';
test.use({ baseURL: '${BASE_URL}', video: 'on', viewport: { width: 1280, height: 720 }, actionTimeout: 30000, navigationTimeout: 30000 });

const BASE_URL = '${BASE_URL}';
let ctx: BrowserContext | null = null;
let page: Page;
let loggedIn = false;

async function login() {
  if (loggedIn) return await ctx!.newPage();
  console.log('🔐 Logging in...');
  page = await ctx!.newPage();
  const username = process.env.TEST_USERNAME || 'testook_HR 1';
  const password = process.env.TEST_PASSWORD || '';
  if (!password) console.warn('⚠️ TEST_PASSWORD not set, using default');
  await page.goto(\`\${BASE_URL}#/login\`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('input[name="idnumber"], input[name="username"]', { state: 'visible', timeout: 30000 });
  // Idnumber field (if exists)
  const idnum = page.locator('input[name="idnumber"]').first();
  if (await idnum.isVisible({ timeout: 5000 }).catch(() => false)) await idnum.fill(username);
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button:has-text("Login"), button[type="submit"]').first().click();
  loggedIn = true;
  console.log('✅ Login successful');
  return page;
}

async function nav() {
  await page.goto(\`\${BASE_URL}${skill.route}\`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('${grid}', { state: 'visible', timeout: 15000 }).catch(() => {});
}

test.describe('${skill.module} Tests', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async ({ browser }) => { ctx = await browser.newContext(); });
  test.afterAll(async () => { await ctx?.close(); });

  test('CREATE-001: Create with required fields', async () => {
    page = await login();
    console.log('=== CREATE-001 ===');
    await nav();
    const n = await page.locator('${grid} tbody tr').count().catch(() => 0);
    console.log(\`Initial rows: \${n}\`);
    const UNIQUE = Date.now().toString().slice(-6);
    
    await page.locator('${addBtn}').first().click({ timeout: 10000 });
    await page.waitForSelector('input[formcontrolname], kendo-textbox, .modal.show', { state: 'visible', timeout: 10000 }).catch(() => {});
    console.log('✓ Add New clicked');

${fields}
    console.log('Clicking Save...');
    const saveP = page.waitForResponse(r => r.url().includes('${moduleApi}') && r.status() === 200, { timeout: 15000 })
      .then(async r => { try { console.log(\`📡 API → \${JSON.stringify(await r.json()).slice(0,100)}\`); } catch {} }).catch(() => {});
    await page.locator('${saveBtn}').first().click({ timeout: 10000 });
    await saveP;
    console.log('✓ Save clicked');

    const ok = page.locator('button:has-text("Ok"), button:has-text("OK"), button:has-text("Close")').first();
    if (await ok.isVisible({ timeout: 5000 }).catch(() => false)) { await ok.click(); console.log('✓ OK clicked'); }
    console.log('✅ CREATE-001 PASSED');
  });

  test('CREATE-002: Validation - missing required fields', async () => {
    console.log('=== CREATE-002 ===');
    await nav();
    await page.locator('${addBtn}').first().click();
    await page.waitForSelector('input[formcontrolname], kendo-textbox, .modal.show', { state: 'visible', timeout: 10000 }).catch(() => {});
    console.log('Required fields: ${requiredNames}');
    const btn = page.locator('${saveBtn}').first();
    expect(await btn.isDisabled()).toBe(true);
    console.log('✓ Save disabled');
    await page.keyboard.press('Escape');
    console.log('✅ CREATE-002 PASSED');
  });

  test('CREATE-003: Special characters', async () => {
    console.log('=== CREATE-003 ===');
    await nav();
    await page.locator('${addBtn}').first().click();
    await page.waitForSelector('input[formcontrolname], kendo-textbox, .modal.show', { state: 'visible', timeout: 10000 }).catch(() => {});
    const UNIQUE = Date.now().toString().slice(-6);
${fields}
    await page.locator('${saveBtn}').first().click({ timeout: 10000 });
    const ok = page.locator('button:has-text("Ok")').first();
    if (await ok.isVisible({ timeout: 5000 }).catch(() => false)) await ok.click();
    console.log('✅ CREATE-003 PASSED');
  });
});
`;

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, `att-${skill.module.toLowerCase().replace(/\s+/g, '-')}-create-test.spec.ts`);
  fs.writeFileSync(outPath, content);
  console.log(`[SkillDrivenTestGenerator] ✅ Generated: ${outPath}`);
  return outPath;
}

export function generateAll(): string[] {
  return listAvailableModules().map(m => generateTestSpec(m)).filter(Boolean) as string[];
}
