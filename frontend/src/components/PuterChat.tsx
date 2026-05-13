import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, MessageSquare, Trash2, Cpu, Zap, RotateCcw } from 'lucide-react';

// Puter is loaded via <script> tag in index.html, so we use the global 'puter' object.
declare global {
    interface Window {
        puter: any;
    }
}

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

export function PuterChat() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [model, setModel] = useState('google/gemini-2.0-flash');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading]);

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMsg: Message = { role: 'user', content: input };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsLoading(true);

        try {
            // Using Puter.js Keyless/Free API
            const response = await window.puter.ai.chat(input, {
                model: model
            });

            const assistantMsg: Message = { 
                role: 'assistant', 
                content: typeof response === 'string' ? response : (response.message?.content || JSON.stringify(response))
            };
            setMessages(prev => [...prev, assistantMsg]);
        } catch (error: any) {
            console.error('Puter Chat Error:', error);
            setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${error.message || 'Failed to get response from Puter.'}` }]);
        } finally {
            setIsLoading(false);
        }
    };

    const C = {
        bg: '#0f172a',
        sidebar: '#1e293b',
        border: 'rgba(255,255,255,0.06)',
        text: '#f8fafc',
        dim: '#94a3b8',
        accent: '#38bdf8',
        accentSurface: 'rgba(56,189,248,0.1)',
        input: '#1e293b',
        userMsg: '#334155',
        aiMsg: '#1e293b'
    };

    return (
        <div style={{ display: 'flex', height: '100vh', background: C.bg, color: C.text, fontFamily: 'Inter, system-ui, sans-serif' }}>
            {/* Main Chat Area */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
                
                {/* Header */}
                <header style={{ height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', borderBottom: `1px solid ${C.border}`, background: 'rgba(15,23,42,0.8)', backdropFilter: 'blur(8px)', zIndex: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000' }}>
                            <Cpu size={20} />
                        </div>
                        <div>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>Free AI Assistant</div>
                            <div style={{ fontSize: 11, color: '#10b981', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Zap size={10} fill="#10b981" /> Powered by Puter.js (Keyless)
                            </div>
                        </div>
                    </div>
                    
                    <select 
                        value={model} 
                        onChange={(e) => setModel(e.target.value)}
                        style={{ background: C.sidebar, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '4px 8px', fontSize: 12, outline: 'none' }}
                    >
                        <option value="google/gemini-2.0-flash">Gemini 2.0 Flash</option>
                        <option value="google/gemini-1.5-pro">Gemini 1.5 Pro</option>
                        <option value="deepseek/deepseek-v3">DeepSeek V3</option>
                        <option value="openai/gpt-4o">GPT-4o</option>
                        <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
                    </select>
                </header>

                {/* Messages */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '24px 0' }}>
                    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '0 20px' }}>
                        {messages.length === 0 ? (
                            <div style={{ height: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                                <div style={{ width: 64, height: 64, borderRadius: 20, background: C.accentSurface, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.accent, marginBottom: 24 }}>
                                    <Sparkles size={32} />
                                </div>
                                <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>Keyless Free AI</h2>
                                <p style={{ color: C.dim, maxWidth: 400, fontSize: 14, lineHeight: 1.6 }}>
                                    This chat uses Puter.js to provide unlimited AI for developers. No API keys, no monthly bills.
                                </p>
                            </div>
                        ) : (
                            messages.map((msg, i) => (
                                <div key={i} style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                                    <div style={{ 
                                        maxWidth: '85%', 
                                        padding: '12px 18px', 
                                        borderRadius: 18, 
                                        fontSize: 14, 
                                        lineHeight: 1.5,
                                        background: msg.role === 'user' ? C.accent : C.aiMsg,
                                        color: msg.role === 'user' ? '#000' : C.text,
                                        border: msg.role === 'user' ? 'none' : `1px solid ${C.border}`,
                                        whiteSpace: 'pre-wrap'
                                    }}>
                                        {msg.content}
                                    </div>
                                    <div style={{ fontSize: 10, color: C.dim, marginTop: 4, marginLeft: 8, marginRight: 8 }}>
                                        {msg.role === 'user' ? 'You' : 'AI'}
                                    </div>
                                </div>
                            ))
                        )}
                        {isLoading && (
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center', color: C.dim }}>
                                <div style={{ width: 32, height: 32, borderRadius: 8, background: C.sidebar, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <RotateCcw size={16} className="animate-spin" />
                                </div>
                                <span style={{ fontSize: 12 }}>Thinking...</span>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                </div>

                {/* Input Area */}
                <div style={{ padding: '0 20px 32px' }}>
                    <div style={{ maxWidth: '800px', margin: '0 auto', position: 'relative', background: C.input, borderRadius: 20, border: `1px solid ${C.border}`, padding: '8px 12px', boxShadow: '0 10px 30px -10px rgba(0,0,0,0.5)' }}>
                        <textarea 
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                            placeholder={`Message ${model.split('/').pop()}...`}
                            style={{ width: '100%', background: 'transparent', border: 'none', color: C.text, padding: '12px', outline: 'none', resize: 'none', minHeight: '44px', maxHeight: '200px', fontSize: 14 }}
                        />
                        <button 
                            onClick={handleSend}
                            disabled={!input.trim() || isLoading}
                            style={{ position: 'absolute', right: 12, bottom: 12, width: 32, height: 32, borderRadius: 10, background: input.trim() ? C.accent : 'transparent', color: input.trim() ? '#000' : C.dim, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.2s' }}
                        >
                            <Send size={18} />
                        </button>
                    </div>
                    <div style={{ textAlign: 'center', marginTop: 12, fontSize: 11, color: C.dim }}>
                        GoHybrid AI × Puter.js — Free & Unlimited AI Integration
                    </div>
                </div>
            </div>

            {/* Simple Sidebar for History (Static for now) */}
            <div style={{ width: 260, background: C.sidebar, borderLeft: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
                    <MessageSquare size={18} color={C.accent} />
                    <span style={{ fontWeight: 600, fontSize: 14 }}>Recent Sessions</span>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ padding: '10px 12px', borderRadius: 10, background: C.accentSurface, color: C.accent, fontSize: 13, cursor: 'pointer' }}>
                        Current Chat
                    </div>
                </div>
                <button 
                    onClick={() => setMessages([])}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px', borderRadius: 10, background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: 'none', cursor: 'pointer', marginTop: 'auto', fontSize: 13 }}
                >
                    <Trash2 size={16} /> Clear Conversation
                </button>
            </div>
        </div>
    );
}

