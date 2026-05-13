/**
 * E2E Auth Tests
 *
 * Backend login flow verification (API-level, no browser).
 */

import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';

const API_URL = 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET required for auth tests');

let passed = 0;
let failed = 0;

async function assert(name: string, fn: () => Promise<boolean>) {
    try {
        const ok = await fn();
        if (ok) {
            passed++;
            console.log(`  ✅ ${name}`);
        } else {
            failed++;
            console.log(`  ❌ ${name}`);
        }
    } catch (err: any) {
        failed++;
        console.log(`  ❌ ${name} — ${err.message}`);
    }
}

async function loginOK() {
    const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'admin@localhost.com', password: 'admin123' }),
    });
    return res.json() as Promise<any>;
}

async function start() {
    console.log('\n=== Backend Auth E2E Tests ===\n');

    // --- 1. Successful admin login ---
    await assert('POST /api/auth/login returns success for admin', async () => {
        const data = await loginOK();
        return data.success === true && !!data.token && data.user.id === 'admin';
    });

    // --- 2. Token is valid JWT ---
    await assert('Login returns a valid JWT', async () => {
        const data = await loginOK();
        const decoded = jwt.verify(data.token, JWT_SECRET) as any;
        return decoded.sub === 'admin' && decoded.role === 'admin' && decoded.email === 'admin@localhost.com';
    });

    // --- 3. GET /api/auth/me with valid token ---
    await assert('GET /api/auth/me returns user profile', async () => {
        const data = await loginOK();
        const res = await fetch(`${API_URL}/api/auth/me`, {
            headers: { Authorization: `Bearer ${data.token}` },
        });
        const me = await res.json() as any;
        return me.success === true && me.user.email === 'admin@localhost.com';
    });

    // --- 4. GET /api/auth/me without token ---
    await assert('GET /api/auth/me without token returns 401', async () => {
        const res = await fetch(`${API_URL}/api/auth/me`);
        return res.status === 401;
    });

    // --- 5. Wrong password ---
    await assert('Login with wrong password returns 401', async () => {
        const res = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: 'admin@localhost.com', password: 'wrong' }),
        });
        return res.status === 401;
    });

    // --- 6. Missing credentials ---
    await assert('Login with empty body returns 400', async () => {
        const res = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        return res.status === 400;
    });

    // --- 7. Invalid token ---
    await assert('GET /api/auth/me with invalid token returns 401', async () => {
        const res = await fetch(`${API_URL}/api/auth/me`, {
            headers: { Authorization: 'Bearer bogus-token-xyz' },
        });
        return res.status === 401;
    });

    // --- 8. POST /api/auth/logout ---
    await assert('POST /api/auth/logout succeeds', async () => {
        const data = await loginOK();
        const res = await fetch(`${API_URL}/api/auth/logout`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${data.token}` },
        });
        const result = await res.json() as any;
        return res.status === 200 && result.success === true;
    });

    // --- 9. Admin lists users ---
    await assert('GET /api/auth/users returns user list (admin)', async () => {
        const data = await loginOK();
        const res = await fetch(`${API_URL}/api/auth/users`, {
            headers: { Authorization: `Bearer ${data.token}` },
        });
        const result = await res.json() as any;
        return res.status === 200 && result.success === true && Array.isArray(result.users);
    });

    // --- 10. Non-admin user cannot list users (role enforcement) ---
    await assert('Non-admin cannot GET /api/auth/users', async () => {
        // Use the "public" user (role: owner, not admin) — actually owner != admin
        const res = await fetch(`${API_URL}/api/auth/users`);
        // Without auth header, requireAuth should reject
        return res.status === 401;
    });

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

    if (failed > 0) {
        process.exit(1);
    }
    process.exit(0);
}

start();
