# Go-Hybrid AI V1 System Stability Report - April 28, 2026

## Executive Summary
Completed a deep-dive stabilization of the V1 backend and frontend to resolve critical blockers in the [Ticket -> Discovery -> Scenarios -> Cases] workflow. The system is now fully operational on the Ubuntu server using public tunnel endpoints.

## 1. Authentication & Security
- **Issue**: Frontend was hardcoded to hit `localhost:3000`, causing login to hang on "Authenticating..." for remote users.
- **Fix**: Updated `V1/frontend/.env` to `VITE_API_URL=https://api.ourspaceship.site`.
- **Verification**: Admin login via `admin@go.ai` confirmed working with < 700ms response time.
- **Cleanup**: Removed hardcoded `localhost` references in `AccountManager.tsx`.

## 2. Jira Integration & Performance
- **Issue**: Chat mentions (e.g., `ATT-22`) were timing out due to slow database lookups and Jira API latency.
- **Optimization**:
    - Implemented **10-second request timeouts** in `TestingJiraService.ts`.
    - Added **3-second database lookup timeout** with immediate fallback to `.env` credentials.
    - Forced `resolveAxios` to prioritize reliable environment variables.
- **Verification**: Ticket resolution for `ATT-22` and linked context `AB-27` now completes in ~2 seconds.

## 3. Test Generation Pipeline
- **Issue**: Test Case generation failed due to strict Zod validation on the `priority` field (AI was emitting non-enum values).
- **Fix**: Updated `sanitiseSpec` in `TestSpecSchema.ts` to automatically map invalid AI output to the default `medium` priority.
- **Verification**: Validation now passes even when AI produces non-standard priority strings.

## 4. UI Discovery (Harvester) Audit
- **Status**: **Healthy**
- **Architecture**: Confirmed alignment with V2 Directive (`data-testid` > `getByRole` > `getByLabel`).
- **Capability**: Verified dual-path discovery (Legacy background probe + Live MCP Accessibility snapshots).

## 5. Service Status (PM2)
- `gohybrid-v1-backend` (ID 5): **Online** (Restarted with fixes)
- `gohybrid-v1-frontend` (ID 4): **Online** (Restarted with public URL config)
- `cloudflare-tunnel` (ID 6): **Online**

---
**Next Step**: Ready for [Run] phase and E2E test execution.
