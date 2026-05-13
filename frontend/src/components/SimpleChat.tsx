/**
 * SimpleChat – Gemini-style conversation UI for GoHybrid AI
 * Unified Autonomous Discovery & Testing Interface
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Send, Plus, Settings, MessageSquare, Trash2, X, Sparkles, ChevronLeft, ChevronRight,
    Wifi, WifiOff, RotateCcw, Mic, Paperclip, MicOff, Play, Settings2, LogOut, Zap, Eye,
    SlidersHorizontal, Rocket, Loader2, Activity
} from 'lucide-react';

import { ChatMessage, ChatSession } from './chat/types';
import { ChatMessageList } from './chat/ChatMessageList';
import { md, formatDate } from './chat/utils';
import { LiveMirror } from './chat/LiveMirror';

import { TestCaseEditorModal } from './TestCaseEditorModal';
import { SettingsPanel } from './SettingsPanel';
import { useTestExecutionWebSocket } from '../hooks/useTestExecutionWebSocket';
import { useAuth } from '../context/AuthContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/* ─────────────── Helpers ─────────────── */

function authedFetch(url: string, options: RequestInit = {}, timeoutMs: number = 30000): Promise<Response> {
    const token = localStorage.getItem('auth_token');
    const headers: Record<string, string> = { 
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> || {}) 
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const fetchOptions: RequestInit = { ...options, headers };
    if (!fetchOptions.signal) fetchOptions.signal = AbortSignal.timeout(timeoutMs);
    return fetch(url, fetchOptions);
}

function showToast(message: string, type: 'info' | 'error' = 'info') {
    const toast = document.createElement('div');
    toast.className = 'gm-toast-enter';
    toast.style.position = 'fixed';
    toast.style.bottom = '24px';
    toast.style.right = '24px';
    toast.style.padding = '14px 28px';
    toast.style.borderRadius = '16px';
    toast.style.background = type === 'error' ? 'rgba(239, 68, 68, 0.95)' : 'rgba(14, 165, 233, 0.95)';
    toast.style.color = '#fff';
    toast.style.zIndex = '10000';
    toast.style.boxShadow = '0 20px 40px rgba(0,0,0,0.4)';
    toast.style.backdropFilter = 'blur(10px)';
    toast.style.fontSize = '14px';
    toast.style.fontWeight = '600';
    toast.innerText = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        toast.style.transition = '0.4s cubic-bezier(0.4, 0, 0.2, 1)';
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

const SUGGESTIONS = [
    { label: 'Analyze Jira Ticket', desc: 'Paste a Ticket ID (e.g. ATT-15) to start forensic testing', icon: MessageSquare, mode: 'testing' },
    { label: 'ERP Expert Chat', desc: 'Ask about GlobalHR modules, business logic, or system rules', icon: Zap, mode: 'general' },
    { label: 'System Health Check', desc: 'Verify AI connectivity and background services', icon: Play, action: 'health' },
    { label: 'New Testing Mission', desc: 'Initialize a fresh detective session for a new module', icon: Rocket, action: 'new' },
];

export function SimpleChat() {
    const { logout } = useAuth();
    const navigate = useNavigate();

    /* ── Basic State ── */
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialLoad, setIsInitialLoad] = useState(true);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [backendOnline, setBackendOnline] = useState<boolean | null>(null);

    /* ── Workflow State ── */
    const [chatMode, setChatMode] = useState<'general' | 'testing'>('testing');
    const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false);
    const [maxTestScenarios, setMaxTestScenarios] = useState(5);
    const [maxTestCasesPerScenario, setMaxTestCasesPerScenario] = useState(5);
    const [memoryEnhancement, setMemoryEnhancement] = useState(false);
    const [projectInstructions, setProjectInstructions] = useState("");

    const [currentTicket, setCurrentTicket] = useState<any>(null);
    const [scenarios, setScenarios] = useState<any[]>([]);
    const [userScenarios, setUserScenarios] = useState<any[]>([]);
    const [userScenarioInput, setUserScenarioInput] = useState('');
    const [testCases, setTestCases] = useState<any[]>([]);
    const [isGeneratingTestCases, setIsGeneratingTestCases] = useState(false);
    const [isExecutingTests, setIsExecutingTests] = useState(false);
    const [executionResults, setExecutionResults] = useState<any[]>([]);
    const [isPostingToJira, setIsPostingToJira] = useState(false);
    const [isUploadingReport, setIsUploadingReport] = useState(false);
    const [isReportUploaded, setIsReportUploaded] = useState(false);
    const [isTestCaseModalOpen, setIsTestCaseModalOpen] = useState(false);
    const [environment, setEnvironment] = useState({ 
        baseUrl: "https://test.globalhr.com.mm/ook",
        stage: "testing"
    });
    const [needsRegeneration, setNeedsRegeneration] = useState(false);
    const [aiLogs, setAiLogs] = useState<any[]>([]);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const activeSession = useMemo(() => sessions.find(s => s.id === activeSessionId), [sessions, activeSessionId]);

    /* ── WebSocket Integration ── */
    const { logs: executionLog, status: wsStatus, lastLog } = useTestExecutionWebSocket(
        currentTicket?.ticketId || 'GLOBAL-SCAN',
        localStorage.getItem('auth_token'),
        {
            onMessage: (msg) => {
                if (msg.type === 'TELEMETRY_LOG') {
                    const log = msg.payload || (msg as any).log;
                    if (log && (log.source?.includes('AI') || log.source?.includes('Agent'))) {
                        setAiLogs(prev => [...prev.slice(-19), log]);
                    }
                }
            }
        }
    );

    const liveScreenshot = useMemo(() => {
        if (lastLog?.metadata?.screenshot) {
            return `data:image/jpeg;base64,${lastLog.metadata.screenshot}`;
        }
        return null;
    }, [lastLog]);

    /* ── Effects ── */
    useEffect(() => {
        const loadSessions = async () => {
            try {
                const res = await authedFetch(`${API_URL}/api/chat-sessions`);
                if (res.ok) {
                    const data = await res.json();
                    setSessions(data);
                    if (data.length > 0) setActiveSessionId(data[0].id);
                }
            } finally {
                setIsInitialLoad(false);
            }
        };
        loadSessions();
        checkBackend();
    }, []);

    useEffect(() => {
        if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }, [activeSession?.messages, executionLog]);

    /* ── Handlers ── */
    const checkBackend = async () => {
        try {
            const res = await fetch(`${API_URL}/api/health`);
            setBackendOnline(res.ok);
        } catch {
            setBackendOnline(false);
        }
    };

    const createNewSession = async () => {
        try {
            const newId = `session-${Date.now()}`;
            const newSession = {
                id: newId, title: 'New Chat', messages: [],
                last_modified: Date.now(), lastModified: Date.now()
            };
            const res = await authedFetch(`${API_URL}/api/chat-sessions`, { method: 'POST', body: JSON.stringify(newSession) });
            if (res.ok) {
                setSessions([newSession as any, ...sessions]);
                setActiveSessionId(newId);
                showToast('New session created');
            }
        } catch (err: any) {
            showToast(`Error: ${err.message}`, 'error');
        }
    };

    const updateLocalSession = (sessionId: string, msg: ChatMessage) => {
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, messages: [...s.messages, msg], lastModified: Date.now() } : s));
    };

    const handleStartTesting = async (ticketId: string) => {
        showToast(`Starting workflow for ${ticketId}...`);
        setIsLoading(true);

        try {
            // 1. Properly start the mission (Jira transition + session creation)
            await authedFetch(`${API_URL}/api/testing/${ticketId}/start`, {
                method: 'POST',
                body: JSON.stringify({ autoTransition: true })
            }).catch(e => console.error('Start mission failed', e));

            // 2. Trigger the background scan (Silent but tracked in AI logs)
            authedFetch(`${API_URL}/api/discovery/auto-scan`, {
                method: 'POST',
                body: JSON.stringify({ 
                    baseUrl: "https://test.globalhr.com.mm/ook", 
                    credentials: { ticketId: ticketId, idNumber: "testook_HR 1", username: "testook_HR 1", password: "Global@2024" } 
                })
            }).catch(e => console.error('Discovery trigger failed', e));

            // 3. Generate Scenarios (Wait for AI)
            const res = await authedFetch(`${API_URL}/api/testing/${ticketId}/scenarios`, {
                method: 'POST',
                body: JSON.stringify({ maxScenarios: maxTestScenarios })
            });
            if (res.ok) {
                const data = await res.json();
                const scenariosList = data.data?.scenarios || data.scenarios || [];
                setScenarios(scenariosList);
                updateLocalSession(activeSessionId!, {
                    id: Date.now().toString(),
                    role: 'assistant',
                    content: `I've analyzed the mission requirements. Here are the **Test Scenarios** I recommend covering for **${ticketId}**.`,
                    timestamp: new Date().toISOString(),
                    actionBlock: { type: 'scenarios_selection', scenarios: scenariosList.map((s:any) => ({...s, selected: true})) }
                });
            }
        } catch (e) { showToast('Scenario generation failed', 'error'); }
        finally { setIsLoading(false); }
    };

    const handleConfirmScenarios = async (selected: any[]) => {
        setIsGeneratingTestCases(true);
        try {
            const res = await authedFetch(`${API_URL}/api/testing/${currentTicket.ticketId}/test-cases/generate`, {
                method: 'POST',
                body: JSON.stringify({ selectedScenarios: [...selected, ...userScenarios] })
            });
            if (res.ok) {
                const data = await res.json();
                const cases = data.data?.testCases || data.testCases || [];
                setTestCases(cases);
                updateLocalSession(activeSessionId!, {
                    id: Date.now().toString(),
                    role: 'assistant',
                    content: `I've prepared the **Playwright Test Scripts**. You can review/edit the code or proceed to execution.`,
                    timestamp: new Date().toISOString(),
                    actionBlock: { type: 'test_cases_review', testCases: cases }
                });
            }
        } finally { setIsGeneratingTestCases(false); }
    };

    const handleRunTests = async () => {
        if (!currentTicket?.ticketId) {
            alert('No ticket context found. Please select or mention a ticket first.');
            return;
        }

        setIsExecutingTests(true);
        setExecutionResults([]);
        try {
            console.log(`[Testing] Triggering execution for ${currentTicket.ticketId}...`);
            const res = await authedFetch(`${API_URL}/api/testing/${currentTicket.ticketId}/execute`, {
                method: 'POST',
                body: JSON.stringify({ testCases, environment })
            });
            
            if (res.ok) {
                const data = await res.json();
                const results = data.data?.results || data.results || [];
                setExecutionResults(results);
                
                updateLocalSession(activeSessionId!, {
                    id: Date.now().toString(),
                    role: 'assistant',
                    content: `Execution complete. **${results.filter((r: any) => r.status === 'PASS').length} passed**, ${results.filter((r: any) => r.status === 'FAIL').length} failed.`,
                    timestamp: new Date().toISOString(),
                    actionBlock: { type: 'results' }
                });
            } else {
                const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
                console.error('[Testing] Execution failed:', errorData);
                alert(`Execution failed: ${errorData.error || res.statusText}`);
            }
        } catch (error: any) {
            console.error('[Testing] Run tests error:', error);
            alert(`Failed to trigger test execution: ${error.message}`);
        } finally { 
            setIsExecutingTests(false); 
        }
    };

    const handleUploadReport = async (transitionTo: string) => {
        setIsUploadingReport(true);
        try {
            const res = await authedFetch(`${API_URL}/api/testing/${currentTicket.ticketId}/results/upload`, {
                method: 'POST',
                body: JSON.stringify({ results: executionResults, transitionTo })
            });
            if (res.ok) {
                setIsReportUploaded(true);
                showToast('Report uploaded to Jira successfully!');
            }
        } finally { setIsUploadingReport(false); }
    };

    const handleApproveTestCases = async (approvedCases: any[]) => {
        showToast('Finalizing test scripts...');
        try {
            // First update the cases if they were edited in the modal
            const bulkRes = await authedFetch(`${API_URL}/api/testing/${currentTicket.ticketId}/test-cases/bulk`, {
                method: 'POST',
                body: JSON.stringify({ testCases: approvedCases })
            });

            if (!bulkRes.ok) {
                const error = await bulkRes.json();
                showToast(`Failed to save edits: ${error.error || 'Unknown error'}`, 'error');
                return;
            }

            // Then approve the session
            const res = await authedFetch(`${API_URL}/api/testing/${currentTicket.ticketId}/test-cases/approve`, {
                method: 'POST'
            });

            if (res.ok) {
                const data = await res.json();
                updateLocalSession(activeSessionId!, {
                    id: Date.now().toString(),
                    role: 'assistant',
                    content: data.message || `Test cases approved. **Ready to execute the automation.**`,
                    timestamp: new Date().toISOString(),
                    actionBlock: { type: 'execution' }
                });
            } else {
                const error = await res.json();
                showToast(`Approval failed: ${error.error || 'Unknown error'}`, 'error');
            }
        } catch (e: any) { 
            console.error('Approval error', e);
            showToast(`Approval failed: ${e.message}`, 'error'); 
        }
    };

    const handleSaveTestCases = async (updatedCases: any[]) => {
        setTestCases(updatedCases);
        try {
            const res = await authedFetch(`${API_URL}/api/testing/${currentTicket.ticketId}/test-cases/bulk`, {
                method: 'POST',
                body: JSON.stringify({ testCases: updatedCases })
            });
            if (res.ok) {
                showToast('Draft saved successfully');
            }
        } catch (e) {
            console.error('Failed to save test cases', e);
            showToast('Failed to save draft', 'error');
        }
    };

    const handleDeleteMessage = async (messageId: string) => {
        if (!activeSessionId) return;
        try {
            setSessions(prev => prev.map(s => s.id === activeSessionId 
                ? { ...s, messages: s.messages.filter(m => m.id !== messageId) } 
                : s
            ));
            // Optional: Sync deletion to backend
            await authedFetch(`${API_URL}/api/chat-sessions/${activeSessionId}/messages/${messageId}`, { method: 'DELETE' });
        } catch (err) {
            console.error('Delete failed', err);
        }
    };

    const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            const res = await authedFetch(`${API_URL}/api/chat-sessions/${sessionId}`, { method: 'DELETE' });
            if (res.ok) {
                setSessions(prev => {
                    const newSessions = prev.filter(s => s.id !== sessionId);
                    if (activeSessionId === sessionId) {
                        setActiveSessionId(newSessions.length > 0 ? newSessions[0].id : null);
                    }
                    return newSessions;
                });
                showToast('Chat history deleted');
            } else {
                showToast('Failed to delete session', 'error');
            }
        } catch (err: any) {
            showToast(`Error: ${err.message}`, 'error');
        }
    };

    const sendMessage = async (text?: string) => {
        const content = text || inputValue;
        if (!content.trim() || !activeSessionId || isLoading) return;

        setInputValue('');
        setIsLoading(true);
        const currentSession = sessions.find(s => s.id === activeSessionId);
        if (!currentSession) return;

        const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content, timestamp: new Date().toISOString() };
        const updatedMessages = [...currentSession.messages, userMsg];
        updateLocalSession(activeSessionId, userMsg);

        try {
            // Hyper-Aware Ticket Extraction
            const jiraRegex = /([A-Z0-9]+)-(\d+)/gi;
            const matches = content.match(jiraRegex);
            const isTestMode = chatMode === 'testing';

            // IF TEST MODE: Route to Specialized QA Workflow
            if (isTestMode && matches) {
                const ticketId = matches[0].toUpperCase();
                showToast(`Digital Detective: Target ${ticketId} found!`);
                
                const res = await authedFetch(`${API_URL}/api/testing/chat/mention`, { 
                    method: 'POST', 
                    body: JSON.stringify({ message: content, autoTrigger: false }) 
                });

                if (res.ok) {
                    const data = await res.json();
                    // Backend returns { success, tickets, ... } at top level (not nested under data)
                    const tickets = data.data?.tickets || data.tickets || [];
                    
                    if (tickets.length > 0) {
                        const ticket = tickets[0];
                        setCurrentTicket(ticket);
                        
                        // 1. INGESTION & DUPLICATE ANALYSIS (High-End Markdown)
                        const statusStr = ticket.hasSession ? 'In Testing' : (ticket.status || 'To Do');
                        const isDone = statusStr.toLowerCase().includes('done') || statusStr.toLowerCase().includes('closed');
                        
                        const dashboardContent = `
### 🕵️‍♂️ Digital Detective Mission: ${ticket.ticketId}
**Summary:** ${ticket.summary}
**System Status:** \`${statusStr}\`

#### 📋 Acceptance Criteria & Scope
${ticket.description ? ticket.description.substring(0, 700).trim() + (ticket.description.length > 700 ? '...' : '') : '_No description available for this ticket._'}

---
**Shall I launch the autonomous agent to begin the UI discovery and map out the test scripts for this mission?**
                        `.trim();

                        updateLocalSession(activeSessionId, {
                            id: (Date.now() + 1).toString(),
                            role: 'assistant',
                            content: dashboardContent,
                            timestamp: new Date().toISOString(),
                            actionBlock: isDone ? undefined : { type: 'start_testing', ticketId: ticket.ticketId }
                        });
                        setIsLoading(false);
                        return; // EXIT HERE: NEVER FALL BACK
                    } else {
                        // Ticket not found in DB
                        updateLocalSession(activeSessionId, {
                            id: (Date.now() + 1).toString(),
                            role: 'assistant',
                            content: `❌ **Detective Error:** I found the ID **${ticketId}** in your message, but it does not exist in the active testing database. Please ensure the ticket is synced from Jira.`,
                            timestamp: new Date().toISOString()
                        });
                        setIsLoading(false);
                        return;
                    }
                } else {
                    // Backend API Error
                    updateLocalSession(activeSessionId, {
                        id: (Date.now() + 1).toString(),
                        role: 'assistant',
                        content: `⚠️ **System Error:** The Intelligence Service is unreachable. Please check if the backend is running.`,
                        timestamp: new Date().toISOString()
                    });
                    setIsLoading(false);
                    return;
                }
            } else if (isTestMode && !matches) {
                // If in test mode but no ID, give specialized help
                const aiMsg: ChatMessage = { 
                    id: (Date.now() + 1).toString(), role: 'assistant', 
                    content: "🕵️‍♂️ **Digital Detective - Test Mode Active**\n\nPlease provide a Jira Ticket ID (e.g., **ATT-15** or **GT-102**) to start the forensic testing workflow.",
                    timestamp: new Date().toISOString() 
                };
                updateLocalSession(activeSessionId, aiMsg);
                return;
            }

            // DEFAULT: General Chat Workflow
            const res = await authedFetch(`${API_URL}/api/ai/chat`, { 
                method: 'POST', 
                body: JSON.stringify({ message: content, context: currentSession.messages, mode: chatMode }) 
            });
            if (res.ok) {
                const data = await res.json();
                const aiMsg: ChatMessage = { 
                    id: (Date.now() + 1).toString(), role: 'assistant', 
                    content: data.data?.response || data.response || "No response",
                    timestamp: new Date().toISOString(),
                    metadata: {
                        usage: data.data?.usage || data.usage,
                        model: data.data?.model || data.model,
                        profile: data.data?.profile || data.profile
                    }
                };

                updateLocalSession(activeSessionId, aiMsg);
                await authedFetch(`${API_URL}/api/chat-sessions`, { method: 'POST', body: JSON.stringify({ id: currentSession.id, title: currentSession.title, messages: [...updatedMessages, aiMsg], last_modified: Date.now(), jira_id: (currentSession as any).jiraId }) });
            }
        } catch (error) { showToast('Chat failed', 'error'); }
        finally { setIsLoading(false); }
    };

    const C = {
        bg: '#0b0f1a', sidebar: '#121826', border: 'rgba(255,255,255,0.06)',
        text: '#f8fafc', dim: '#94a3b8', accent: '#38bdf8', input: '#1e293b'
    };

    return (
        <div style={{ display: 'flex', height: '100vh', background: C.bg, color: C.text, fontFamily: "'Inter', sans-serif", overflow: 'hidden' }}>
            <aside style={{ width: sidebarOpen ? 272 : 0, minWidth: sidebarOpen ? 272 : 0, background: C.sidebar, borderRight: sidebarOpen ? `1px solid ${C.border}` : 'none', display: 'flex', flexDirection: 'column', transition: 'all 0.3s ease', overflow: 'hidden' }}>
                <div style={{ padding: '24px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000' }}><Rocket size={18} /></div>
                    <span style={{ fontWeight: 800, fontSize: 16 }}>GoHybrid AI</span>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 10px' }}>
                    <button onClick={createNewSession} style={{ width: '100%', padding: '12px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, color: C.text, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 20 }}><Plus size={16} /> New Chat</button>
                    {sessions.map(s => (
                        <div key={s.id} onClick={() => setActiveSessionId(s.id)} style={{ padding: '10px 12px', borderRadius: 10, background: activeSessionId === s.id ? 'rgba(56,189,248,0.1)' : 'transparent', color: activeSessionId === s.id ? C.accent : C.dim, cursor: 'pointer', fontSize: 13, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'background 0.2s' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                            <button onClick={(e) => handleDeleteSession(s.id, e)} style={{ background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', padding: '2px', opacity: activeSessionId === s.id ? 1 : 0.5, transition: 'color 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'} onMouseLeave={(e) => e.currentTarget.style.color = C.dim}>
                                <Trash2 size={13} />
                            </button>
                        </div>
                    ))}
                </div>
                <div style={{ padding: '8px 10px 12px', borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <button onClick={() => setSettingsOpen(true)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, border: 'none', background: 'transparent', color: C.dim, fontSize: 13, cursor: 'pointer' }}><Settings size={15} /> System Settings</button>
                    <button onClick={logout} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'rgba(239, 68, 68, 0.05)', border: 'none', color: '#fca5a5', fontSize: 13, cursor: 'pointer' }}><LogOut size={15} /> Sign Out</button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 12, color: backendOnline ? '#10b981' : '#ef4444' }}>{backendOnline ? <Wifi size={14} /> : <WifiOff size={14} />} <span>{backendOnline ? 'Backend connected' : 'Backend offline'}</span></div>
                </div>
            </aside>

            <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <div style={{ height: 52, padding: '0 16px', display: 'flex', alignItems: 'center', borderBottom: `1px solid ${C.border}` }}>
                    <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{ background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer' }}>{sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}</button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {!activeSession || activeSession.messages.length === 0 ? (
                        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
                            <Sparkles size={48} color={C.accent} style={{ marginBottom: 24 }} />
                            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 40 }}>What would you like to build or test today?</h1>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, maxWidth: 800, width: '100%' }}>
                                {SUGGESTIONS.map((s, i) => (
                                    <button 
                                        key={i} 
                                        onClick={() => {
                                            if (s.mode) setChatMode(s.mode as any);
                                            if (s.action === 'health') {
                                                sendMessage("Run a full system health check on all AI models and backend services.");
                                            } else if (s.action === 'new') {
                                                setCurrentTicket(null);
                                                setScenarios([]);
                                                setTestCases([]);
                                                showToast('Detective session reset');
                                            } else {
                                                sendMessage(s.label);
                                            }
                                        }} 
                                        style={{ padding: '20px', borderRadius: 16, border: `1px solid ${C.border}`, background: 'rgba(255,255,255,0.03)', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8, transition: 'all 0.2s' }}
                                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = C.accent; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = C.border; }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.accent }}>
                                            <s.icon size={18} />
                                            <div style={{ fontWeight: 700, fontSize: 14 }}>{s.label}</div>
                                        </div>
                                        <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.4 }}>{s.desc}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div style={{ maxWidth: 900, margin: '0 auto', width: '100%', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 24 }}>
                            {/* AI Logs Banner */}
                            {aiLogs.length > 0 && (
                                <div style={{ 
                                    padding: '10px 16px', borderRadius: 12, background: 'rgba(56, 189, 248, 0.05)', 
                                    border: '1px solid rgba(56, 189, 248, 0.1)', fontSize: 11, color: C.accent,
                                    display: 'flex', alignItems: 'center', gap: 12, overflow: 'hidden'
                                }}>
                                    <Activity size={14} className="animate-pulse" />
                                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                                        <span style={{ fontWeight: 800, marginRight: 8 }}>AI AGENT:</span> 
                                        {aiLogs[aiLogs.length - 1].message}
                                    </div>
                                    <div style={{ opacity: 0.5, fontSize: 9 }}>{new Date(aiLogs[aiLogs.length - 1].timestamp).toLocaleTimeString()}</div>
                                </div>
                            )}

                            <ChatMessageList 
                                messages={activeSession.messages} isLoading={isLoading} scenarios={scenarios} setScenarios={setScenarios} 
                                userScenarios={userScenarios} userScenarioInput={userScenarioInput} setUserScenarioInput={setUserScenarioInput} 
                                handleAddUserScenario={async () => { 
                                    if (!userScenarioInput.trim() || !currentTicket) return;
                                    const newScenario = { id: Date.now().toString(), description: userScenarioInput };
                                    setUserScenarios([...userScenarios, newScenario]); 
                                    setUserScenarioInput('');
                                    // Sync to backend immediately
                                    await authedFetch(`${API_URL}/api/testing/${currentTicket.ticketId}/user-scenarios`, {
                                        method: 'POST',
                                        body: JSON.stringify({ description: newScenario.description, selected: true })
                                    }).catch(e => console.error('Sync failed', e));
                                }}
                                handleConfirmScenarios={handleConfirmScenarios} isGeneratingTestCases={isGeneratingTestCases}
                                setIsTestCaseModalOpen={setIsTestCaseModalOpen} handleRunTests={handleRunTests} isExecutingTests={isExecutingTests}
                                handleStopExecution={() => setIsExecutingTests(false)} combinedExecutionLog={executionLog} wsStatus={wsStatus}
                                executionResults={executionResults} handlePostFailureToJira={() => setIsPostingToJira(true)} isPostingToJira={isPostingToJira}
                                handleUploadReport={handleUploadReport} isUploadingReport={isUploadingReport} isReportUploaded={isReportUploaded}
                                handleStartTesting={handleStartTesting} testCases={testCases} handleApproveTestCases={handleApproveTestCases} handleRetryTests={handleRunTests}
                                currentTicket={currentTicket} environment={environment} messagesEndRef={messagesEndRef}
                                handleSaveTestCases={handleSaveTestCases}
                            />
                        </div>
                    )}
                </div>

                <div style={{ padding: '12px 20px 24px', maxWidth: 1100, margin: '0 auto', width: '100%', position: 'relative' }}>
                    {advancedSettingsOpen && (
                        <div style={{ position: 'absolute', bottom: 'calc(100% + 12px)', right: '16px', width: '320px', background: 'rgba(30, 41, 59, 0.9)', border: `1px solid ${C.border}`, borderRadius: 20, padding: '24px', boxShadow: '0 20px 50px rgba(0,0,0,0.6)', zIndex: 1000, backdropFilter: 'blur(15px)', display: 'flex', flexDirection: 'column', gap: 20 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div style={{ fontSize: 13, fontWeight: 800, color: C.accent }}>AI CONFIGURATION</div><X size={16} onClick={() => setAdvancedSettingsOpen(false)} style={{ cursor: 'pointer' }} /></div>
                            <div><label style={{ fontSize: 11, color: C.dim }}>MAX SCENARIOS: {maxTestScenarios}</label><input type="range" min="1" max="10" value={maxTestScenarios} onChange={e => setMaxTestScenarios(parseInt(e.target.value))} style={{ width: '100%', accentColor: C.accent }} /></div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: 12 }}>Memory Enhancement</span><div onClick={() => setMemoryEnhancement(!memoryEnhancement)} style={{ width: 36, height: 20, borderRadius: 18, background: memoryEnhancement ? C.accent : 'rgba(255,255,255,0.1)', position: 'relative', cursor: 'pointer' }}><div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: memoryEnhancement ? 19 : 3 }} /></div></div>
                        </div>
                    )}
                    <div style={{ background: C.input, borderRadius: 24, border: `1px solid ${C.border}`, padding: '6px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)', position: 'relative' }}>
                        {/* Mode Indicator Badge */}
                        <div style={{
                            position: 'absolute', top: -32, left: 12, padding: '4px 12px', borderRadius: '8px 8px 0 0',
                            background: chatMode === 'testing' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(148, 163, 184, 0.1)',
                            border: `1px solid ${chatMode === 'testing' ? 'rgba(56, 189, 248, 0.3)' : 'rgba(255,255,255,0.05)'}`,
                            fontSize: '10px', fontWeight: 800, color: chatMode === 'testing' ? C.accent : C.dim,
                            display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase', letterSpacing: '0.05em'
                        }}>
                            <div style={{ width: 6, height: 6, borderRadius: '50%', background: chatMode === 'testing' ? C.accent : C.dim, animation: chatMode === 'testing' ? 'pulse 2s infinite' : 'none' }} />
                            {chatMode === 'testing' ? 'Autonomous QA Mode Active' : 'General Assistant Mode'}
                        </div>

                        <textarea ref={textareaRef} value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder={chatMode === 'testing' ? "Paste a Jira ticket ID (e.g. ATT-15)..." : "Ask GoHybrid AI anything..."} style={{ width: '100%', background: 'transparent', border: 'none', color: C.text, outline: 'none', resize: 'none', minHeight: 64, padding: '14px 18px', fontSize: 14 }} />
                        
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px 8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(0,0,0,0.2)', borderRadius: 14, padding: 4, border: `1px solid ${C.border}` }}>
                                <button 
                                    onClick={() => { setChatMode('general'); showToast('Chat Mode Active'); }} 
                                    style={{ 
                                        padding: '6px 16px', borderRadius: 10, border: 'none', fontSize: 11, fontWeight: 800, cursor: 'pointer', transition: '0.2s',
                                        background: chatMode === 'general' ? '#fff' : 'transparent', 
                                        color: chatMode === 'general' ? '#000' : C.dim 
                                    }}
                                >
                                    CHAT MODE
                                </button>
                                <button 
                                    onClick={() => { setChatMode('testing'); showToast('Test Mode Active'); }} 
                                    style={{ 
                                        padding: '6px 16px', borderRadius: 10, border: 'none', fontSize: 11, fontWeight: 800, cursor: 'pointer', transition: '0.2s',
                                        background: chatMode === 'testing' ? C.accent : 'transparent', 
                                        color: chatMode === 'testing' ? '#000' : C.dim 
                                    }}
                                >
                                    TEST MODE
                                </button>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <button onClick={() => setAdvancedSettingsOpen(!advancedSettingsOpen)} style={{ background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer' }}><SlidersHorizontal size={18} /></button>
                                <button onClick={() => sendMessage()} disabled={isLoading || !inputValue.trim()} style={{ padding: '8px 20px', borderRadius: 12, background: inputValue.trim() ? C.accent : 'rgba(255,255,255,0.05)', color: inputValue.trim() ? '#000' : C.dim, border: 'none', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>Send <Rocket size={16} /></button>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
            <SettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
            {isTestCaseModalOpen && <TestCaseEditorModal 
                isOpen={isTestCaseModalOpen} 
                onClose={() => setIsTestCaseModalOpen(false)} 
                testCases={testCases} 
                ticketId={currentTicket?.ticketId || ''}
                onApprove={handleApproveTestCases}
                onSave={async (updated) => { setTestCases(updated); setIsTestCaseModalOpen(false); }} 
            />}
        </div>
    );
}
