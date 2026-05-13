import { storageService } from './StorageService';

export interface EvidenceRecord {
    id: string; // Recording UUID
    sessionId: string;
    type: 'manual' | 'automation';
    assetUrl: string;
    metadata?: any;
}

export class EvidenceLogger {
    /**
     * Chain of Custody: Links manual and automation evidence.
     */
    static async linkEvidence(recordingId: string, manualUrl: string, autoUrl: string): Promise<any> {
        console.log(`[Detective] Linking Evidence Chain for Recording: ${recordingId}`);
        
        return {
            recordingId,
            manualSnapshot: manualUrl,
            automationSnapshot: autoUrl,
            linkedAt: new Date().toISOString(),
            verificationStatus: manualUrl && autoUrl ? 'READY_FOR_COMPARISON' : 'PENDING_ASSETS'
        };
    }

    /**
     * Preserves evidence artifacts in MinIO and updates the record.
     */
    static async saveForensicArtifact(
        recordingId: string, 
        type: 'screenshot' | 'video', 
        buffer: Buffer, 
        metadata: any = {}
    ): Promise<string> {
        const objectName = `forensics/${recordingId}/${type}_${Date.now()}.${type === 'screenshot' ? 'png' : 'webm'}`;
        
        console.log(`[Detective] Preserving Forensic Evidence: ${objectName}`);
        
        await storageService.uploadFile(objectName, buffer);

        return objectName;
    }

    /**
     * Forensic Comparison: Generate pre-signed URLs for both assets.
     */
    static async getComparisonUrls(manualPath: string, autoPath: string, baseUrl: string): Promise<{ manual: string, auto: string }> {
        const manual = manualPath ? storageService.getPublicUrl(manualPath, baseUrl) : '';
        const auto = autoPath ? storageService.getPublicUrl(autoPath, baseUrl) : '';
        
        return { manual, auto };
    }
}
