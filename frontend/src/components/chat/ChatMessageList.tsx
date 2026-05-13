import React from 'react';
import { Sparkles, Trash2 } from 'lucide-react';
import { ChatMessage } from './types';
import { ActionBlock } from './ActionBlock';
import { md, formatTime } from './utils';

interface ChatMessageListProps {
    messages: ChatMessage[];
    onDeleteMessage?: (id: string) => void;
    isLoading: boolean;
    scenarios: any[];
    setScenarios: React.Dispatch<React.SetStateAction<any[]>>;
    userScenarios: any[];
    userScenarioInput: string;
    setUserScenarioInput: (val: string) => void;
    handleAddUserScenario: () => void;
    handleConfirmScenarios: (selected: any[]) => void;
    isGeneratingTestCases: boolean;
    setIsTestCaseModalOpen: (val: boolean) => void;
    handleRunTests: () => void;
    isExecutingTests: boolean;
    handleStopExecution: () => void;
    combinedExecutionLog: string[];
    wsStatus: string;
    executionResults: any[];
    handlePostFailureToJira: () => void;
    isPostingToJira: boolean;
    handleUploadReport: (transitionTo: string) => void;
    isUploadingReport: boolean;
    isReportUploaded: boolean;
    handleStartTesting: (ticketId: string) => void;
    testCases: any[];
    handleApproveTestCases: (cases: any[]) => void;
    handleRetryTests: () => void;
    currentTicket: any;
    environment: any;
    messagesEndRef: React.RefObject<HTMLDivElement>;
    handleSaveTestCases: (cases: any[]) => Promise<void>;
}

export const ChatMessageList: React.FC<ChatMessageListProps> = ({
    messages,
    onDeleteMessage,
    isLoading,
    scenarios,
    setScenarios,
    userScenarios,
    userScenarioInput,
    setUserScenarioInput,
    handleAddUserScenario,
    handleConfirmScenarios,
    isGeneratingTestCases,
    setIsTestCaseModalOpen,
    handleRunTests,
    isExecutingTests,
    handleStopExecution,
    combinedExecutionLog,
    wsStatus,
    executionResults,
    handlePostFailureToJira,
    isPostingToJira,
    handleUploadReport,
    isUploadingReport,
    isReportUploaded,
    handleStartTesting,
    testCases,
    handleApproveTestCases,
    handleRetryTests,
    currentTicket,
    environment,
    messagesEndRef,
    handleSaveTestCases,
}) => {
    const C = {
        userMsg: '#1e3a5f',
        text: '#e3e3f0',
        dim: '#7a7a96',
        border: 'rgba(255,255,255,0.06)',
    };

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px' }}>
            {messages.map(msg => (
                <div key={msg.id} className="gm-msg-enter" style={{ position: 'relative', group: 'true' } as any}>
                    {/* Delete Action Overlay */}
                    {onDeleteMessage && (
                        <button 
                            onClick={() => onDeleteMessage(msg.id)}
                            className="gm-delete-btn"
                            style={{
                                position: 'absolute', top: 0, right: msg.role === 'user' ? 'auto' : -40, left: msg.role === 'user' ? -40 : 'auto',
                                background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', opacity: 0.6,
                                padding: 8, transition: '0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}
                        >
                            <Trash2 size={14} />
                        </button>
                    )}

                    {msg.role === 'user' ? (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                            <div style={{ maxWidth: '82%' }}>
                                <div style={{
                                    padding: '12px 18px', borderRadius: '20px 20px 6px 20px',
                                    background: C.userMsg, color: C.text, fontSize: 14, lineHeight: 1.65,
                                }}>
                                    <span dangerouslySetInnerHTML={{ __html: md(msg.content) }} />
                                </div>
                                <div style={{ textAlign: 'right', marginTop: 4, marginRight: 8, fontSize: 10, color: '#555568' }}>
                                    {formatTime(msg.timestamp)}
                                </div>
                            </div>
                        </div>
                    ) : msg.role === 'system' ? (
                        <div style={{ display: 'flex', justifyContent: 'center', margin: '12px 0' }}>
                            <div style={{
                                padding: '8px 16px', borderRadius: 12, fontSize: 12,
                                background: 'rgba(255,255,255,0.025)', color: C.dim,
                                border: `1px solid ${C.border}`, maxWidth: 480, textAlign: 'center',
                            }}>
                                <span dangerouslySetInnerHTML={{ __html: md(msg.content) }} />
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', gap: 16, marginBottom: 24, animation: 'fade-in 0.4s ease-out' }}>
                            <div style={{
                                width: 36, height: 36, borderRadius: 12, flexShrink: 0, marginTop: 2,
                                background: 'linear-gradient(135deg, #8ab4f8, #669df6)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                boxShadow: '0 4px 12px rgba(138,180,248,0.2)',
                            }}>
                                <Sparkles size={16} color="#000" />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#8ab4f8', marginBottom: 6, opacity: 0.8 }}>
                                    GoHybrid AI
                                </div>
                                <div style={{ fontSize: 14, lineHeight: 1.75, color: '#cccce0' }}>
                                    <span dangerouslySetInnerHTML={{ __html: md(msg.content) }} />
                                </div>

                                {msg.metadata && (
                                    <div style={{ 
                                        marginTop: 8, fontSize: 10, color: '#64748b', display: 'flex', gap: 12, 
                                        padding: '4px 8px', background: 'rgba(255,255,255,0.02)', borderRadius: 6, width: 'fit-content'
                                    }}>
                                        {msg.metadata.model && <span>🤖 {msg.metadata.model}</span>}
                                        {msg.metadata.usage && (
                                            <span>📊 {msg.metadata.usage.total_tokens} tokens</span>
                                        )}
                                    </div>
                                )}

                                <ActionBlock
                                    msg={msg}
                                    isLoading={isLoading}
                                    scenarios={scenarios}
                                    setScenarios={setScenarios}
                                    userScenarios={userScenarios}
                                    userScenarioInput={userScenarioInput}
                                    setUserScenarioInput={setUserScenarioInput}
                                    handleAddUserScenario={handleAddUserScenario}
                                    handleConfirmScenarios={handleConfirmScenarios}
                                    isGeneratingTestCases={isGeneratingTestCases}
                                    setIsTestCaseModalOpen={setIsTestCaseModalOpen}
                                    handleRunTests={handleRunTests}
                                    isExecutingTests={isExecutingTests}
                                    handleStopExecution={handleStopExecution}
                                    combinedExecutionLog={combinedExecutionLog}
                                    wsStatus={wsStatus}
                                    executionResults={executionResults}
                                    handlePostFailureToJira={handlePostFailureToJira}
                                    isPostingToJira={isPostingToJira}
                                    handleUploadReport={handleUploadReport}
                                    isUploadingReport={isUploadingReport}
                                    isReportUploaded={isReportUploaded}
                                    handleStartTesting={handleStartTesting}
                                    testCases={testCases}
                                    handleApproveTestCases={handleApproveTestCases}
                                    handleRetryTests={handleRetryTests}
                                    currentTicket={currentTicket}
                                    environment={environment}
                                    handleSaveTestCases={handleSaveTestCases}
                                />
                            </div>
                        </div>
                    )}
                </div>
            ))}

            {/* Thinking / Loading Bubble */}
            {isLoading && (
                <div style={{ display: 'flex', gap: 16, marginBottom: 24, animation: 'fade-in 0.3s ease-out' }}>
                    <div style={{
                        width: 36, height: 36, borderRadius: 12, flexShrink: 0, marginTop: 2,
                        background: 'rgba(56, 189, 248, 0.1)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: '1px solid rgba(56, 189, 248, 0.2)'
                    }}>
                        <Sparkles size={16} color="#38bdf8" className="animate-pulse" />
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#38bdf8', marginBottom: 6, opacity: 0.8 }}>
                            GoHybrid AI
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', height: 24 }}>
                            <div className="gm-dot-thinking" style={{ width: 6, height: 6, borderRadius: '50%', background: '#38bdf8', animation: 'bounce 1.4s infinite ease-in-out' }} />
                            <div className="gm-dot-thinking" style={{ width: 6, height: 6, borderRadius: '50%', background: '#38bdf8', animation: 'bounce 1.4s infinite ease-in-out 0.2s' }} />
                            <div className="gm-dot-thinking" style={{ width: 6, height: 6, borderRadius: '50%', background: '#38bdf8', animation: 'bounce 1.4s infinite ease-in-out 0.4s' }} />
                            <span style={{ fontSize: 13, color: '#94a3b8', marginLeft: 8, fontStyle: 'italic' }}>Thinking...</span>
                        </div>
                    </div>
                </div>
            )}

            <div ref={messagesEndRef} />
        </div>
    );
};
