import * as fs from 'fs';
import * as path from 'path';

export interface Skill {
  id: string;
  name: string;
  type: 'jira' | 'recording' | 'workflow' | 'document';
  module?: string;
  content: any;
  priority: number;
}

export class SkillRegistry {
  private static skills: Skill[] = [];
  private static skillsDir = path.join(__dirname, '../../../skills');

  /**
   * Initialize and load all skills from disk
   */
  static async initialize(): Promise<void> {
    this.skills = [];
    console.log(`[SkillRegistry] Initializing from ${this.skillsDir}`);

    try {
      // 1. Load Static Documentation Skills (.md, .json in root)
      const rootFiles = fs.readdirSync(this.skillsDir);
      for (const file of rootFiles) {
        if ((file.endsWith('.json') || file.endsWith('.md')) && file !== 'skill-index.json') {
          this.loadRootSkill(file);
        }
      }

      // 2. Load Auto-Generated Patterns
      const autoGenDir = path.join(this.skillsDir, 'Auto-Generated');
      if (fs.existsSync(autoGenDir)) {
        this.loadPatterns(path.join(autoGenDir, 'jira-patterns'), 'jira');
        this.loadPatterns(path.join(autoGenDir, 'recording-patterns'), 'recording');
        
        // NEW: Load CSV-extracted skills
        const csvDir = path.join(autoGenDir, 'csv-extracted');
        if (fs.existsSync(csvDir)) {
          const csvFiles = fs.readdirSync(csvDir).filter(f => f.endsWith('.json'));
          for (const file of csvFiles) {
            try {
              const content = JSON.parse(fs.readFileSync(path.join(csvDir, file), 'utf8'));
              this.skills.push({
                id: `csv:${file.replace('.json', '')}`,
                name: content.formName || file,
                type: 'workflow',
                module: content.formName,
                content: content,
                priority: 50, // Higher than jira patterns
              });
              console.log(`[SkillRegistry] Loaded CSV skill: ${file}`);
            } catch (e) {
              // Skip invalid files
            }
          }
        }
        
        // NEW: Load docx-extracted skills
        const docxDir = path.join(autoGenDir, 'docx-extracted');
        if (fs.existsSync(docxDir)) {
          const docxFiles = fs.readdirSync(docxDir).filter(f => f.endsWith('.json'));
          for (const file of docxFiles) {
            try {
              const content = JSON.parse(fs.readFileSync(path.join(docxDir, file), 'utf8'));
              this.skills.push({
                id: `docx:${file.replace('.json', '')}`,
                name: content.sourceFile || file,
                type: 'document',
                content: content,
                priority: 30,
              });
            } catch (e) {
              // Skip invalid files
            }
          }
        }
      }

      console.log(`[SkillRegistry] Loaded ${this.skills.length} skills into memory`);
    } catch (error: any) {
      console.error(`[SkillRegistry] Initialization failed: ${error.message}`);
    }
  }

  private static loadRootSkill(filename: string) {
    try {
      const isJson = filename.endsWith('.json');
      const rawContent = fs.readFileSync(path.join(this.skillsDir, filename), 'utf8');
      const content = isJson ? JSON.parse(rawContent) : rawContent;
      
      this.skills.push({
        id: filename.replace('.json', '').replace('.md', ''),
        name: filename,
        type: 'document',
        content,
        priority: 1
      });
    } catch (e) {
      console.warn(`[SkillRegistry] Failed to load skill file ${filename}:`, (e as Error).message);
    }
  }

  private static loadPatterns(dir: string, type: 'jira' | 'recording') {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
          this.skills.push({
            id: content.id || file.replace('.json', ''),
            name: file,
            type,
            module: content.module,
            content,
            priority: 2
          });
        } catch (e) {}
      }
    }
  }

  /**
   * Find skills relevant to a specific module or action
   */
  static findSkills(moduleName?: string, type?: string): Skill[] {
    return this.skills.filter(s => {
      const matchModule = !moduleName || s.module?.toLowerCase() === moduleName.toLowerCase();
      const matchType = !type || s.type === type;
      return matchModule && matchType;
    });
  }

  /**
   * Get all loaded skills
   */
  static getAllSkills(): Skill[] {
    return this.skills;
  }
}
