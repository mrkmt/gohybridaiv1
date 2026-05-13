/**
 * DNS Cache Clear Utility
 * Clears stale DNS overrides cache to allow fresh DNS resolution
 */

import fs from 'fs';
import path from 'path';

const DNS_CACHE_PATH = path.join(__dirname, '..', 'local_storage', 'cache', 'dns-overrides.json');

function clearDnsCache(): void {
    try {
        if (!fs.existsSync(DNS_CACHE_PATH)) {
            console.log('✓ No DNS cache file found - nothing to clear');
            console.log('  Playwright will use normal DNS resolution');
            return;
        }

        const content = fs.readFileSync(DNS_CACHE_PATH, 'utf8');
        const overrides = JSON.parse(content);
        
        console.log(`Current DNS cache contents:`);
        overrides.forEach((o: any) => {
            console.log(`  ${o.domain} -> ${o.ip} (resolved: ${o.resolvedAt})`);
        });

        fs.unlinkSync(DNS_CACHE_PATH);
        
        console.log('\n✓ DNS cache cleared successfully!');
        console.log('  Playwright will now use normal DNS resolution');
        console.log('  Run tests with: npm run test:e2e');
    } catch (error: any) {
        console.error('✗ Error clearing DNS cache:', error.message);
        process.exit(1);
    }
}

clearDnsCache();
