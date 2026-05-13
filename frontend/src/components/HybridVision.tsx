import React, { useState, useEffect } from 'react';
import { Play, Eye, Terminal, Zap, Loader2, Target } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface UIElement {
    id: number;
    tag: string;
    text: string;
    role: string;
    rect: { x: number, y: number, w: number, h: number };
}

export function HybridVision() {
    const [status, setStatus] = useState<'idle' | 'running' | 'thinking' | 'executing'>('idle');
    const [screenshot, setScreenshot] = useState<string | null>(null);
    const [elements, setElements] = useState<UIElement[]>([]);
    const [url, setUrl] = useState('https://test.globalhr.com.mm/ook');
    const [goal, setGoal] = useState('Login to the system using username \"testook_HR 1\" and password \"Global@2024\". Then click on the \"Employee\" menu.');
    const [logs, setLogs] = useState<string[]>([]);

    const addLog = (msg: string) => setLogs(prev => [...prev.slice(-9), `> ${msg}`]);

    const runMission = async () => {
        setStatus('running');
        addLog(`Starting mission: ${goal}`);

        try {
            // 1. Initialize Browser
            await fetch(`${API_URL}/api/hybrid/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            // Loop for max 5 steps
            for (let i = 0; i < 5; i++) {
                addLog(`--- Step ${i + 1} ---`);

                // 2. Capture State
                const stateRes = await fetch(`${API_URL}/api/hybrid/state`, {
                    headers: { 'Content-Type': 'application/json' }
                });
                const { data } = await stateRes.json();
                setScreenshot(data.screenshot);
                setElements(data.elements);

                // 3. AI Thinking (Keyless Puter)
                setStatus('thinking');
                addLog('AI is analyzing UI and Accessibility Tree...');
                
                const prompt = `
                    Analyze this UI to achieve the goal: "${goal}".
                    
                    ACCESSIBILITY TREE (Best for robust selection):
                    ${JSON.stringify(data.ariaSnapshot, null, 2)}

                    INTERESTING ELEMENTS:
                    ${data.elements.map((e: any) => `[ID ${e.id}] ${e.tag}: "${e.text}"`).join('\n')}

                    DECIDE THE NEXT ACTION.
                    Format: { "action": "CLICK" | "TYPE" | "FINISH", "target": ID_NUMBER | "TEXT", "value": "text_to_type", "reason": "why" }
                    Respond ONLY with JSON.
                `.trim();

                const aiResponse = await window.puter.ai.chat(prompt, {
                    model: 'google/gemini-2.0-flash',
                    images: [`data:image/jpeg;base64,${data.screenshot}`]
                });

                const rawContent = typeof aiResponse === 'string' ? aiResponse : aiResponse.message.content;
                const jsonContent = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
                const decision = JSON.parse(jsonContent);
                addLog(`AI Decision: ${decision.action} on ${decision.target} (${decision.reason})`);

                if (decision.action === 'FINISH') {
                    addLog('✅ Mission accomplished!');
                    break;
                }

                // 4. Execute on Backend
                setStatus('executing');
                await fetch(`${API_URL}/api/hybrid/execute`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(decision)
                });

                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (err: any) {
            addLog(`❌ Error: ${err.message}`);
        } finally {
            setStatus('idle');
        }
    };

    const C = {
        bg: '#0f172a',
        surface: '#1e293b',
        border: 'rgba(255,255,255,0.06)',
        accent: '#38bdf8',
        text: '#f8fafc',
        dim: '#94a3b8'
    };

    return (
        <div style={{ display: 'flex', height: '100vh', background: C.bg, color: C.text, padding: 24, gap: 24, fontFamily: 'Inter, sans-serif' }}>
            
            {/* Control Panel */}
            <div style={{ width: 400, display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div style={{ background: C.surface, borderRadius: 20, padding: 24, border: `1px solid ${C.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                        <Zap color={C.accent} fill={C.accent} size={24} />
                        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Hybrid Vision</h2>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div>
                            <label style={{ fontSize: 11, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Target URL</label>
                            <input value={url} onChange={e => setUrl(e.target.value)} style={{ width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', color: C.text, marginTop: 6, fontSize: 13 }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 11, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>AI Goal</label>
                            <textarea value={goal} onChange={e => setGoal(e.target.value)} style={{ width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', color: C.text, marginTop: 6, fontSize: 13, minHeight: 80 }} />
                        </div>
                        
                        <button 
                            onClick={runMission} 
                            disabled={status !== 'idle'}
                            style={{ width: '100%', padding: 14, borderRadius: 14, background: status === 'idle' ? C.accent : C.border, color: '#000', fontWeight: 600, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 8 }}
                        >
                            {status === 'idle' ? <><Play size={18} /> Start Autonomous Vision</> : <><Loader2 size={18} className="animate-spin" /> {status.toUpperCase()}...</>}
                        </button>
                    </div>
                </div>

                <div style={{ flex: 1, background: '#000', borderRadius: 20, padding: 16, border: `1px solid ${C.border}`, overflowY: 'auto' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: C.dim }}>
                        <Terminal size={14} />
                        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>Execution Logs</span>
                    </div>
                    {logs.map((log, i) => <div key={i} style={{ fontSize: 12, color: log.includes('✅') ? '#10b981' : log.includes('❌') ? '#ef4444' : C.text, marginBottom: 4, fontFamily: 'monospace' }}>{log}</div>)}
                </div>
            </div>

            {/* Vision Viewport */}
            <div style={{ flex: 1, background: C.surface, borderRadius: 24, border: `1px solid ${C.border}`, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '16px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Eye size={18} color={C.dim} />
                        <span style={{ fontSize: 13, fontWeight: 500 }}>Live Vision Feed</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#10b981' }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} /> Keyless Puter.js Active
                    </div>
                </div>

                <div style={{ flex: 1, position: 'relative', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {screenshot ? (
                        <div style={{ position: 'relative' }}>
                            <img src={`data:image/jpeg;base64,${screenshot}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                            {elements.map(el => (
                                <div key={el.id} style={{ position: 'absolute', left: el.rect.x, top: el.rect.y, width: el.rect.w, height: el.rect.h, border: '1px solid rgba(56,189,248,0.5)', background: 'rgba(56,189,248,0.1)', cursor: 'help' }} title={`ID ${el.id}: ${el.tag} ${el.text}`} />
                            ))}
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, color: C.dim }}>
                            <Target size={48} opacity={0.2} />
                            <span style={{ fontSize: 14 }}>Waiting for browser session...</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
