export interface ModuleConfig {
  name: string;
  baseRoute: string;
  keyField: string;
  defaultAction?: string;
  selectors: {
    addButton?: string;
    saveButton?: string;
    gridRow?: string;
  };
}

export const moduleConfigs: ModuleConfig[] = [
  {
    name: 'Designation',
    baseRoute: 'app.designation',
    keyField: 'Designation Name',
    selectors: {
      addButton: 'button:has-text("Add Designation")',
      saveButton: 'button:has-text("Save")',
      gridRow: 'kendo-grid tbody tr'
    }
  },
  {
    name: 'Grade Form',
    baseRoute: 'app.grade-form',
    keyField: 'Grade Name',
    selectors: {
      addButton: 'button:has-text("Add Grade")',
      saveButton: 'button:has-text("Submit")'
    }
  }
];
