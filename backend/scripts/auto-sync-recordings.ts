/**
 * Auto-Sync Watcher for Manual Recordings
 * 
 * Watches backend/manualrecord/ folder and automatically generates skills
 * when new JSON recordings are added.
 * 
 * Usage:
 *   npx ts-node --project tsconfig.json scripts/auto-sync-recordings.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as chokidar from 'chokidar';
import { generateSkillsFromRecording } from './generate-skills-from-recording';

const MANUAL_RECORD_DIR = path.join(__dirname, '..', 'manualrecord');
const PROCESSED_DIR = path.join(MANUAL_RECORD_DIR, '.processed');
const SKILLS_DIR = path.join(__dirname, '..', 'skills', 'auto-generated');

// Track processed files
const processedFiles = new Set<string>();

/**
 * Initialize file watcher
 */
function startWatcher(): void {
    console.log('\n' + '='.repeat(70));
    console.log('🔍 AUTO-SYNC WATCHER STARTED');
    console.log('='.repeat(70));
    console.log(`Watching: ${MANUAL_RECORD_DIR}`);
    console.log(`Skills output: ${SKILLS_DIR}`);
    console.log('='.repeat(70));
    console.log('\n💡 How to use:');
    console.log('  1. Record using extension');
    console.log('  2. Export JSON to manualrecord/ folder');
    console.log('  3. Skills will auto-generate in ~2 seconds');
    console.log('  4. Press Ctrl+C to stop watcher\n');
    
    // Ensure directories exist
    if (!fs.existsSync(MANUAL_RECORD_DIR)) {
        fs.mkdirSync(MANUAL_RECORD_DIR, { recursive: true });
    }
    if (!fs.existsSync(PROCESSED_DIR)) {
        fs.mkdirSync(PROCESSED_DIR, { recursive: true });
    }
    if (!fs.existsSync(SKILLS_DIR)) {
        fs.mkdirSync(SKILLS_DIR, { recursive: true });
    }
    
    // Load already processed files
    if (fs.existsSync(PROCESSED_DIR)) {
        const files = fs.readdirSync(PROCESSED_DIR).filter(f => f.endsWith('.json'));
        files.forEach(f => processedFiles.add(f));
        console.log(`📁 Found ${processedFiles.size} already processed files\n`);
    }
    
    // Setup watcher
    const watcher = chokidar.watch(MANUAL_RECORD_DIR, {
        ignored: /(^|[\/\\])\../, // Ignore dotfiles
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 2000,
            pollPeriod: 500
        }
    });
    
    watcher
        .on('add', handleNewFile)
        .on('change', handleFileChange)
        .on('error', handleError);
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n\n⚠️  Stopping watcher...');
        watcher.close();
        process.exit(0);
    });
}

/**
 * Handle new file event
 */
function handleNewFile(filePath: string): void {
    const fileName = path.basename(filePath);
    
    // Skip if not JSON
    if (!fileName.endsWith('.json')) {
        return;
    }
    
    // Skip if already processed
    if (processedFiles.has(fileName)) {
        console.log(`⏭️  Skipping (already processed): ${fileName}`);
        return;
    }
    
    console.log(`\n📥 NEW FILE DETECTED: ${fileName}`);
    console.log('⏳ Processing...');
    
    try {
        // Generate skills
        generateSkillsFromRecording(filePath);
        
        // Mark as processed
        processedFiles.add(fileName);
        
        // Move to processed folder (optional, keeps folder clean)
        // moveToProcessed(filePath, fileName);
        
        console.log(`✅ Processing complete!\n`);
        console.log('Waiting for next recording...\n');
        
    } catch (error: any) {
        console.error(`❌ Error processing ${fileName}:`, error.message);
        console.log('File will be retried on next change\n');
    }
}

/**
 * Handle file change event
 */
function handleFileChange(filePath: string): void {
    const fileName = path.basename(filePath);
    
    if (!fileName.endsWith('.json')) {
        return;
    }
    
    // If file was already processed, skip
    if (processedFiles.has(fileName)) {
        return;
    }
    
    // File changed before we could process it, wait for stability
    console.log(`📝 File changed: ${fileName} (waiting for stability...)`);
}

/**
 * Handle watcher error
 */
function handleError(error: Error): void {
    console.error('❌ Watcher error:', error.message);
}

/**
 * Move file to processed folder (optional cleanup)
 */
function moveToProcessed(filePath: string, fileName: string): void {
    try {
        const destPath = path.join(PROCESSED_DIR, fileName);
        fs.renameSync(filePath, destPath);
        console.log(`📁 Moved to processed: ${fileName}`);
    } catch (error: any) {
        console.warn(`⚠️  Could not move file: ${error.message}`);
    }
}

// Start the watcher
startWatcher();
