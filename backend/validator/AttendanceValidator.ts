import { BusinessLogicViolation } from './LeavePolicyValidator';

export interface AttendanceRecord {
    staffId: string;
    shiftStartTime: string; // e.g., "09:00"
    shiftEndTime: string;   // e.g., "17:00"
    actualCheckIn: string;  // e.g., "09:15"
    actualCheckOut: string; // e.g., "18:00"
    calculatedLateMinutes: number; // API response
    calculatedOTMinutes: number;   // API response
}

export class AttendanceValidator {
    /**
     * Forensic Audit for Attendance & Overtime Logic
     */
    static validateAttendance(data: AttendanceRecord): BusinessLogicViolation | null {
        console.log(`[Detective - Attendance] Auditing records for Staff: ${data.staffId}`);

        // Calculate Expected Late Minutes
        const expectedLate = this.calculateDifference(data.shiftStartTime, data.actualCheckIn);
        const actualLate = expectedLate > 0 ? expectedLate : 0;

        if (data.calculatedLateMinutes !== actualLate) {
            return {
                type: 'BusinessLogicViolation',
                message: `[Late Time Mismatch] Expected ${actualLate} mins, but API calculated ${data.calculatedLateMinutes} mins.`,
                evidence: {
                    staffId: data.staffId,
                    expectedDays: actualLate, // reusing field
                    actualDays: data.calculatedLateMinutes,
                    policy: `Shift: ${data.shiftStartTime}, Check-In: ${data.actualCheckIn}`,
                    holidayMismatch: false
                }
            };
        }

        // Calculate Expected Overtime (Assuming OT starts exactly after shift ends)
        const expectedOT = this.calculateDifference(data.shiftEndTime, data.actualCheckOut);
        const actualOT = expectedOT > 0 ? expectedOT : 0;

        if (data.calculatedOTMinutes !== actualOT) {
            return {
                type: 'BusinessLogicViolation',
                message: `[OT Calculation Mismatch] Expected ${actualOT} mins OT, but API calculated ${data.calculatedOTMinutes} mins.`,
                evidence: {
                    staffId: data.staffId,
                    expectedDays: actualOT,
                    actualDays: data.calculatedOTMinutes,
                    policy: `Shift End: ${data.shiftEndTime}, Check-Out: ${data.actualCheckOut}`,
                    holidayMismatch: false
                }
            };
        }

        return null; // All good
    }

    private static calculateDifference(time1: string, time2: string): number {
        // Simple time difference calculator in minutes (Format: HH:mm)
        const [h1, m1] = time1.split(':').map(Number);
        const [h2, m2] = time2.split(':').map(Number);
        const minutes1 = (h1 * 60) + m1;
        const minutes2 = (h2 * 60) + m2;
        return minutes2 - minutes1;
    }
}
