import { BurmeseTranslator } from './BurmeseTranslator';
import { LocalAIService } from './LocalAIService';

jest.mock('./LocalAIService', () => ({
    LocalAIService: {
        simpleGenerate: jest.fn().mockResolvedValue('Hello, this is a test login.')
    }
}));

describe('BurmeseTranslator', () => {
    it('should pass through English text without translation', async () => {
        const input = 'Login successful';
        const result = await BurmeseTranslator.translateToForensicEnglish(input);
        expect(result).toBe(input);
    });

    it('should translate Burmese text using LocalAIService', async () => {
        const input = 'မြန်မာစာ စမ်းသပ်ခြင်း'; // Burmese text
        const result = await BurmeseTranslator.translateToForensicEnglish(input);

        expect(LocalAIService.simpleGenerate).toHaveBeenCalled();
        expect(result).toBe('Hello, this is a test login.');
    });
});
