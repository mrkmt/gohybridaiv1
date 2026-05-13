import { ModuleConfig } from '../config/module-configs';

export function generateCrudSpec(module: ModuleConfig, baseUrlEnv = 'process.env.BASE_URL') {
  const route = module.baseRoute.replace(/^\/+/, '');
  const name = module.name.replace(/\s+/g, '-').toLowerCase();

  return `
import { test, expect } from '@playwright/test';
import { healedClick } from '../helpers/navigation-helpers';
import { waitForAppReady } from '../helpers/wait-helpers';
import { fillFormField } from '../helpers/form-helpers';
import { filterKendoGrid } from '../helpers/grid-helpers';

test.describe('${module.name} CRUD', () => {
  test('performs add → verify → delete flow', async ({ page }) => {
    expect(${baseUrlEnv}).toBeTruthy();
    await page.goto(\`\${${baseUrlEnv}}#/${route}\`);
    await waitForAppReady(page);

    await healedClick(page, '${module.selectors.addButton || 'button:has-text("Add")'}', '${module.name} add');
    await waitForAppReady(page);

    await fillFormField(page, 'input[name="${module.keyField.toLowerCase().replace(/\\s+/g, '')}"]', 'Auto ${module.name}');
    await healedClick(page, '${module.selectors.saveButton || 'button:has-text("Save")'}', '${module.name} save');
    await expect(page.locator('${module.selectors.gridRow || 'kendo-grid tbody tr'}')).toContainText('Auto ${module.name}');

    await filterKendoGrid(page, '${module.keyField}', 'Auto ${module.name}');
    await expect(page.locator('${module.selectors.gridRow || 'kendo-grid tbody tr'}')).toHaveCount(1);
  });
});
`.trim();
}
