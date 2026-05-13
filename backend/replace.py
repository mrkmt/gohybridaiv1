import os

file_path = r"d:\KMT\My class\AI\GoHybridAI\backend\src\services\TestExecutionService.ts"

with open(file_path, "r", encoding="utf-8") as f:
    text = f.read()

target = r"""            // Strategy B: Hash-based routing (Standard for Angular apps)
            const cleanRoute = routeHint.replace(/^#\/?/, '').replace(/^\//, '');
            const currentUrl = page.url();
            const baseUrlWithHash = currentUrl.split('#')[0].replace(/\/$/, '') + '#/';
            
            try {
                // Try direct hash change via URL
                await page.goto(baseUrlWithHash + cleanRoute, { waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                return true;
            } catch (e: any) {
                console.log([SmartNavigate] Hash navigation failed, trying AngularJS injection...);
            }

            // Strategy C: AngularJS route injection (Legacy support)
            try {
                await page.evaluate((r) => {
                    try {
                        const el = document.querySelector('[ng-app]') || document.body;
                        const  = (window as any).angular?.element(el)?.injector();
                        if () {
                            const  = .get('');
                            if () { .go(r); return true; }
                        }
                    } catch (e) {}
                    window.location.hash = '#/' + r;
                    return true;
                }, routeHint);
                await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                return true;
            } catch (e: any) {
                console.log([SmartNavigate] Route injection failed: );
            }"""

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
                await page.goto(baseUrlWithHash + cleanRoute, { waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                return true;
            } catch (e: any) {
                console.log([SmartNavigate] Hash navigation failed);
            }"""

if target in text:
    new_text = text.replace(target, replacement)
    with open(file_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(new_text)
    print("Replaced successfully!")
else:
    print("Target not found! Normalizing newlines and trying again...")
    text_normalized = text.replace('\r\n', '\n')
    target_normalized = target.replace('\r\n', '\n')
    if target_normalized in text_normalized:
        new_text = text_normalized.replace(target_normalized, replacement.replace('\r\n', '\n'))
        with open(file_path, "w", encoding="utf-8", newline="\n") as f:
            f.write(new_text)
        print("Replaced successfully after normalization!")
    else:
        print("Still not found!")
