// This project uses Playwright at runtime, but in some environments the installed
// `playwright-core` package can be missing its `.d.ts` files, which makes TypeScript
// think `playwright` has no named exports (e.g. `chromium`).
//
// This ambient declaration keeps `ts-node`/`tsc` happy without changing runtime behavior.
declare module 'playwright' {
  // Keep this intentionally loose: we only need runtime Playwright, not full typing.
  export const chromium: any;
  export type Browser = any;
  export type BrowserContext = any;
  export type Page = any;
  export type Locator = any;
}

declare module '@playwright/test' {
  export const test: any;
  export const expect: any;
  export const chromium: any;
  export const devices: any;
  export type Browser = any;
  export type BrowserContext = any;
  export type Page = any;
  export type Locator = any;
}
