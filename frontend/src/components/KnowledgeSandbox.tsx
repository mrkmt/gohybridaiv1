import React, { useState, useRef, useEffect } from 'react';
import { Send, Search, Database, FileText, Activity, Terminal, Shield, MessageCircle, Minimize2, Maximize2, ChevronDown, ChevronUp, Square, Minus } from 'lucide-react';

interface Source {
    type: 'matrix' | 'document';
    id: string;
    text_snippet: string;
}

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    sources?: Source[];
    timestamp: Date;
}

export const KnowledgeSandbox: React.FC<{ apiUrl: string }> = ({ apiUrl }) => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [simulateMode, setSimulateMode] = useState(false);
    const [templates, setTemplates] = useState<{ label: string, content: string }[]>([]);
    const [isMinimized, setIsMinimized] = useState(false);
    const [isMaximized, setIsMaximized] = useState(false);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const handleDownloadTranscript = () => {
        const text = messages.map(m => `[${m.role.toUpperCase()}] ${m.content}`).join('\n\n');
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sandbox-transcript-${new Date().toISOString().split('T')[0]}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleClearHistory = () => {
        if (window.confirm('Clear all messages?')) {
            setMessages([
                {
                    id: 'initial-msg',
                    role: 'assistant',
                    content: 'Hi! I am the Go-Hybrid AI Brain. You can ask me about business rules, or test me with a Jira ticket summary.',
                    timestamp: new Date(),
                },
            ]);
        }
    };

    // Smart Scroll: Only auto-scroll if user is already near bottom
    useEffect(() => {
        const container = chatContainerRef.current;
        if (!container) return;

        const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 100;
        if (isAtBottom) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages]);

    const fetchTemplates = async () => {
        try {
            const res = await fetch(`${apiUrl}/api/knowledge/templates`);
            const data = await res.json();
            setTemplates(data);
        } catch (err) {
            console.error('Failed to fetch templates');
        }
    };

    useEffect(() => {
        if (simulateMode) {
            fetchTemplates();
        }
    }, [simulateMode]);

    const handleSend = async (override?: string) => {
        const textToSend = override || input;
        if (!textToSend.trim() || loading) return;

        const userMsg: ChatMessage = {
            id: Date.now().toString(),
            role: 'user',
            content: textToSend,
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setLoading(true);

        try {
            const res = await fetch(`${apiUrl}/api/knowledge/test-query`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: textToSend })
            });

            if (!res.ok) throw new Error('Failed to query knowledge base');

            const data = await res.json();

            const aiMsg: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: data.answer,
                sources: data.sources,
                timestamp: new Date()
            };

            setMessages(prev => [...prev, aiMsg]);
        } catch (error: any) {
            const errorMsg: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: `Error: ${error.message}`,
                timestamp: new Date()
            };
            setMessages(prev => [...prev, errorMsg]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={`kb-sandbox-container ${isMinimized ? 'minimized' : ''} ${isMaximized ? 'maximized' : ''}`}>
            <div className="sandbox-header">
                <div className="header-left-side">
                    <div className="header-title">
                        <Shield className="w-5 h-5 text-indigo-400" />
                        <h2>AI Knowledge Sandbox</h2>
                    </div>

                    <div className="header-actions">
                        <button
                            className={`simulate-toggle ${simulateMode ? 'active' : ''}`}
                            onClick={() => setSimulateMode(!simulateMode)}
                        >
                            <Activity className="w-4 h-4" />
                            {simulateMode ? 'Exit Simulation' : 'Simulate Ticket'}
                        </button>
                        <button
                            className="control-btn"
                            onClick={handleDownloadTranscript}
                            title="Download Transcript"
                        >
                            <FileText size={16} />
                        </button>
                        <button
                            className="control-btn"
                            onClick={handleClearHistory}
                            title="Clear History"
                        >
                            <Minus size={16} />
                        </button>
                    </div>
                </div>

                <div className="window-controls">
                    <button className="control-btn" onClick={() => setIsMinimized(!isMinimized)} title={isMinimized ? "Restore" : "Minimize"}>
                        {isMinimized ? <ChevronUp size={16} /> : <Minus size={16} />}
                    </button>
                    <button className="control-btn" onClick={() => setIsMaximized(!isMaximized)} title={isMaximized ? "Restore" : "Maximize"}>
                        {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    </button>
                </div>
            </div>

            {!isMinimized && (
                <>
                    <div className="chat-window">
                        {simulateMode && templates.length > 0 && (
                            <div className="sticky-templates">
                                <span className="text-xs text-gray-400 mb-2 block">Try a simulation template:</span>
                                <div className="example-chips">
                                    {templates.map((t, i) => (
                                        <button key={i} onClick={() => handleSend(t.content)} disabled={loading}>
                                            {t.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {messages.length === 0 ? (
                            <div className="empty-chat">
                                <MessageCircle className="w-12 h-12 text-gray-600 mb-4" />
                                <h3>{simulateMode ? 'Jira Ticket Simulation' : 'Ask Go-Hybrid AI anything'}</h3>
                                <p>{simulateMode ? 'Select a template above or paste your own ticket text to test the AI Logic.' : 'Query the Business Logic Matrix and Documentation in real-time.'}</p>
                                {!simulateMode && (
                                    <div className="example-chips">
                                        <button onClick={() => setInput('How do I apply for maternity leave?')}>Maternity Leave Rule</button>
                                        <button onClick={() => setInput('What is the formula for EL deduction?')}>EL Deduction Formula</button>
                                        <button onClick={() => setInput('Show me browser settings for GlobalHR')}>Browser Settings</button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            messages.map((msg) => (
                                <div key={msg.id} className={`message-row ${msg.role}`}>
                                    <div className="message-bubble">
                                        <div className="message-content">{msg.content}</div>
                                        {msg.sources && msg.sources.length > 0 && (
                                            <div className="message-sources">
                                                <h4>🔍 Sources:</h4>
                                                <div className="source-chips">
                                                    {msg.sources.map((source, i) => (
                                                        <div key={i} className="source-chip" title={source.text_snippet}>
                                                            {source.type === 'matrix' ? (
                                                                <Database className="w-3 h-3 text-indigo-400" />
                                                            ) : (
                                                                <FileText className="w-3 h-3 text-emerald-400" />
                                                            )}
                                                            <span>{source.type === 'matrix' ? 'Rule Matrix' : 'Documentation'}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        <div className="message-time">
                                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                        {loading && (
                            <div className="message-row assistant">
                                <div className="message-bubble typing">
                                    <span className="dot"></span>
                                    <span className="dot"></span>
                                    <span className="dot"></span>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    <div className="chat-input-area">
                        <textarea
                            placeholder={simulateMode ? "Paste Jira ticket summary/description here..." : "Ask a question..."}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                            }}
                        />
                        <button onClick={() => handleSend()} disabled={loading || !input.trim()}>
                            <Send className="w-5 h-5" />
                        </button>
                    </div>
                </>
            )}

            <style>{`
                .kb-sandbox-container {
                    display: flex;
                    flex-direction: column;
                    height: calc(100vh - 80px); /* Taller view */
                    width: 100%;
                    max-width: 100% !important;
                    background: #0f172a;
                    border-radius: 12px;
                    border: 1px solid #1e293b;
                    overflow: hidden;
                    margin: 0;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    position: relative;
                    z-index: 100;
                }

                .kb-sandbox-container.maximized {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    height: 100vh !important;
                    width: 100vw !important;
                    z-index: 9999;
                    border-radius: 0;
                }

                .kb-sandbox-container.minimized {
                    height: 56px !important;
                    overflow: hidden;
                }

                .sandbox-header {
                    padding: 12px 24px;
                    background: #1e293b;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid #334155;
                    user-select: none;
                }

                .header-left-side {
                    display: flex;
                    align-items: center;
                    gap: 20px;
                }

                .header-title {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .header-title h2 {
                    margin: 0;
                    font-size: 1.1rem;
                    color: #f8fafc;
                }

                .simulate-toggle {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 6px 14px;
                    border-radius: 6px;
                    background: #334155;
                    border: 1px solid #475569;
                    color: #94a3b8;
                    font-size: 0.85rem;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .simulate-toggle.active {
                    background: #4f46e5;
                    border-color: #6366f1;
                    color: white;
                }

                .window-controls {
                    display: flex;
                    gap: 8px;
                }

                .control-btn {
                    background: transparent;
                    border: 1px solid transparent;
                    color: #94a3b8;
                    width: 32px;
                    height: 32px;
                    border-radius: 4px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .control-btn:hover {
                    background: rgba(255, 255, 255, 0.05);
                    color: white;
                    border-color: #334155;
                }

                .chat-window {
                    flex: 1;
                    overflow-y: auto;
                    padding: 24px;
                    display: flex;
                    flex-direction: column;
                    gap: 20px;
                    background: #0f172a;
                }

                .sticky-templates {
                    background: #1e293b;
                    padding: 16px;
                    border-radius: 8px;
                    border: 1px solid #334155;
                    margin-bottom: 8px;
                    position: sticky;
                    top: 0;
                    z-index: 10;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                }

                .sticky-templates .example-chips {
                    justify-content: flex-start;
                    margin-top: 8px;
                }

                .empty-chat {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    color: #94a3b8;
                    text-align: center;
                }

                .example-chips {
                    display: flex;
                    gap: 10px;
                    margin-top: 20px;
                    flex-wrap: wrap;
                    justify-content: center;
                }

                .example-chips button {
                    background: #1e293b;
                    border: 1px solid #334155;
                    padding: 6px 16px;
                    border-radius: 20px;
                    color: #cbd5e1;
                    font-size: 0.85rem;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .example-chips button:hover {
                    border-color: #4f46e5;
                    background: #1e1b4b;
                }

                .message-row {
                    display: flex;
                    width: 100%;
                }

                .message-row.user {
                    justify-content: flex-end;
                }

                .message-bubble {
                    max-width: 80%;
                    padding: 12px 16px;
                    border-radius: 12px;
                    position: relative;
                }

                .message-row.user .message-bubble {
                    background: #4f46e5;
                    color: white;
                    border-bottom-right-radius: 2px;
                }

                .message-row.assistant .message-bubble {
                    background: #1e293b;
                    color: #e2e8f0;
                    border-bottom-left-radius: 2px;
                    border: 1px solid #334155;
                }

                .message-content {
                    line-height: 1.5;
                    white-space: pre-wrap;
                }

                .message-sources {
                    margin-top: 12px;
                    padding-top: 12px;
                    border-top: 1px solid #334155;
                }

                .message-sources h4 {
                    margin: 0 0 8px 0;
                    font-size: 0.75rem;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: #64748b;
                }

                .source-chips {
                    display: flex;
                    gap: 8px;
                    flex-wrap: wrap;
                }

                .source-chip {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    background: #0f172a;
                    padding: 4px 10px;
                    border-radius: 4px;
                    font-size: 0.75rem;
                    border: 1px solid #334155;
                }

                .message-time {
                    font-size: 0.7rem;
                    color: #64748b;
                    margin-top: 6px;
                    text-align: right;
                }

                .chat-input-area {
                    padding: 20px;
                    background: #1e293b;
                    display: flex;
                    gap: 16px;
                    border-top: 1px solid #334155;
                }

                .chat-input-area textarea {
                    flex: 1;
                    background: #0f172a;
                    border: 1px solid #334155;
                    border-radius: 8px;
                    padding: 12px;
                    color: #f8fafc;
                    resize: none;
                    height: 50px;
                    font-family: inherit;
                    transition: border-color 0.2s;
                }

                .chat-input-area textarea:focus {
                    outline: none;
                    border-color: #4f46e5;
                }

                .chat-input-area button {
                    background: #4f46e5;
                    color: white;
                    border: none;
                    width: 50px;
                    height: 50px;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    transition: background 0.2s;
                }

                .chat-input-area button:hover:not(:disabled) {
                    background: #4338ca;
                }

                .chat-input-area button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .typing {
                    display: flex;
                    gap: 4px;
                    padding: 12px 20px;
                }

                .typing .dot {
                    width: 6px;
                    height: 6px;
                    background: #64748b;
                    border-radius: 50%;
                    animation: bounce 1.4s infinite ease-in-out both;
                }

                .typing .dot:nth-child(1) { animation-delay: -0.32s; }
                .typing .dot:nth-child(2) { animation-delay: -0.16s; }

                @keyframes bounce {
                    0%, 80%, 100% { transform: scale(0); }
                    40% { transform: scale(1.0); }
                }
            `}</style>
        </div>
    );
};
