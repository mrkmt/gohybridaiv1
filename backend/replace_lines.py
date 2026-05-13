import os

file_path = r"d:\KMT\My class\AI\GoHybridAI\backend\src\services\TestExecutionService.ts"

with open(file_path, "r", encoding="utf-8") as f:
    text = f.read()
    
# Split by lines preserving delimiters? No, let's just split by \n
lines = text.replace('\r\n', '\n').split('\n')

# Verify lines around 427
# Python is 0-indexed, so line 427 is index 426
print(f"Line 427: {lines[426]}")
print(f"Line 428: {lines[427]}")

replacement = r"""            // Strategy B: AngularJS route injection (Legacy support)
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
            }

            return false;""".split('\n')

# Check if index 426 actually contains Strategy B
if 'Strategy B: Hash-based routing' in lines[426] and 'return false;' in lines[460]:
    lines = lines[:426] + replacement + lines[461:]
    with open(file_path, "w", encoding="utf-8", newline="\r\n") as f:
        f.write("\n".join(lines))
    print("Replaced by lines successfully!")
else:
    print("Lines did not match expectations!")
    for i in range(420, 435):
        if 'Strategy B: Hash-based routing' in lines[i]:
            print(f"Actually found it at index {i}")
            break
            
