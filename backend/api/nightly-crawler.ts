import { Command } from 'commander';
import { config } from './config';
import { CrawlerService } from '../src/services/discovery/CrawlerService';
import { DiscoveryRunService } from '../src/services/discovery/DiscoveryRunService';
import { normalizeDiscoveryRequest, toSafeDiscoveryConfig } from '../src/services/discovery/DiscoveryConfig';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    const program = new Command();

    program
        .requiredOption('--base-url <url>')
        .requiredOption('--customer-id <id>')
        .requiredOption('--id-number <idNumber>')
        .requiredOption('--username <username>')
        .requiredOption('--password <password>')
        .option('--ai-model <model>', 'AI model to use', config.discovery.allowedModels[0] || config.ai.defaultModel)
        .option('--mode <mode>', 'Run mode (live-readonly|test-create)', 'live-readonly')
        .option('--max-depth <depth>', 'Crawl depth')
        .option('--deep-crawl', 'Enable deep crawling', false)
        .option('--incremental', 'Skip already discovered pages', false)
        .option('--resume <runId>', 'Resume from a previous checkpoint');

    program.parse(process.argv);
    const options = program.opts();

    // 1. Determine Run ID (New or Resumed)
    let runId = options.resume || '';
    let request: any;

    if (options.resume) {
        const existingRun = await DiscoveryRunService.getById(options.resume);
        if (!existingRun || !existingRun.hasCheckpoint) {
            console.error(`[CLI] Error: No checkpoint found for Run ID: ${options.resume}`);
            process.exit(1);
        }
        console.log(`[CLI] Resuming Run ID: ${options.resume}`);
        // Reconstruct request from existing config
        request = normalizeDiscoveryRequest({
            ...existingRun.config,
            idNumber: options.idNumber,
            username: options.username,
            password: options.password,
        });
    } else {
        request = normalizeDiscoveryRequest({
            baseUrl: options.baseUrl,
            customerId: options.customerId,
            idNumber: options.idNumber,
            username: options.username,
            password: options.password,
            aiModel: options.aiModel,
            deepCrawl: Boolean(options.deepCrawl),
            incremental: Boolean(options.incremental),
            maxDepth: options.maxDepth ? Number(options.maxDepth) : undefined,
            mode: options.mode,
        });
        const newRun = await DiscoveryRunService.create(toSafeDiscoveryConfig(request));
        runId = newRun.id;
        console.log(`[CLI] Created new Discovery Run: ${runId}`);
    }

    const crawler = new CrawlerService();
    let browserInstance: any = null;

    // Graceful shutdown
    const cleanup = async () => {
        console.log('\n[CLI] Interrupted. Cleaning up and saving checkpoint...');
        await crawler.cleanup(runId);
        process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    try {
        await crawler.startDiscovery(request, runId);
        console.log(`Discovery run completed: ${runId}`);

        // FINAL CHECK: Bug Done tickets re-scanning or element mapping updates
        console.log('\n[CLI] Running Final Check for "Bug Done" tickets...');
        const matrixPath = path.join(process.cwd(), 'business-logic-matrix.json');
        if (fs.existsSync(matrixPath)) {
            const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
            const bugDoneTickets = matrix.filter((rule: any) =>
                rule.status && rule.status.toLowerCase().includes('bug done')
            );

            if (bugDoneTickets.length > 0) {
                console.log(`[CLI] Found ${bugDoneTickets.length} "Bug Done" ticket(s) needing attention:`);
                for (const ticket of bugDoneTickets) {
                    console.log(`  - ${ticket.id || 'Unknown ID'}: ${ticket.Module} > ${ticket.SubModule}`);
                }
            } else {
                console.log('[CLI] No "Bug Done" tickets found in matrix.');
            }
        }

    } catch (err) {
        console.error('Discovery failed:', err);
    } finally {
        process.removeListener('SIGINT', cleanup);
        process.removeListener('SIGTERM', cleanup);
    }
}

main().catch(error => {
    console.error('Nightly crawler failed:', error);
    process.exit(1);
});
