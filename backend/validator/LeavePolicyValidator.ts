export interface LeaveCalculationResult {
    staffId: string;
    requestedDays: number;
    policyType: 'exclude_holidays' | 'include_holidays';
    holidaysInPeriod: number;
    calculatedDays: number; // API က ပြန်ပေးတဲ့ result
}

export interface BusinessLogicViolation {
    type: 'BusinessLogicViolation';
    message: string;
    evidence: {
        staffId: string;
        expectedDays: number;
        actualDays: number;
        policy: string;
        holidayMismatch: boolean;
    };
}

export class LeavePolicyValidator {
    /**
     * Forensic Audit for Leave Calculations.
     */
    static validateCalculation(data: LeaveCalculationResult): BusinessLogicViolation | null {
        console.log(`[Detective] Auditing Leave Policy for Staff: ${data.staffId}`);

        let expectedDays = data.requestedDays;

        // "Exclude Holidays" policy logic
        if (data.policyType === 'exclude_holidays') {
            expectedDays = data.requestedDays - data.holidaysInPeriod;
        }

        // Logic Auditing: Check if calculated days from API matches the policy expectation
        if (data.calculatedDays !== expectedDays) {
            const violation: BusinessLogicViolation = {
                type: 'BusinessLogicViolation',
                message: `CRITICAL: Leave calculation mismatch detected for Staff: ${data.staffId}`,
                evidence: {
                    staffId: data.staffId,
                    expectedDays: expectedDays,
                    actualDays: data.calculatedDays,
                    policy: data.policyType,
                    holidayMismatch: data.calculatedDays === data.requestedDays && data.policyType === 'exclude_holidays'
                }
            };

            console.error(`[Forensic Evidence] ${violation.message}`);
            if (violation.evidence.holidayMismatch) {
                console.error(`[Evidence] System counted holidays as leave despite 'Exclude Holidays' policy.`);
            }

            return violation;
        }

        console.log(`[Detective] Leave calculation verified for Staff: ${data.staffId}. Logic holds.`);
        return null;
    }

    /**
     * Audits the entire staff allowance flow based on annotations.
     */
    static auditFromAnnotations(staffId: string, currentAllowance: number, usedDays: number, remaining: number): boolean {
        const expectedRemaining = currentAllowance - usedDays;
        if (remaining !== expectedRemaining) {
            console.error(`[Forensic Audit] Staff Allowance Discrepancy! Base: ${currentAllowance}, Used: ${usedDays}, Expected: ${expectedRemaining}, Got: ${remaining}`);
            return false;
        }
        return true;
    }
}
