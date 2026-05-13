/**
 * GeneratedTestOrganizer
 *
 * Organizes generated tests into ticket-based folders with cleanup policy.
 * 
 * Before: tests/generated/ATT-15_1775463840320.spec.ts (flat, 38 files)
 * After:  tests/generated/ATT-15/latest.spec.ts (organized, max 3 per ticket)
 */

import * as fs from 'fs';
import * as path from 'path';

const GENERATED_DIR = path.join(process.cwd(), 'tests', 'generated');
const MAX_VERSIONS_PER_TICKET = 3; // Keep last N per ticket

export interface OrganizeResult {
  moved: number;
  cleaned: number;
  errors: string[];
  summary: string;
}

export class GeneratedTestOrganizer {

  /**
   * Move a newly generated test file into its ticket folder and enforce cleanup.
   * Called after each test generation to keep the directory organized.
   */
  static organizeGeneratedFile(filePath: string): void {
    const fileName = path.basename(filePath);
    const ticketId = this.extractTicketId(fileName);

    if (!ticketId) {
      // Can't determine ticket ID — leave in root
      return;
    }

    const ticketDir = path.join(GENERATED_DIR, ticketId);

    if (!fs.existsSync(ticketDir)) {
      fs.mkdirSync(ticketDir, { recursive: true });
    }

    // Copy as latest.spec.ts in ticket folder
    const destPath = path.join(ticketDir, 'latest.spec.ts');
    fs.copyFileSync(filePath, destPath);

    // Enforce version history: keep timestamped files, rotate old ones
    this.enforceRotationLimit(ticketDir);
  }

  /**
   * Full reorganization of existing flat directory.
   * Run once to clean up legacy files.
   */
  static reorganizeAll(): OrganizeResult {
    const result: OrganizeResult = { moved: 0, cleaned: 0, errors: [], summary: '' };

    if (!fs.existsSync(GENERATED_DIR)) {
      return { ...result, summary: 'No generated tests directory found' };
    }

    const files = fs.readdirSync(GENERATED_DIR)
      .filter(f => f.endsWith('.spec.ts'))
      .filter(f => fs.statSync(path.join(GENERATED_DIR, f)).isFile());

    for (const file of files) {
      try {
        const ticketId = this.extractTicketId(file);
        if (!ticketId) continue; // Skip files that don't match pattern

        const ticketDir = path.join(GENERATED_DIR, ticketId);
        if (!fs.existsSync(ticketDir)) {
          fs.mkdirSync(ticketDir, { recursive: true });
        }

        const srcPath = path.join(GENERATED_DIR, file);

        // Skip if it's already a 'latest.spec.ts' in a ticket folder
        if (file === 'latest.spec.ts') continue;

        // Move to ticket folder
        const destPath = path.join(ticketDir, file);
        fs.renameSync(srcPath, destPath);
        result.moved++;
      } catch (err: any) {
        result.errors.push(`Failed to move ${file}: ${err.message}`);
      }
    }

    // Enforce rotation limits for all ticket directories
    const ticketDirs = fs.readdirSync(GENERATED_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => path.join(GENERATED_DIR, d.name));

    for (const ticketDir of ticketDirs) {
      this.enforceRotationLimit(ticketDir);
    }

    result.summary = `Moved ${result.moved} files into ticket folders. ${result.cleaned} old versions cleaned up.`;
    return result;
  }

  /**
   * Extract ticket ID from filename patterns:
   *   ATT-15_1775463840320.spec.ts → ATT-15
   *   ATT-22_phase1_fixed.spec.ts → ATT-22
   *   ATT-COMPILE_1775789924154.spec.ts → ATT-COMPILE
   *   FALLBACK_1775631004276.spec.ts → FALLBACK
   */
  static extractTicketId(fileName: string): string | null {
    // Pattern: PREFIX_timestamp.spec.ts or PREFIX_suffix.spec.ts
    // PREFIX can contain hyphens (ATT-15) but stops at first underscore
    const match = fileName.match(/^([A-Z][A-Z0-9-]*?)_/);
    if (match) return match[1];

    return null;
  }

  /**
   * Keep only the last N versions per ticket directory.
   * Always preserves 'latest.spec.ts'.
   */
  private static enforceRotationLimit(ticketDir: string): void {
    const files = fs.readdirSync(ticketDir)
      .filter(f => f.endsWith('.spec.ts'))
      .filter(f => f !== 'latest.spec.ts') // Always preserve latest
      .sort() // Sort alphabetically (timestamp in name = chronological)
      .reverse(); // Newest first

    const toRemove = files.slice(MAX_VERSIONS_PER_TICKET);

    for (const file of toRemove) {
      try {
        fs.unlinkSync(path.join(ticketDir, file));
      } catch {
        // Ignore deletion errors
      }
    }
  }
}
