/**
 * TestCaseEditorModal Component
 * 
 * Modal for editing, adding, deleting, and approving test cases.
 * Based on Canva design flow with modern React/Tailwind styling.
 */

import React, { useState } from 'react';
import { X, Plus, Trash2, CheckCircle, AlertCircle } from 'lucide-react';
import { TestCase } from '../services/TestCaseGeneratorService';

interface TestCaseEditorModalProps {
    isOpen?: boolean;
    ticketId: string;
    testCases: TestCase[];
    onSave: (testCases: TestCase[]) => Promise<void>;
    onApprove: (testCases: TestCase[]) => Promise<void>;
    onClose?: () => void;
    onAbort?: () => void;
    inline?: boolean;
    loading?: boolean;
    loadError?: string | null;
    onRetryLoad?: () => void;
    approved?: boolean; // New prop to track if already approved
}

interface EditableTestCase extends TestCase {
    isEditing?: boolean;
}

export function TestCaseEditorModal({
    isOpen,
    ticketId,
    testCases,
    onSave,
    onApprove,
    onClose,
    onAbort,
    inline = false,
    loading = false,
    loadError = null,
    onRetryLoad,
    approved = false // Default to not approved
}: TestCaseEditorModalProps) {
    const [localTestCases, setLocalTestCases] = useState<EditableTestCase[]>(testCases);
    const [isSaving, setIsSaving] = useState(false);

    // Sync with parent when modal opens or testCases change
    React.useEffect(() => {
        if (isOpen || inline) {
            setLocalTestCases(testCases);
        }
    }, [isOpen, inline, testCases]);

    const handleAddTestCase = () => {
        const newCase: EditableTestCase = {
            caseId: `TC-${Date.now()}`,
            title: 'New Test Case',
            description: '',
            priority: 'Medium',
            steps: [{ stepNumber: 1, action: '', expectedResult: '' }],
            expectedOutcome: '',
            isEditable: true,
            isMain: false
        };
        setLocalTestCases([...localTestCases, newCase]);
    };

    const handleDeleteTestCase = (caseId: string) => {
        setLocalTestCases(localTestCases.filter(tc => tc.caseId !== caseId));
    };

    const handleUpdateTestCase = (caseId: string, field: keyof TestCase, value: any) => {
        setLocalTestCases(localTestCases.map(tc => 
            tc.caseId === caseId ? { ...tc, [field]: value } : tc
        ));
    };

    const handleAddStep = (caseId: string) => {
        setLocalTestCases(localTestCases.map(tc => {
            if (tc.caseId === caseId) {
                const newStepNumber = (tc.steps?.length || 0) + 1;
                return {
                    ...tc,
                    steps: [...(tc.steps || []), { stepNumber: newStepNumber, action: '', expectedResult: '' }]
                };
            }
            return tc;
        }));
    };

    const handleUpdateStep = (caseId: string, stepIndex: number, field: 'action' | 'expectedResult', value: string) => {
        setLocalTestCases(localTestCases.map(tc => {
            if (tc.caseId === caseId && tc.steps?.[stepIndex]) {
                const updatedSteps = [...tc.steps];
                updatedSteps[stepIndex] = { ...updatedSteps[stepIndex], [field]: value };
                return { ...tc, steps: updatedSteps };
            }
            return tc;
        }));
    };

    const handleRemoveStep = (caseId: string, stepIndex: number) => {
        setLocalTestCases(localTestCases.map(tc => {
            if (tc.caseId === caseId && tc.steps?.length > 1) {
                const updatedSteps = tc.steps.filter((_, idx) => idx !== stepIndex);
                // Renumber steps
                return { ...tc, steps: updatedSteps.map((s, i) => ({ ...s, stepNumber: i + 1 })) };
            }
            return tc;
        }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await onSave(localTestCases);
        } catch (error) {
            console.error('Failed to save test cases:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleApprove = async () => {
        if (localTestCases.length === 0) {
            alert('Please add at least one test case before approving.');
            return;
        }
        setIsSaving(true);
        try {
            await onApprove(localTestCases);
            if (onClose) onClose();
        } catch (error) {
            console.error('Failed to approve test cases:', error);
        } finally {
            setIsSaving(false);
        }
    };

    if (!inline && !isOpen) return null;

    const C = {
        bg: '#1a1a2e',
        surface: '#202038',
        input: '#252540',
        border: 'rgba(255,255,255,0.06)',
        borderHover: 'rgba(255,255,255,0.12)',
        text: '#e3e3f0',
        dim: '#7a7a96',
        accent: '#8ab4f8',
        accentSurface: 'rgba(138,180,248,0.1)',
        green: '#10b981',
        red: '#ef4444',
    };

    const content = (
        <div style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            fontFamily: "'Inter', sans-serif",
            ...(inline ? { marginTop: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.2)' } : { maxWidth: 900, maxHeight: '90vh', overflow: 'hidden' })
        }}>
            {/* Header */}
            <div style={{ padding: '16px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                <div>
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: C.text, margin: '0 0 4px 0' }}>Test Cases - {ticketId}</h3>
                    <p style={{ fontSize: 13, color: C.dim, margin: 0 }}>Edit, add, or delete test cases before approval</p>
                </div>
                {!inline && onClose && (
                    <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', padding: 4, borderRadius: 8 }}>
                        <X size={20} />
                    </button>
                )}
            </div>

            {/* Content - Test Cases List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', background: 'rgba(0,0,0,0.1)' }}>
                {loadError && (
                    <div style={{
                        marginBottom: 16,
                        padding: '12px 14px',
                        borderRadius: 12,
                        border: '1px solid rgba(239,68,68,0.3)',
                        background: 'rgba(239,68,68,0.08)',
                        color: '#fecaca',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        fontSize: 13
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <AlertCircle size={18} style={{ color: C.red }} />
                            <div>
                                <div style={{ fontWeight: 600, color: '#fee2e2' }}>Failed to load test cases</div>
                                <div style={{ opacity: 0.9, marginTop: 2 }}>{loadError}</div>
                            </div>
                        </div>
                        {onRetryLoad && (
                            <button
                                onClick={onRetryLoad}
                                style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.12)', color: '#fee2e2', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}
                            >
                                Retry
                            </button>
                        )}
                    </div>
                )}

                {loading && localTestCases.length === 0 ? (
                    <div style={{ padding: '16px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.dim, marginBottom: 14 }}>
                            <div className="animate-spin" style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.borderHover}`, borderTopColor: 'transparent' }} />
                            <span style={{ fontSize: 13 }}>Generating test cases…</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} className="animate-pulse">
                            {[0, 1, 2].map((k) => (
                                <div key={k} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                                        <div style={{ height: 12, width: 120, background: C.input, borderRadius: 6 }} />
                                        <div style={{ height: 12, width: 80, background: C.input, borderRadius: 6 }} />
                                    </div>
                                    <div style={{ height: 14, width: '85%', background: C.input, borderRadius: 6, marginBottom: 10 }} />
                                    <div style={{ height: 14, width: '65%', background: C.input, borderRadius: 6 }} />
                                </div>
                            ))}
                        </div>
                    </div>
                ) : localTestCases.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '48px 0', color: C.dim }}>
                        <AlertCircle size={40} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                        <p style={{ margin: 0, fontSize: 14 }}>No test cases yet. Add your first test case below.</p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {localTestCases.map((tc, index) => (
                            <div key={tc.caseId} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
                                {/* Test Case Header */}
                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                            <span style={{ fontSize: 12, fontFamily: 'monospace', color: C.dim }}>{tc.caseId}</span>
                                            {tc.isMain && (
                                                <span style={{ fontSize: 10, padding: '2px 6px', background: 'rgba(168,85,247,0.15)', color: '#c084fc', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                    Main Bug
                                                </span>
                                            )}
                                        </div>
                                        <input
                                            type="text"
                                            value={tc.title}
                                            onChange={(e) => handleUpdateTestCase(tc.caseId, 'title', e.target.value)}
                                            style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: `1px solid transparent`, color: C.text, fontSize: 15, fontWeight: 500, outline: 'none', paddingBottom: 4 }}
                                            placeholder="Test case title"
                                            onFocus={e => e.target.style.borderBottom = `1px solid ${C.accent}`}
                                            onBlur={e => e.target.style.borderBottom = `1px solid transparent`}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 16 }}>
                                        <select
                                            value={tc.priority}
                                            onChange={(e) => handleUpdateTestCase(tc.caseId, 'priority', e.target.value as any)}
                                            style={{ padding: '6px 10px', background: C.input, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 12, outline: 'none', cursor: 'pointer' }}
                                        >
                                            <option value="High">High</option>
                                            <option value="Medium">Medium</option>
                                            <option value="Low">Low</option>
                                        </select>
                                        <button
                                            onClick={() => handleDeleteTestCase(tc.caseId)}
                                            style={{ padding: 6, background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', borderRadius: 8 }}
                                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.color = C.red; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.dim; }}
                                            title="Delete test case"
                                        >
                                            <Trash2 size={15} />
                                        </button>
                                    </div>
                                </div>

                                {/* Description */}
                                <textarea
                                    value={tc.description || ''}
                                    onChange={(e) => handleUpdateTestCase(tc.caseId, 'description', e.target.value)}
                                    placeholder="Description (optional)"
                                    rows={2}
                                    style={{ width: '100%', background: C.input, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', color: C.text, fontSize: 13, resize: 'none', outline: 'none', marginBottom: 12, boxSizing: 'border-box' }}
                                    onFocus={e => e.target.style.border = `1px solid ${C.accent}`}
                                    onBlur={e => e.target.style.border = `1px solid ${C.border}`}
                                />

                                {/* Test Steps */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <span style={{ fontSize: 11, fontWeight: 600, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Test Steps</span>
                                        <button
                                            onClick={() => handleAddStep(tc.caseId)}
                                            style={{ background: 'transparent', border: 'none', color: C.accent, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                                        >
                                            <Plus size={12} /> Add Step
                                        </button>
                                    </div>
                                    {tc.steps?.map((step, stepIndex) => (
                                        <div key={stepIndex} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                            <span style={{ width: 24, height: 24, borderRadius: 6, background: C.input, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: C.dim, flexShrink: 0, marginTop: 2 }}>
                                                {step.stepNumber}
                                            </span>
                                            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                                <input
                                                    type="text"
                                                    value={step.action}
                                                    onChange={(e) => handleUpdateStep(tc.caseId, stepIndex, 'action', e.target.value)}
                                                    placeholder="Action (what to do)"
                                                    style={{ background: C.input, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 10px', color: C.text, fontSize: 12, outline: 'none', width: '100%', boxSizing: 'border-box' }}
                                                    onFocus={e => e.target.style.border = `1px solid ${C.accent}`}
                                                    onBlur={e => e.target.style.border = `1px solid ${C.border}`}
                                                />
                                                <input
                                                    type="text"
                                                    value={step.expectedResult}
                                                    onChange={(e) => handleUpdateStep(tc.caseId, stepIndex, 'expectedResult', e.target.value)}
                                                    placeholder="Expected Result"
                                                    style={{ background: C.input, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 10px', color: C.text, fontSize: 12, outline: 'none', width: '100%', boxSizing: 'border-box' }}
                                                    onFocus={e => e.target.style.border = `1px solid ${C.accent}`}
                                                    onBlur={e => e.target.style.border = `1px solid ${C.border}`}
                                                />
                                            </div>
                                            <button
                                                onClick={() => handleRemoveStep(tc.caseId, stepIndex)}
                                                style={{ padding: 4, background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', borderRadius: 4, marginTop: 4 }}
                                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.color = C.red; }}
                                                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.dim; }}
                                                title="Remove step"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>

                                {/* Expected Outcome */}
                                <div style={{ marginTop: 12 }}>
                                    <input
                                        type="text"
                                        value={tc.expectedOutcome}
                                        onChange={(e) => handleUpdateTestCase(tc.caseId, 'expectedOutcome', e.target.value)}
                                        placeholder="Expected outcome after all steps"
                                        style={{ width: '100%', background: C.input, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', color: C.text, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                                        onFocus={e => e.target.style.border = `1px solid ${C.accent}`}
                                        onBlur={e => e.target.style.border = `1px solid ${C.border}`}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Add Test Case Button */}
                <button
                    onClick={handleAddTestCase}
                    disabled={loading || isSaving}
                    style={{ marginTop: 16, width: '100%', padding: '12px', border: `2px dashed ${C.borderHover}`, borderRadius: 12, background: 'transparent', color: C.dim, fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all 0.2s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.borderHover; e.currentTarget.style.color = C.dim; }}
                >
                    <Plus size={16} /> Add New Test Case
                </button>
            </div>

            {/* Footer Actions */}
            <div style={{ padding: '16px 24px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: C.surface }}>
                <div style={{ display: 'flex', gap: 12 }}>
                    <button
                        onClick={onClose}
                        style={{ padding: '8px 16px', background: C.input, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.background = C.bg}
                        onMouseLeave={e => e.currentTarget.style.background = C.input}
                    >
                        Hide
                    </button>
                    {onAbort && (
                        <button
                            onClick={onAbort}
                            style={{ padding: '8px 16px', background: 'rgba(239,68,68,0.1)', border: `1px solid rgba(239,68,68,0.3)`, borderRadius: 8, color: C.red, fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.2s' }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.2)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; }}
                            title="Abort session and move ticket back to To Do"
                        >
                            <Trash2 size={15} /> Abort Session
                        </button>
                    )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {approved ? (
                        <div style={{ padding: '8px 20px', background: 'rgba(16,185,129,0.15)', border: `1px solid rgba(16,185,129,0.3)`, borderRadius: 8, color: C.green, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <CheckCircle size={16} /> Approved
                        </div>
                    ) : (
                        <>
                            <button
                                onClick={handleSave}
                                disabled={isSaving || loading}
                                style={{ padding: '8px 16px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13, fontWeight: 500, cursor: isSaving ? 'default' : 'pointer', opacity: isSaving ? 0.5 : 1 }}
                            >
                                {isSaving ? 'Saving…' : 'Save Draft'}
                            </button>
                            <button
                                onClick={handleApprove}
                                disabled={isSaving || loading || localTestCases.length === 0 || approved}
                                style={{ padding: '8px 20px', background: approved ? 'rgba(16,185,129,0.3)' : C.green, border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: (isSaving || loading || localTestCases.length === 0 || approved) ? 'default' : 'pointer', opacity: (isSaving || loading || localTestCases.length === 0 || approved) ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 8 }}
                            >
                                <CheckCircle size={16} /> {approved ? 'Approved' : 'Approve & Continue'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );

    if (inline) {
        return content;
    }

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            {content}
        </div>
    );
}
