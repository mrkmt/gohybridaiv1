import { CloudAIService } from './CloudAIService';
import { LocalAIService } from './LocalAIService';

export class BurmeseTranslator {
    /**
     * Translates mixed Burmese/English input into clear English for the AI Brain.
     */
    static async translateToForensicEnglish(text: string): Promise<string> {
        if (!this.containsBurmese(text)) return text;

        console.log('[Translator] Burmese detected. Converting to Forensic English...');
        console.log(`[Translator] Input Text: ${text}`);

        const prompt = `
            TASK: Translate this software testing note from Burmese/Mixed to English.
            CONTEXT: Forensic bug investigation for HR software.
            TEXT: ${text}
            RETURN ONLY THE ENGLISH TRANSLATION.
        `;

        // Use local AI for translation to save costs
        const translation = await LocalAIService.simpleGenerate(prompt);
        console.log(`[Translator] Translated Result: ${translation}`);
        return translation;
    }

    /**
     * Detects if a string contains Burmese Unicode characters.
     */
    private static containsBurmese(text: string): boolean {
        const burmeseRegex = /[\u1000-\u109F]/;
        return burmeseRegex.test(text);
    }

    /**
     * Formats a final verdict into a bilingual report.
     */
    static formatBilingualReport(english: string, burmese: string): string {
        return `
--- 🇬🇧 ENGLISH VERDICT ---
${english}

--- 🇲🇲 မြန်မာဘာသာဖြင့် အကျဉ်းချုပ် ---
${burmese}
        `.trim();
    }
}
