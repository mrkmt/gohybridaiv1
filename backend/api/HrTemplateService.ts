export class HrTemplateService {
    static getTemplates() {
        return {
            'leave': `
- Leave Balance Report: [VISUAL] Verify Kendo Grid layout. [MATH] Verify Delta ($\Delta$) in carry-forward balance.
- Leave Request Workflow: [BEHAVIOR] BDD Scenario: Employee creates -> L1 approves -> Balance updated.`,
            'payroll': `
- Payroll Calculation: [MATH] Use Delta ($\Delta$) verification for Tax and Social Security. [VISUAL] Dashboard chart accuracy.
- Salary Export: [BEHAVIOR] Verify Excel/CSV structure against banking standards.`,
            'attendance': `
- Biometric Sync: [MATH] Verify total hours calculation. [BEHAVIOR] Sync success/failure retry logic.
- Attendance Grid: [VISUAL] Verify 'toHaveScreenshot' for time-picker widgets.`,
            'mobile': `
- Mobile Self Service: [VISUAL] Responsive layout check. [BEHAVIOR] Offline request sync behavior.`
        };
    }

    static getRelevantTemplates(text: string): string {
        const t = text.toLowerCase();
        let templates = [];
        const dict = this.getTemplates();
        if (t.includes('leave') || t.includes('time off')) templates.push(dict['leave']);
        if (t.includes('payroll') || t.includes('salary')) templates.push(dict['payroll']);
        if (t.includes('attendance') || t.includes('clock') || t.includes('biometric')) templates.push(dict['attendance']);
        if (t.includes('mobile') || t.includes('app')) templates.push(dict['mobile']);

        if (templates.length === 0) return "No specific HR templates matched. Rely on general guidelines.";
        return templates.join('\n');
    }
}
