import { LeavePolicyValidator, LeaveCalculationResult } from './LeavePolicyValidator';

describe('LeavePolicyValidator Forensic Audit', () => {
    test('should detect holiday mismatch when holidays are incorrectly counted as leave', () => {
        const mockData: LeaveCalculationResult = {
            staffId: 'EMP-001',
            requestedDays: 10,
            policyType: 'exclude_holidays',
            holidaysInPeriod: 2,
            calculatedDays: 10 // System bug: ignored the 2 holidays
        };

        const result = LeavePolicyValidator.validateCalculation(mockData);
        
        expect(result).not.toBeNull();
        expect(result?.type).toBe('BusinessLogicViolation');
        expect(result?.evidence.holidayMismatch).toBe(true);
        expect(result?.evidence.expectedDays).toBe(8);
    });

    test('should pass when calculation correctly excludes holidays', () => {
        const mockData: LeaveCalculationResult = {
            staffId: 'EMP-002',
            requestedDays: 5,
            policyType: 'exclude_holidays',
            holidaysInPeriod: 1,
            calculatedDays: 4 // Correct calculation
        };

        const result = LeavePolicyValidator.validateCalculation(mockData);
        
        expect(result).toBeNull();
    });

    test('should detect staff allowance discrepancy from annotations', () => {
        const auditPass = LeavePolicyValidator.auditFromAnnotations('EMP-003', 10, 2, 8);
        const auditFail = LeavePolicyValidator.auditFromAnnotations('EMP-003', 10, 2, 4); // Wrong balance

        expect(auditPass).toBe(true);
        expect(auditFail).toBe(false);
    });
});
