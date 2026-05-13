/**
 * Test Data Factory
 * 
 * Generates unique test data to avoid collisions.
 * Provides cleanup utilities for test data.
 * 
 * @author GoHybrid AI Team
 * @date April 1, 2026
 */

/**
 * Generate unique designation data
 * 
 * Features:
 * - Unique timestamp (ms precision)
 * - Random suffix (5 chars) to avoid collisions
 * - Predictable pattern for easy cleanup
 * 
 * Usage:
 * ```typescript
 * const testData = TestDataFactory.generateDesignation();
 * console.log(testData.ShortCode);  // "CODE_1775036124939_a7b2c"
 * console.log(testData.Designation); // "Design_1775036124939_a7b2c"
 * ```
 */
export function generateDesignation() {
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    
    return {
        ShortCode: `CODE_${timestamp}_${randomSuffix}`,
        Designation: `Design_${timestamp}_${randomSuffix}`,
        GradeID: 'Manager',
        // For cleanup tracking
        _timestamp: timestamp,
        _suffix: randomSuffix
    };
}

/**
 * Generate unique employee data
 */
export function generateEmployee() {
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    
    return {
        EmployeeCode: `EMP_${timestamp}_${randomSuffix}`,
        FirstName: `Test_${timestamp}_${randomSuffix}`,
        LastName: `Employee_${randomSuffix}`,
        Email: `test_${timestamp}_${randomSuffix}@test.com`,
        // For cleanup tracking
        _timestamp: timestamp,
        _suffix: randomSuffix
    };
}

/**
 * Generate unique department data
 */
export function generateDepartment() {
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    
    return {
        DepartmentCode: `DEPT_${timestamp}_${randomSuffix}`,
        DepartmentName: `Department_${timestamp}_${randomSuffix}`,
        // For cleanup tracking
        _timestamp: timestamp,
        _suffix: randomSuffix
    };
}

/**
 * Generate unique grade data
 */
export function generateGrade() {
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    
    return {
        GradeCode: `GRADE_${timestamp}_${randomSuffix}`,
        GradeName: `Grade_${timestamp}_${randomSuffix}`,
        // For cleanup tracking
        _timestamp: timestamp,
        _suffix: randomSuffix
    };
}

/**
 * Get cleanup pattern for test data
 * 
 * Use this to find and delete all test data created in a test run
 * 
 * @param timestamp - The timestamp used when generating data
 * @returns Pattern to match for cleanup
 * 
 * Usage:
 * ```typescript
 * const testData = generateDesignation();
 * // ... run test ...
 * const cleanupPattern = getCleanupPattern(testData._timestamp);
 * await cleanupDesignationsByPattern(cleanupPattern);
 * ```
 */
export function getCleanupPattern(timestamp: number): string {
    return `_${timestamp}_`;
}

/**
 * Wait function for test timing
 * 
 * @param ms - Milliseconds to wait
 * 
 * Usage:
 * ```typescript
 * await waitFor(1000); // Wait 1 second
 * ```
 */
export async function waitFor(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry wrapper for flaky operations
 * 
 * @param operation - Async operation to retry
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @param delayMs - Delay between retries (default: 1000ms)
 * @returns Result of successful operation or throws error
 * 
 * Usage:
 * ```typescript
 * const result = await retryOperation(
 *     () => page.click('button:has-text("Save")'),
 *     3,
 *     2000
 * );
 * ```
 */
export async function retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 1000
): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[Retry] Attempt ${attempt}/${maxRetries}`);
            return await operation();
        } catch (error: any) {
            lastError = error;
            console.warn(`[Retry] Attempt ${attempt} failed:`, error.message);
            
            if (attempt < maxRetries) {
                console.log(`[Retry] Waiting ${delayMs}ms before retry...`);
                await waitFor(delayMs);
            }
        }
    }
    
    throw new Error(`Operation failed after ${maxRetries} retries. Last error: ${(lastError as any).message}`);
}

/**
 * Performance timer for measuring operation duration
 * 
 * Usage:
 * ```typescript
 * const timer = new PerformanceTimer();
 * timer.start('Login');
 * await login(page);
 * timer.stop('Login');
 * console.log(`Login took ${timer.getDuration('Login')}ms`);
 * ```
 */
export class PerformanceTimer {
    private timers: Map<string, number> = new Map();
    private durations: Map<string, number> = new Map();
    
    start(label: string): void {
        this.timers.set(label, Date.now());
        console.log(`⏱️  Started: ${label}`);
    }
    
    stop(label: string): number {
        const startTime = this.timers.get(label);
        if (!startTime) {
            throw new Error(`Timer "${label}" not started`);
        }
        
        const duration = Date.now() - startTime;
        this.durations.set(label, duration);
        console.log(`⏱️  ${label}: ${duration}ms`);
        return duration;
    }
    
    getDuration(label: string): number | undefined {
        return this.durations.get(label);
    }
    
    getAllDurations(): Map<string, number> {
        return this.durations;
    }
    
    logSummary(): void {
        console.log('\n📊 Performance Summary:');
        console.log('='.repeat(40));
        for (const [label, duration] of this.durations.entries()) {
            console.log(`  ${label.padEnd(20)} ${duration.toString().padStart(5)}ms`);
        }
        console.log('='.repeat(40));
    }
}
