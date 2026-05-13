/**
 * SourceCodeComponentParser — Static Selector Discovery from Frontend Code
 *
 * D5: Source Code Component Parser
 *
 * Parses Angular/TypeScript component files (.ts, .tsx, .html) to pre-discover
 * selectors BEFORE running the browser-based page discovery. This gives the AI
 * test generator a head start with selectors that are baked into the source code.
 *
 * Supports:
 * - Angular templates: [formControlName], formControlName="X", [(ngModel)]="X"
 * - HTML attributes: id, name, data-testid, aria-label, role
 * - Kendo UI: kendoTextBox, kendoDropDownList, kendoGrid
 * - Angular Material: mat-button, mat-input, mat-select
 * - Component class: @ViewChild selectors, ElementRef queries
 *
 * Output: Structured element inventory with selectors, source file, and confidence.
 */

import * as fs from 'fs';
import * as path from 'path';
import { appLogger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoveredElement {
  /** Element tag name (input, button, select, kendo-dropdown, etc.) */
  tagName: string;
  /** Best Playwright selector */
  selector: string;
  /** Selector type */
  selectorType: 'formControlName' | 'ngModel' | 'id' | 'name' | 'data-testid' | 'aria-label' | 'role' | 'kendo' | 'mat' | 'class' | 'css';
  /** Human-readable label (innerText, placeholder, aria-label) */
  label: string;
  /** Module this element belongs to */
  module: string;
  /** Source file where found */
  sourceFile: string;
  /** Confidence: how reliable is this selector? */
  confidence: number;
  /** Action type this element supports */
  possibleActions: ('fill' | 'click' | 'select' | 'check')[];
  /** Raw HTML/TS snippet for debugging */
  rawSnippet?: string;
}

export interface ParseResult {
  module: string;
  elements: DiscoveredElement[];
  sourceFiles: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Regex Patterns
// ---------------------------------------------------------------------------

/** Angular [formControlName] or formControlName="..." */
const FORM_CONTROL_PATTERN = /\[?formControlName\]?=["']([^"']+)["']/gi;

/** [(ngModel)]="..." */
const NG_MODEL_PATTERN = /\[\(ngModel\)\]="([^"]+)"/gi;

/** id="..." */
const ID_PATTERN = /\bid=["']([^"']+)["']/gi;

/** name="..." */
const NAME_PATTERN = /\bname=["']([^"']+)["']/gi;

/** data-testid="..." */
const TESTID_PATTERN = /\bdata-testid=["']([^"']+)["']/gi;

/** aria-label="..." */
const ARIA_LABEL_PATTERN = /\baria-label=["']([^"']+)["']/gi;

/** role="..." */
const ROLE_PATTERN = /\brole=["']([^"']+)["']/gi;

/** Kendo UI components */
const KENDO_PATTERN = /kendo(?:TextBox|DropDownList|DatePicker|NumericTextBox|Grid|Button|CheckBox|ComboBox|AutoComplete|TimePicker|Upload|MaskedTextBox|Switch)/gi;

/** Angular Material components */
const MAT_PATTERN = /mat-(?:button|input|select|checkbox|radio|datepicker|dialog|card|toolbar|list|menu|sidenav|tabs)/gi;

/** @ViewChild('...') */
const VIEW_CHILD_PATTERN = /@ViewChild\(["']([^"']+)["']\)/gi;

/** Placeholder text */
const PLACEHOLDER_PATTERN = /\bplaceholder=["']([^"']+)["']/gi;

/** Button/link text content (simplified) */
const BUTTON_TEXT_PATTERN = /(?:<button[^>]*>|<a[^>]*>)([^<]{1,80})(?:<\/button>|<\/a>)/gi;

// ---------------------------------------------------------------------------
// Parsing Logic
// ---------------------------------------------------------------------------

/**
 * Parse a single file and extract actionable element selectors.
 */
function parseFile(filePath: string, moduleName: string): DiscoveredElement[] {
  const elements: DiscoveredElement[] = [];

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Scan line by line for better source context
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      const lineSnippet = line.trim();

      // formControlName → highest confidence for Angular reactive forms
      for (const match of line.matchAll(FORM_CONTROL_PATTERN)) {
        const value = match[1];
        const tag = inferTagFromContext(line);
        elements.push({
          tagName: tag,
          selector: `[formcontrolname="${value}"]`,
          selectorType: 'formControlName',
          label: value,
          module: moduleName,
          sourceFile: filePath,
          confidence: 0.95,
          possibleActions: tag === 'button' ? ['click'] : ['fill'],
          rawSnippet: lineSnippet,
        });
      }

      // ngModel
      for (const match of line.matchAll(NG_MODEL_PATTERN)) {
        const value = match[1];
        const tag = inferTagFromContext(line);
        elements.push({
          tagName: tag,
          selector: `[ng-reflect-model="${value}"]`,
          selectorType: 'ngModel',
          label: value,
          module: moduleName,
          sourceFile: filePath,
          confidence: 0.85,
          possibleActions: ['fill'],
          rawSnippet: lineSnippet,
        });
      }

      // data-testid → best for testing
      for (const match of line.matchAll(TESTID_PATTERN)) {
        const value = match[1];
        const tag = inferTagFromContext(line);
        elements.push({
          tagName: tag,
          selector: `[data-testid="${value}"]`,
          selectorType: 'data-testid',
          label: value,
          module: moduleName,
          sourceFile: filePath,
          confidence: 0.98,
          possibleActions: inferActionsForTag(tag),
          rawSnippet: lineSnippet,
        });
      }

      // id
      for (const match of line.matchAll(ID_PATTERN)) {
        const value = match[1];
        if (value.startsWith('mat') || value.startsWith('kendo')) continue; // Skip generated IDs
        const tag = inferTagFromContext(line);
        elements.push({
          tagName: tag,
          selector: `#${value}`,
          selectorType: 'id',
          label: value,
          module: moduleName,
          sourceFile: filePath,
          confidence: 0.8,
          possibleActions: inferActionsForTag(tag),
          rawSnippet: lineSnippet,
        });
      }

      // Kendo components
      for (const match of line.matchAll(KENDO_PATTERN)) {
        const component = match[0];
        const label = extractLabelFromKendo(line, component);
        elements.push({
          tagName: component.toLowerCase(),
          selector: getKendoSelector(component, line),
          selectorType: 'kendo',
          label,
          module: moduleName,
          sourceFile: filePath,
          confidence: 0.9,
          possibleActions: getKendoActions(component),
          rawSnippet: lineSnippet,
        });
      }

      // Angular Material
      for (const match of line.matchAll(MAT_PATTERN)) {
        const component = match[0];
        const label = extractLabelFromContext(line);
        elements.push({
          tagName: component.toLowerCase(),
          selector: `${component}`,
          selectorType: 'mat',
          label,
          module: moduleName,
          sourceFile: filePath,
          confidence: 0.85,
          possibleActions: getMatActions(component),
          rawSnippet: lineSnippet,
        });
      }

      // @ViewChild
      for (const match of line.matchAll(VIEW_CHILD_PATTERN)) {
        const value = match[1];
        elements.push({
          tagName: 'unknown',
          selector: `#template-ref-${value}`,
          selectorType: 'class',
          label: `ViewChild: ${value}`,
          module: moduleName,
          sourceFile: filePath,
          confidence: 0.5,
          possibleActions: ['click'],
          rawSnippet: lineSnippet,
        });
      }

      // aria-label
      for (const match of line.matchAll(ARIA_LABEL_PATTERN)) {
        const value = match[1];
        const tag = inferTagFromContext(line);
        elements.push({
          tagName: tag,
          selector: `[aria-label="${value}"]`,
          selectorType: 'aria-label',
          label: value,
          module: moduleName,
          sourceFile: filePath,
          confidence: 0.9,
          possibleActions: inferActionsForTag(tag),
          rawSnippet: lineSnippet,
        });
      }
    }
  } catch (err: any) {
    appLogger.warn(`[SourceCodeParser] Failed to parse ${filePath}: ${err.message}`);
  }

  return elements;
}

/**
 * Infer the HTML tag from surrounding context.
 */
function inferTagFromContext(line: string): string {
  const lower = line.toLowerCase();
  if (/<input\b/.test(lower)) return 'input';
  if (/<button\b/.test(lower) || /kendoButton/.test(line)) return 'button';
  if (/<select\b/.test(lower) || /kendoDropDownList/.test(line)) return 'select';
  if (/<textarea\b/.test(lower)) return 'textarea';
  if (/<kendo-grid\b/.test(lower) || /kendoGrid/.test(line)) return 'kendo-grid';
  if (/<mat-/.test(lower)) {
    const matMatch = lower.match(/<(mat-[\w-]+)/);
    return matMatch ? matMatch[1] : 'mat-component';
  }
  return 'input'; // Default
}

/**
 * Infer possible actions based on tag type.
 */
function inferActionsForTag(tag: string): ('fill' | 'click' | 'select' | 'check')[] {
  if (tag === 'button' || tag.includes('button')) return ['click'];
  if (tag === 'select' || tag.includes('dropdown') || tag.includes('drop-down')) return ['select'];
  if (tag === 'input' || tag === 'textarea') return ['fill'];
  if (tag.includes('checkbox') || tag.includes('switch')) return ['check'];
  return ['click', 'fill'];
}

/**
 * Extract a human-readable label from Kendo component context.
 */
function extractLabelFromKendo(line: string, component: string): string {
  // Look for [placeholder], [label], or nearby text
  const placeholderMatch = line.match(/placeholder=["']([^"']+)["']/);
  if (placeholderMatch) return placeholderMatch[1];

  const labelMatch = line.match(/\[label\]=["']([^"']+)["']/);
  if (labelMatch) return labelMatch[1];

  return component;
}

/**
 * Build a Playwright selector for a Kendo component.
 */
function getKendoSelector(component: string, line: string): string {
  // Try formControlName first
  const fcMatch = line.match(/formControlName=["']([^"']+)["']/);
  if (fcMatch) return `[formcontrolname="${fcMatch[1]}"]`;

  // Try placeholder
  const phMatch = line.match(/placeholder=["']([^"']+)["']/);
  if (phMatch) return `[placeholder="${phMatch[1]}"]`;

  // Fallback to component tag
  return component.toLowerCase();
}

/**
 * Get actions for a Kendo component.
 */
function getKendoActions(component: string): ('fill' | 'click' | 'select' | 'check')[] {
  if (component.includes('Button')) return ['click'];
  if (component.includes('DropDown') || component.includes('ComboBox') || component.includes('AutoComplete')) return ['select'];
  if (component.includes('TextBox') || component.includes('Numeric') || component.includes('Mask')) return ['fill'];
  if (component.includes('CheckBox') || component.includes('Switch')) return ['check'];
  if (component.includes('Grid')) return ['click'];
  if (component.includes('DatePicker') || component.includes('TimePicker')) return ['click', 'fill'];
  return ['click'];
}

/**
 * Get actions for an Angular Material component.
 */
function getMatActions(component: string): ('fill' | 'click' | 'select' | 'check')[] {
  if (component.includes('button')) return ['click'];
  if (component.includes('input')) return ['fill'];
  if (component.includes('select')) return ['select'];
  if (component.includes('checkbox')) return ['check'];
  if (component.includes('radio')) return ['click'];
  return ['click'];
}

/**
 * Extract a label from general HTML context.
 */
function extractLabelFromContext(line: string): string {
  const textMatch = line.match(/>([^<]{1,60})</);
  if (textMatch) return textMatch[1].trim();
  return '';
}

// ---------------------------------------------------------------------------
// Module Discovery
// ---------------------------------------------------------------------------

/**
 * Find all component files for a given module.
 * Searches for module-named directories containing component.html or component.ts files.
 */
function findComponentFiles(moduleName: string, sourceDir: string): string[] {
  const files: string[] = [];

  if (!fs.existsSync(sourceDir)) return files;

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules, dist, .git
        if (['node_modules', 'dist', '.git', '.angular', 'coverage'].includes(entry.name)) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        // Match component HTML or TS files
        if (/\.component\.(html|ts)$/.test(entry.name)) {
          // Check if module name appears in path or filename
          if (
            fullPath.toLowerCase().includes(moduleName.toLowerCase()) ||
            entry.name.toLowerCase().includes(moduleName.toLowerCase())
          ) {
            files.push(fullPath);
          }
        }
      }
    }
  }

  walk(sourceDir);
  return files;
}

/**
 * Discover modules by scanning the source directory.
 */
function discoverModules(sourceDir: string): string[] {
  const modules = new Set<string>();

  if (!fs.existsSync(sourceDir)) return [];

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', '.git', '.angular', 'coverage', 'e2e'].includes(entry.name)) continue;
        walk(fullPath);
      } else if (entry.isFile() && /\.component\.html$/.test(entry.name)) {
        // Extract module name from directory structure
        const relative = path.relative(sourceDir, fullPath);
        const parts = relative.split(path.sep);
        // Module is typically the parent of the component file
        if (parts.length >= 2) {
          modules.add(parts[parts.length - 2]);
        }
      }
    }
  }

  walk(sourceDir);
  return Array.from(modules);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class SourceCodeComponentParser {

  /**
   * Parse all component files for a specific module.
   *
   * @param moduleName - Module name (e.g., "Department", "Leave")
   * @param sourceDir - Path to frontend source directory
   * @returns ParseResult with discovered elements
   */
  static parseModule(moduleName: string, sourceDir: string): ParseResult {
    const sourceFiles = findComponentFiles(moduleName, sourceDir);
    const elements: DiscoveredElement[] = [];
    const errors: string[] = [];

    for (const file of sourceFiles) {
      const found = parseFile(file, moduleName);
      elements.push(...found);
      if (found.length === 0) {
        errors.push(`No actionable elements found in ${path.relative(sourceDir, file)}`);
      }
    }

    // Deduplicate: same selector + same module = keep highest confidence
    const deduped = deduplicateElements(elements);

    return {
      module: moduleName,
      elements: deduped,
      sourceFiles,
      errors,
    };
  }

  /**
   * Parse all discovered modules from a source directory.
   */
  static parseAllModules(sourceDir: string): ParseResult[] {
    const modules = discoverModules(sourceDir);
    return modules.map(mod => this.parseModule(mod, sourceDir));
  }

  /**
   * Build AI prompt context from parsed source code selectors.
   * Injected into test generation prompts.
   */
  static buildPromptContext(moduleName: string, sourceDir: string): string {
    const result = this.parseModule(moduleName, sourceDir);
    if (result.elements.length === 0) return '';

    const lines = result.elements
      .filter(e => e.confidence >= 0.8) // Only high-confidence selectors
      .map(e => {
        const actions = e.possibleActions.join(', ');
        return `- \`${e.selector}\` → ${e.label} (${e.tagName}, actions: ${actions}, confidence: ${e.confidence.toFixed(2)})`;
      });

    return `\n\n## Source Code Selectors for ${moduleName}\nFound ${result.elements.length} elements in ${result.sourceFiles.length} files:\n${lines.join('\n')}`;
  }

  /**
   * Get stats about parsed source code.
   */
  static getStats(sourceDir: string): { modules: number; totalElements: number; highConfidence: number; files: number } {
    const results = this.parseAllModules(sourceDir);
    let totalElements = 0;
    let highConfidence = 0;
    let totalFiles = 0;

    for (const r of results) {
      totalElements += r.elements.length;
      highConfidence += r.elements.filter(e => e.confidence >= 0.8).length;
      totalFiles += r.sourceFiles.length;
    }

    return {
      modules: results.length,
      totalElements,
      highConfidence,
      files: totalFiles,
    };
  }
}

/**
 * Deduplicate elements: same selector + same module → keep highest confidence.
 */
function deduplicateElements(elements: DiscoveredElement[]): DiscoveredElement[] {
  const map = new Map<string, DiscoveredElement>();

  for (const el of elements) {
    const key = `${el.module}:${el.selector}`;
    const existing = map.get(key);
    if (!existing || el.confidence > existing.confidence) {
      map.set(key, el);
    }
  }

  return Array.from(map.values());
}
