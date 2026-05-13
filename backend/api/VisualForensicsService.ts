import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { storageService } from './StorageService';
import { createWorker, recognize } from 'tesseract.js';

export class VisualForensicsService {
    /**
     * Compares two screenshots and generates a DIFF image highlighting changes.
     */
    static async generateVisualDiff(recordingId: string, standardPath: string, executionPath: string): Promise<string | null> {
        console.log(`[Detective-Visual] Comparing pixels: ${standardPath} vs ${executionPath}`);

        try {
            // 1. Download images from MinIO or read from local if it was direct
            // For now, assuming we handle the buffers directly
            const standardBuffer = await this.getImageBuffer(standardPath);
            const executionBuffer = await this.getImageBuffer(executionPath);

            if (!standardBuffer || !executionBuffer) return null;

            const img1 = PNG.sync.read(standardBuffer);
            const img2 = PNG.sync.read(executionBuffer);
            const { width, height } = img1;
            const diff = new PNG({ width, height });

            // Fix for pixelmatch ESM issue (must use dynamic import for v6+)
            const pixelmatch = (await import('pixelmatch')).default;

            // 2. Perform pixel match
            const numDiffPixels = pixelmatch(
                img1.data,
                img2.data,
                diff.data,
                width,
                height,
                { threshold: 0.1 }
            );

            const mismatchPercentage = (numDiffPixels / (width * height)) * 100;
            console.log(`[Detective] Visual Mismatch: ${mismatchPercentage.toFixed(2)}%`);

            // 3. Save the Diff image to MinIO as evidence
            const diffBuffer = PNG.sync.write(diff);
            const diffObjectName = `forensics/${recordingId}/visual_diff_${Date.now()}.png`;
            
            await storageService.uploadFile(diffObjectName, diffBuffer);

            return diffObjectName;
        } catch (e) {
            console.error('[VisualForensics] Comparison failed:', e);
            return null;
        }
    }

    /**
     * Visual OCR Comparison using Tesseract.js.
     * Extracts text from the screenshot and verifies if the expected text is present.
     * Useful for verifying data grids or notification popups where DOM selectors are flaky.
     */
    static async verifyTextInImage(imagePath: string, expectedText: string): Promise<{ matched: boolean; confidence: number; extractedText?: string }> {
        console.log(`[Detective-Vision] Running OCR to find "${expectedText}" in ${imagePath}`);

        try {
            let imageBuffer: Buffer | null = null;

            // Handle both file paths and storage service paths
            if (fs.existsSync(imagePath)) {
                imageBuffer = fs.readFileSync(imagePath);
            } else {
                imageBuffer = await this.getImageBuffer(imagePath);
            }

            if (!imageBuffer) {
                console.warn('[Detective-Vision] Could not read image buffer');
                return { matched: false, confidence: 0 };
            }

            // Save buffer to temp file for Tesseract (it needs a file path or image source)
            const tempDir = path.join(process.cwd(), 'test-results', '_ocr_temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            const tempImagePath = path.join(tempDir, `ocr_${Date.now()}.png`);
            fs.writeFileSync(tempImagePath, imageBuffer);

            // Run Tesseract OCR
            console.log('[Detective-Vision] Running Tesseract OCR...');
            const result = await recognize(tempImagePath, 'eng', {
                logger: () => {} // Suppress Tesseract progress logging
            });

            // Clean up temp file
            try { fs.unlinkSync(tempImagePath); } catch {}

            const extractedText = result.data.text || '';
            console.log(`[Detective-Vision] Extracted ${extractedText.length} chars`);

            // Check if expected text is in the extracted text
            const normalizedExtracted = extractedText.toLowerCase().replace(/\s+/g, ' ').trim();
            const normalizedExpected = expectedText.toLowerCase().replace(/\s+/g, ' ').trim();

            const matched = normalizedExtracted.includes(normalizedExpected);

            // Calculate confidence based on text similarity
            let confidence = 0;
            if (matched) {
                // High confidence if exact match found
                confidence = 0.9 + (0.1 * (normalizedExpected.length / Math.max(normalizedExtracted.length, 1)));
            } else {
                // Partial confidence based on word overlap
                const expectedWords = new Set(normalizedExpected.split(' '));
                const extractedWords = new Set(normalizedExtracted.split(' '));
                let matchCount = 0;
                for (const word of expectedWords) {
                    if (extractedWords.has(word)) matchCount++;
                }
                confidence = expectedWords.size > 0 ? matchCount / expectedWords.size : 0;
            }

            console.log(`[Detective-Vision] OCR complete. Matched: ${matched}, Confidence: ${(confidence * 100).toFixed(1)}%`);

            return {
                matched,
                confidence: Math.min(confidence, 1.0),
                extractedText: extractedText.substring(0, 500), // Truncate for logging
            };
        } catch (e: any) {
            console.error('[VisualForensics] OCR failed:', e.message);
            return { matched: false, confidence: 0 };
        }
    }

    private static async getImageBuffer(objectPath: string): Promise<Buffer | null> {
        try {
            return await storageService.getFileBuffer(objectPath);
        } catch {
            return null;
        }
    }
}
