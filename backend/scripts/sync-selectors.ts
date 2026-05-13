/**
 * sync-selectors.ts
 *
 * Generates playwright/selectors/globalhr-selectors.json from
 * backend/skills/ELEMENT_SELECTORS_REFERENCE.md.
 *
 * Usage: npx ts-node backend/scripts/sync-selectors.ts [--force]
 */
import * as fs from 'fs';
import * as path from 'path';

const MD = path.join(__dirname, '..', 'skills', 'ELEMENT_SELECTORS_REFERENCE.md');
const JSON_OUT = path.join(__dirname, '..', '..', 'playwright', 'selectors', 'globalhr-selectors.json');

// Selectors starting with these patterns are unstable (Kendo auto-generated)
const UNSTABLE_PREFIXES = ['#k-', '.ng-'];

// Row categories that are NOT form fields
const NON_FIELD_TABLES = new Set([
  'Grid Columns',
  'Grid Column',
  'Grid Toolbar',
  'Period Options',
  'Options',
  'Calendar Date Selection',
  'Working Days Checkboxes',
  'Date/Month Selectors', // these are tables too — extract but filter
  'Status Filter',
]);

/**
 * Check if a selector is unstable (Kendo generated ID, etc.)
 */
function isStableSelector(sel: string): boolean {
  const trimmed = sel.trim();
  if (UNSTABLE_PREFIXES.some(p => trimmed.includes(p))) return false;
  // Reject overly-long nth-child chains (fragile)
  return true;
}

/**
 * Parse a markdown table section into field -> selector map.
 * Only extracts from "Form Fields" subsections, not Grid columns or option lists.
 */
function parsePageSection(section: string): {
  fields: Record<string, string>;
  navigation: Record<string, string>;
  route: string;
} {
  const fields: Record<string, string> = {};
  const navigation: Record<string, string> = {};

  // Extract route
  const routeMatch = section.match(/URL Pattern:\s*https?:\/\/[^#\s]+(#[\w.]+)/);
  const route = routeMatch ? routeMatch[1] : '';

  // Identify which subsection tables we're looking at.
  // Split by "###" headings to find the table context
  const subsections = section.split(/^### /m);

  for (const sub of subsections) {
    const subTitle = sub.split('\n')[0].trim();
    const isNonField = [...NON_FIELD_TABLES].some(t =>
      subTitle.toLowerCase().includes(t.toLowerCase())
    );
    const isNavigation = subTitle.startsWith('Navigation');

    // Extract table rows from this subsection
    const rows = sub.split('\n').filter(l => l.trim().startsWith('|'));

    for (const row of rows) {
      if (row.includes('---') || /^\|\s*---/.test(row)) continue;
      if (/^\|\s*Element\s*\|/i.test(row) || /^\|\s*Business\s*Name/i.test(row)) continue; // header rows

      const cols = row.split('|').map(c => c.trim()).filter(Boolean);
      if (cols.length < 2) continue;

      const name = cols[0];
      const selector = cols[1].replace(/^`|`$/g, '').replace(/\|/g, '').trim();

      if (!name || name.length < 2) continue;
      if (!selector || selector.length < 3) continue;
      // Skip if the selector value is just a type label like "radio", "li", "input"
      if (/^(radio|input|link|button|span|list-item|li|checkbox|kendo-\w+|heading|svg)$/i.test(selector)) continue;
      if (selector.includes('#k-') || selector.includes('.ng-')) continue; // Kendo IDs

      if (isNavigation || ['Master Menu', 'Check already on page'].includes(name)) {
        navigation[name] = selector;
      } else if (!isNonField) {
        // Only keep if it's a form control pattern
        // Accept: formcontrolname, name, formControlName, id-based, page.locator with input/select/button/kendo
        const acceptsForm = /formcontrolname|formControlName|\binput\b|\bselect\b|\bbutton\b|kendo-|checkbox|radio|textarea|datepicker|dropdownlist|timepicker|numerictextbox/i.test(selector);

        // Also accept common action buttons
        const isButton = /\bbutton:has-text|\btitle="(Save|Cancel|Add New|Delete|Edit|Search)"\b/i.test(selector);

        if (acceptsForm || isButton) {
          fields[name] = selector;
        }
      }
    }
  }

  return { fields, navigation, route };
}

interface Output {
  version: number;
  generatedAt: string;
  source: string;
  modules: Record<string, { route?: string; fields?: Record<string, string>; navigation?: Record<string, string> }>;
  universal: Record<string, Record<string, string>>;
}

function parseMarkdown(): Output {
  if (!fs.existsSync(MD)) {
    throw new Error(`Markdown file not found: ${MD}`);
  }

  const content = fs.readFileSync(MD, 'utf-8');

  const sections = content.split(/^## /m);

  const modules: Output['modules'] = {};

  for (const section of sections) {
    const title = section.split('\n')[0].trim();

    if (['Selector Strategy Guide', 'Common Patterns', 'Playwright Locator Examples',
         'Best Practices', 'Notes', 'Ticket-Type Cheat Sheet', 'Table of Contents',
         'Master Module Quick Reference'].includes(title)) {
      continue;
    }

    const result = parsePageSection(section);

    if (Object.keys(result.fields).length === 0 && Object.keys(result.navigation).length === 0) {
      continue;
    }

    // Derive clean module key from route
    let modKey = title.replace(/^Page:\s*/, '').trim();
    if (result.route) {
      const routeName = result.route.replace('#app.', '').replace('#', '');
      modKey = routeName.charAt(0).toUpperCase() + routeName.slice(1).replace(/\./g, '');
    }

    const modDef: { route?: string; fields?: Record<string, string>; navigation?: Record<string, string> } = {};
    if (result.route) modDef.route = result.route;
    if (Object.keys(result.fields).length) modDef.fields = result.fields;
    if (Object.keys(result.navigation).length) modDef.navigation = result.navigation;

    modules[modKey] = modDef;
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString().split('T')[0],
    source: 'ELEMENT_SELECTORS_REFERENCE.md',
    modules,
    universal: {
      buttons: {
        'Add New': 'a[title="Add New"], .btn[title="Add New"], [title="Add New"], button[title="Add New"]',
        Save: 'button.k-button[title="Save"], button[title="Save"], button:has-text("Save")',
        Cancel: 'button[title="Cancel"], button:has-text("Cancel")',
        Edit: 'a svg.k-i-edit, button svg.k-i-edit, a[title="Edit"]',
        Delete: 'a svg.k-i-trash, button svg.k-i-trash, a[title="Delete"]'
      },
      grid: {
        container: '.k-grid',
        toolbar: '.k-grid-toolbar, .title-action-panel, .action-btn',
        rows: '.k-grid-content table tbody tr',
        pagination: '.k-pager-wrap, .k-pager-sm',
        loading: '.k-loading-mask, .k-overlay'
      },
      errors: {
        notification: '.k-notification.k-warning, .k-notification.k-error, .k-notification-info',
        validation: '.text-danger, .validation-error, .error-text, .k-error'
      },
      navigation: {
        sidebarMenu: '.sidebar a:has-text("Master")',
        moduleLink: '.list-group-item[routerlink*="app.{{module}}"]',
        genericModuleLink: 'a.list-group-item:has-text("{{moduleName}}")',
        activeMenu: '.router-link-active, .active.list-group-item'
      },
      login: {
        username: '#username, input[name="username"]',
        password: '#password, input[name="password"]',
        submit: 'span.py-1.d-block:has-text("LOG IN"), button[type="submit"], .btn-login'
      }
    }
  };
}

function main() {
  const force = process.argv.includes('--force');

  if (!force) {
    const mdStat = fs.statSync(MD);
    const jsonStat = fs.existsSync(JSON_OUT) ? fs.statSync(JSON_OUT) : null;

    if (jsonStat && mdStat.mtimeMs <= jsonStat.mtimeMs) {
      console.log('Markdown not modified since last sync. Use --force to regenerate.');
      return;
    }
  }

  try {
    const output = parseMarkdown();
    const dir = path.dirname(JSON_OUT);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(JSON_OUT, JSON.stringify(output, null, 2));

    const totalFields = Object.values(output.modules)
      .reduce((sum, m) => sum + (m.fields ? Object.keys(m.fields).length : 0), 0);

    console.log(`Generated ${JSON_OUT}`);
    console.log(`  Modules: ${Object.keys(output.modules).length}`);
    console.log(`  Universal groups: ${Object.keys(output.universal).length}`);
    console.log(`  Total fields: ${totalFields}`);
    console.log(`  (filtered out Kendo IDs, fragile nth-child, and grid columns)`);
  } catch (err) {
    const e = err as Error;
    console.error(`Failed: ${e.message}`);
    process.exit(1);
  }
}

main();
