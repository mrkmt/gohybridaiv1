import { Pool } from 'pg';
import { config } from './api/config';
import jwt from 'jsonwebtoken';

const API = 'http://localhost:3000';

async function main() {
    // 1. Create a valid JWT token directly (bypass login)
    const token = jwt.sign(
        { sub: 'admin', id: 'admin', email: 'admin@localhost.com', role: 'admin' },
        config.server.jwtSecret,
        { expiresIn: '1h' }
    );
    console.log('Token:', token.substring(0, 30) + '...');

    // 2. Call the chat/mention API
    try {
        const res = await fetch(`${API}/api/testing/chat/mention`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ message: 'ATT-15', autoTrigger: false })
        });
        
        console.log('=== RESPONSE ===');
        console.log('Status:', res.status);
        console.log('OK:', res.ok);
        
        const text = await res.text();
        console.log('Body:', text.substring(0, 1000));
        
        // Parse and inspect
        try {
            const json = JSON.parse(text);
            console.log('\n=== PARSED ===');
            console.log('Has success:', json.success);
            console.log('Has data:', !!json.data);
            console.log('Has data.data:', !!json.data?.data);
            console.log('data.tickets:', json.data?.tickets);
            console.log('data.data?.tickets:', json.data?.data?.tickets);
            
            // Check all keys
            console.log('\n=== TOP-LEVEL KEYS ===', Object.keys(json));
            if (json.data) console.log('data KEYS:', Object.keys(json.data));
            if (json.data?.data) console.log('data.data KEYS:', Object.keys(json.data.data));
        } catch {}
    } catch (err: any) {
        console.error('Fetch error:', err.message);
    }
}

main();
