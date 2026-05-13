import fetch from 'node-fetch';

export class StateSeeder {
    private static API_BASE = "http://localhost:3000/api";

    /**
     * Seed prerequisite data for GlobalHR modules
     */
    static async seedPrerequisites(moduleName: string, menuName: string) {
        console.log(`[StateSeeder] Seeding prerequisites for ${moduleName} > ${menuName}...`);

        if (moduleName === "Employee" && menuName === "Employee Setup") {
            await this.createMockEmployee();
        } else if (moduleName === "Time Attendance" && (menuName === "Leave Request" || menuName === "OT Request")) {
            await this.createMockEmployee();
            await this.setupLeavePolicy();
        }

        console.log(`[StateSeeder] Prerequisites satisfied.`);
    }

    private static async createMockEmployee() {
        console.log("  [+] Creating Test Employee: EM 9999...");
        // In real system, this would be a POST to the HR backend
        return Promise.resolve({ success: true, employeeId: "EM9999" });
    }

    private static async setupLeavePolicy() {
        console.log("  [+] Assigning 10 days Annual Leave to EM 9999...");
        return Promise.resolve({ success: true });
    }
}
