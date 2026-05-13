export class RiskPredictorService {
    static analyzeRisk(text: string): { score: number, level: string, patterns: string[] } {
        const t = text.toLowerCase();
        let score = 20; // Base score 20%
        let patterns = [];

        if (t.includes('policy') || t.includes('rule')) {
            score += 25;
            patterns.push('Policy Conflict');
        }
        if (t.includes('shift') || t.includes('roster')) {
            score += 20;
            patterns.push('Shift Mapping Error');
        }
        if (t.includes('mobile') || t.includes('sync')) {
            score += 30;
            patterns.push('Mobile Sync Issue');
        }
        if (t.includes('export') || t.includes('excel')) {
            score += 15;
            patterns.push('Export Mismatch');
        }
        if (t.includes('approval') || t.includes('workflow')) {
            score += 25;
            patterns.push('Approval Reset / State Mismatch');
        }
        if (t.includes('calculation') || t.includes('payroll')) {
            score += 35;
            patterns.push('Calculation Discrepancy');
        }

        score = Math.min(score, 95);
        let level = 'LOW';
        if (score >= 70) level = 'HIGH';
        else if (score >= 40) level = 'MEDIUM';

        return { score, level, patterns };
    }
}
