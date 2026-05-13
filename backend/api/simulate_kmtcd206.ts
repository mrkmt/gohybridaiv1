import fetch from 'node-fetch';

async function simulateRecording() {
    console.log("📤 Simulating KMTCD-206 Recording Upload...");

    const API_URL = "http://localhost:3000/api";

    const failedPayload = {
        sessionId: `kmtcd-206-fail-${Date.now()}`,
        appVersion: 'global-hr-1.0',
        module: 'auth',
        environment: { browser: 'chrome', url: 'https://www.globalhr.app/abcd#/login' },
        steps: [
            { type: 'input', selector: '#id_number', value: 'kmtcd-206', timestamp: Date.now() - 5000 },
            { type: 'input', selector: '#username', value: 'ursa', timestamp: Date.now() - 4000 },
            { type: 'input', selector: '#password', value: 'Global@2026', timestamp: Date.now() - 3000 },
            { type: 'click', selector: '#login_btn', timestamp: Date.now() - 2000 }
        ],
        annotations: [
            { text: "အိုင်ဒီ kmtcd-206၊ အသုံးပြုသူ ursa နဲ့ password Global@2026 ကိုသုံးပြီး log in ဝင်ပေမယ့် မအောင်မြင်ပါဘူး။", timestamp: Date.now() }
        ]
    };

    try {
        const res = await fetch(`${API_URL}/recordings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(failedPayload)
        });
        const data = await res.json();
        console.log("✅ Simulated Recording Created ID:", data.id);

        // Trigger Triage
        console.log("--- Triggering AI Triage ---");
        const triageRes = await fetch(`${API_URL}/triage/${data.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                error: "The user name or password is incorrect."
            })
        });
        const triage = await triageRes.json();
        console.log("AI Suggestion:", triage.suggestion);

    } catch (err) {
        console.error("❌ Simulation Failed:", err);
    }
}

simulateRecording();
