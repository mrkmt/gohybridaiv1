/**
 * CLI: Generate test specs from skill files
 * Usage: npx ts-node scripts/generate-skill-tests.ts [--list] [--module Name]
 */
import { listAvailableModules, generateTestSpec, generateAll } from '../src/services/SkillDrivenTestGenerator';

const args = process.argv.slice(2);
if (args.includes('--list')) {
  console.log('\n📋 Available modules:\n');
  listAvailableModules().forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
  console.log('');
} else {
  const mod = args.find((_, i) => i > 0 && args[i - 1] === '--module');
  if (mod) {
    const out = generateTestSpec(mod);
    console.log(out ? `\n✅ Generated: ${out}` : `\n❌ No skill file for: ${mod}`);
  } else {
    const files = generateAll();
    console.log(`\n✅ Generated ${files.length} test specs:\n`);
    files.forEach(f => console.log(`  - ${f}`));
  }
}
