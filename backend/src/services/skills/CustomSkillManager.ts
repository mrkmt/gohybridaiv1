import * as fs from 'fs';
import * as path from 'path';
import { appLogger } from '../../utils/logger';

export interface CustomSkill {
    id: string;
    name: string;
    description: string;
    content: string;
}

export const SKILL_MANAGER_CONFIG = {
  // Was: 20 — caused "Max files limit reached" with docs/ in the path
  maxFiles: 50,

  // Was: 5,000 chars — caused all module knowledge files to be truncated
  // Raise to 8,000 but only for module-specific JSON files
  maxFileBytesJson: 8_000,

  // Markdown files (skills, standards) keep lower limit
  maxFileBytesMarkdown: 4_000,

  // MAX total chars injected from custom skills into any one prompt
  // Hard cap regardless of how many files are loaded
  MAX_SKILL_PAYLOAD: 12_000,

  // Blacklisted directories — never scan these at the TOP LEVEL of a
  // configured skill path. Nested directories with these names (e.g.
  // `skills/my-module/src/rules.json`) are still scanned — the blacklist
  // only exists to skip over whole repo/source trees, not to hide nested
  // user content.
  directoryBlacklist: [
    'docs', 'node_modules', 'dist', 'build', '.git',
    'src', 'api', 'tests', 'scripts', 'migrations',
    '.claude', '.cursor', '.qwen',
  ],

  // How deep below a configured skill root we still treat as "top level"
  // for blacklist purposes. 1 means only the direct children of a skill
  // root are filtered.
  blacklistDepth: 1,
};

/**
 * Check if a directory should be skipped during skill scanning.
 *
 * @param dirName - the directory basename (not full path)
 * @param depth - how many levels deep we are below the configured skill root.
 *   Only directories at depth <= blacklistDepth are filtered.
 */
export function isBlacklistedSkillDir(dirName: string, depth = 0): boolean {
  if (depth > SKILL_MANAGER_CONFIG.blacklistDepth) return false;
  const lower = dirName.toLowerCase();
  return SKILL_MANAGER_CONFIG.directoryBlacklist.some(b => lower === b || lower.startsWith(b + '/'));
}

/**
 * CustomSkillManager
 * 
 * Manages user-defined custom skills loaded from local file paths.
 * These skills are used to enrich AI prompts with domain-specific knowledge.
 */
export class CustomSkillManager {
    private static customPaths: string[] = [];
    private static skillsCache: CustomSkill[] = [];

    /**
     * Sets the paths to scan for custom skill files (.json).
     */
    static setCustomPaths(paths: string[]): void {
        this.customPaths = paths;
        this.reloadSkills();
    }

    /**
     * Returns all currently loaded custom skills.
     */
    static getAllSkills(): CustomSkill[] {
        if (this.skillsCache.length === 0) {
            this.reloadSkills();
        }
        return this.skillsCache;
    }

    /**
     * Scans the configured paths and reloads skills into memory.
     */
    static reloadSkills(): void {
        const skills: CustomSkill[] = [];
        // Use a shared counter box so recursive scans see the same count.
        // Previously `fileCount` was passed by value — recursion reset it and
        // the cap silently blew past on deep trees.
        const counter = { value: 0 };

        for (const dir of this.customPaths) {
            try {
                if (!fs.existsSync(dir)) continue;
                this.scanDirectory(dir, skills, counter, 1);
            } catch (err: any) {
                appLogger.error(`[CustomSkill] Failed to read directory ${dir}`, { error: err.message });
            }
        }

        this.skillsCache = skills;
        appLogger.info(`[CustomSkill] Loaded ${this.skillsCache.length} custom skills from paths: ${this.customPaths.join(', ')}.`);
    }

    private static scanDirectory(dir: string, skills: CustomSkill[], counter: { value: number }, depth = 1): void {
        if (counter.value >= SKILL_MANAGER_CONFIG.maxFiles) return;

        const files = fs.readdirSync(dir);
        for (const file of files) {
            if (counter.value >= SKILL_MANAGER_CONFIG.maxFiles) break;

            const filePath = path.join(dir, file);
            const stats = fs.statSync(filePath);

            if (stats.isDirectory()) {
                if (!isBlacklistedSkillDir(file, depth)) {
                    this.scanDirectory(filePath, skills, counter, depth + 1);
                }
                continue;
            }

            if (file.endsWith('.json') || file.endsWith('.md')) {
                try {
                    const isJson = file.endsWith('.json');
                    const maxBytes = isJson ? SKILL_MANAGER_CONFIG.maxFileBytesJson : SKILL_MANAGER_CONFIG.maxFileBytesMarkdown;

                    if (stats.size > maxBytes) {
                        appLogger.warn(`[CustomSkill] Skipping ${file} - size (${stats.size}) exceeds limit (${maxBytes})`);
                        continue;
                    }

                    // B4: Read as a Buffer first so we can detect binary/encrypted
                    // content before attempting UTF-8 decode or JSON parse.
                    // Binary files (e.g. encrypted skill bundles) contain null
                    // bytes that are a reliable indicator they are not plain-text
                    // skill files. Downgrade to WARN — this is expected for known
                    // encrypted assets, not an operational error.
                    const rawBuffer = fs.readFileSync(filePath);
                    if (rawBuffer.includes(0)) {
                        appLogger.warn(`[CustomSkill] Skipping binary/encrypted file: ${file}`);
                        continue;
                    }

                    const content = rawBuffer.toString('utf-8');

                    // Secondary guard: if the UTF-8 decode produced replacement
                    // characters (\uFFFD) the file is likely a non-UTF8 binary.
                    if (content.includes('\uFFFD')) {
                        appLogger.warn(`[CustomSkill] Skipping non-UTF8 file: ${file}`);
                        continue;
                    }

                    if (isJson) {
                        const data = JSON.parse(content);
                        if (data.name && data.content) {
                            skills.push({
                                id: data.id || file.replace('.json', ''),
                                name: data.name,
                                description: data.description || '',
                                content: typeof data.content === 'string'
                                    ? data.content
                                    : JSON.stringify(data.content, null, 2)
                            });
                            counter.value++;
                        }
                    } else {
                        // For markdown, we use a simple header-based detection or just treat as a single skill
                        skills.push({
                            id: file.replace('.md', ''),
                            name: file.replace('.md', ''),
                            description: `Markdown skill from ${file}`,
                            content: content
                        });
                        counter.value++;
                    }
                } catch (err: any) {
                    // Downgrade from ERROR to WARN — a single unparseable file
                    // is expected (encrypted/malformed) and should not pollute
                    // error dashboards. The rest of the scan continues unaffected.
                    appLogger.warn(`[CustomSkill] Skipping unparseable file: ${file}`, { reason: err.message });
                }
            }
        }
    }
}
