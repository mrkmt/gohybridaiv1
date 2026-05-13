import { BusinessLogicViolation } from './LeavePolicyValidator';

export interface PayrollRecord {
    staffId: string;
    baseSalary: number;
    allowances: number;
    deductions: number;
    otPay: number;
    calculatedNetPay: number; // API response
}

export class PayrollValidator {
    /**
     * Forensic Audit for Payroll Calculations
     */
    static validatePayroll(data: PayrollRecord): BusinessLogicViolation | null {
        console.log(`[Detective - Payroll] Auditing payroll logic for Staff: ${data.staffId}`);

        // Business Logic: Net Pay = Base + Allowances + OT - Deductions
        const expectedNetPay = (data.baseSalary + data.allowances + data.otPay) - data.deductions;

        if (data.calculatedNetPay !== expectedNetPay) {
            return {
                type: 'BusinessLogicViolation',
                message: `[Payroll Mismatch] Expected Net Pay: ${expectedNetPay}, but system generated: ${data.calculatedNetPay}`,
                evidence: {
                    staffId: data.staffId,
                    expectedDays: expectedNetPay, // Reusing field for expected value
                    actualDays: data.calculatedNetPay, // Reusing field for actual value
                    policy: `Base:${data.baseSalary} + Allow:${data.allowances} + OT:${data.otPay} - Deduct:${data.deductions}`,
                    holidayMismatch: false
                }
            };
        }

        return null;
    }
}
