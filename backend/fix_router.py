import re

with open('src/services/TestExecutionService.ts', 'r', encoding='utf-8') as f:
    code = f.read()

pattern = r"// Strategy B: Hash-based routing.*?console\.log\(\\[SmartNavigate\] Route injection failed: \$\{e\.message\}\\);\s*\}"
replacement = r'''// Strategy B (Legacy AngularJS Priority): Try .go() first if it's an AngularJS app
            try {
                const injected = await page.evaluate((r) => {
                    try {
                        const el = document.querySelector('[ng-app]') || document.body;
                        const  = (window as any).angular?.element(el)?.injector();
                        if () {
                            const  = .get('');
                            if () { .go(r); return true; }
                        }
                    } catch (e) {}
                    return false;
                }, routeHint);
                
                if (injected) {
                    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                    await page.waitForTimeout(1000);
                    return true;
                }
            } catch (e: any) {
                console.log([SmartNavigate] Route injection check failed: );
            }

            // Strategy C: Hash-based routing (Standard for modern SPA or fallback)
            // If routeHint has a dot and no slashes, it's a state name. We shouldn't use it as a URL path.
            if (routeHint.includes('.') && !routeHint.includes('/')) {
                 console.log([SmartNavigate] routeHint looks like a state name, not navigating via hash.);
                 return false;
            }

            const cleanRoute = routeHint.replace(/^#\/?/, '').replace(/^\//, '');
            const currentUrl = page.url();
            const baseUrlWithHash = currentUrl.split('#')[0].replace(/\/$/, '') + '#/';
            
            try {
                // Try direct hash change via URL
                await page.goto(baseUrlWithHash + cleanRoute, { waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                return true;
            } catch (e: any) {
                console.log([SmartNavigate] Hash navigation failed);
            }'''

new_code, num_subs = re.subn(pattern, replacement, code, flags=re.DOTALL)

if num_subs > 0:
    with open('src/services/TestExecutionService.ts', 'w', encoding='utf-8') as f:
        f.write(new_code)
    print("Replaced successfully!")
else:
    print("Pattern not found!")
