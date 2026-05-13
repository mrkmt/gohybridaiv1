/**
 * ForensicAuditView Component
 * 
 * Compares baseline screenshots with current run screenshots
 * for visual regression detection and forensic analysis.
 */

import React, { useState } from 'react';
import { 
    ZoomIn, 
    ZoomOut, 
    Maximize2, 
    AlertTriangle, 
    CheckCircle2, 
    XCircle,
    Eye,
    EyeOff,
    Download,
    Share2
} from 'lucide-react';

interface ScreenshotComparison {
    testCaseId: string;
    stepNumber: number;
    baselinePath?: string;
    currentPath: string;
    diffPath?: string;
    isVisualRegression: boolean;
    similarityScore?: number;
}

interface ForensicAuditViewProps {
    comparisons: ScreenshotComparison[];
    ticketId: string;
    onClose: () => void;
}

export function ForensicAuditView({ comparisons, ticketId, onClose }: ForensicAuditViewProps) {
    const [selectedComparison, setSelectedComparison] = useState<ScreenshotComparison | null>(null);
    const [zoomLevel, setZoomLevel] = useState(100);
    const [showDiff, setShowDiff] = useState(true);
    const [showBaseline, setShowBaseline] = useState(true);
    const [showCurrent, setShowCurrent] = useState(true);

    const regressions = comparisons.filter(c => c.isVisualRegression);
    const passed = comparisons.filter(c => !c.isVisualRegression);

    const handleZoomIn = () => setZoomLevel(prev => Math.min(prev + 25, 200));
    const handleZoomOut = () => setZoomLevel(prev => Math.max(prev - 25, 50));
    const handleResetZoom = () => setZoomLevel(100);

    const handleExport = () => {
        // TODO: Implement export to PDF
        console.log('Export forensic report');
    };

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
        amber: '#f59e0b'
    };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, width: '100%', maxWidth: 1280, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', fontFamily: "'Inter', sans-serif" }}>
                {/* Header */}
                <div style={{ padding: '24px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                    <div>
                        <h3 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Eye size={20} color={C.accent} /> Forensic Audit View
                        </h3>
                        <p style={{ fontSize: 13, color: C.dim, margin: 0 }}>{ticketId} - Visual Regression Analysis</p>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <button onClick={handleExport} style={{ padding: 8, background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', borderRadius: 8 }} title="Export Report">
                            <Download size={20} />
                        </button>
                        <button onClick={onClose} style={{ padding: 8, background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', borderRadius: 8 }}>
                            <XCircle size={20} />
                        </button>
                    </div>
                </div>

                {/* Summary Stats */}
                <div style={{ padding: 16, borderBottom: `1px solid ${C.border}`, background: 'rgba(0,0,0,0.1)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
                        <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
                            <div style={{ fontSize: 24, fontWeight: 700, color: C.text }}>{comparisons.length}</div>
                            <div style={{ fontSize: 12, color: C.dim }}>Total Screenshots</div>
                        </div>
                        <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 12, padding: 16 }}>
                            <div style={{ fontSize: 24, fontWeight: 700, color: C.green }}>{passed.length}</div>
                            <div style={{ fontSize: 12, color: C.green }}>No Changes</div>
                        </div>
                        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: 16 }}>
                            <div style={{ fontSize: 24, fontWeight: 700, color: C.red }}>{regressions.length}</div>
                            <div style={{ fontSize: 12, color: C.red }}>Visual Regressions</div>
                        </div>
                        <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 12, padding: 16 }}>
                            <div style={{ fontSize: 24, fontWeight: 700, color: C.amber }}>
                                {comparisons.length > 0 ? Math.round(((comparisons.length - regressions.length) / comparisons.length) * 100) : 100}%
                            </div>
                            <div style={{ fontSize: 12, color: C.amber }}>Visual Stability</div>
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                    {/* Sidebar - Screenshot List */}
                    <div style={{ width: 280, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', background: C.bg }}>
                        <div style={{ padding: '16px 16px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <h4 style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: '0 0 8px 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Screenshots</h4>
                            {comparisons.map((comp, idx) => {
                                const isSelected = selectedComparison === comp;
                                return (
                                    <button
                                        key={idx}
                                        onClick={() => setSelectedComparison(comp)}
                                        style={{
                                            width: '100%', padding: 12, borderRadius: 8, textAlign: 'left', cursor: 'pointer', transition: 'all 0.2s', outline: 'none',
                                            background: isSelected ? C.accentSurface : 'transparent', border: `1px solid ${isSelected ? C.accent : C.borderHover}`,
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ fontSize: 13, fontWeight: 500, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {comp.testCaseId} - Step {comp.stepNumber}
                                                </div>
                                                <div style={{ fontSize: 11, color: comp.isVisualRegression ? C.red : C.dim, marginTop: 4 }}>
                                                    {comp.isVisualRegression ? '⚠️ Regression' : '✅ No changes'}
                                                </div>
                                            </div>
                                            {comp.isVisualRegression ? <AlertTriangle size={16} color={C.red} style={{ flexShrink: 0 }} /> : <CheckCircle2 size={16} color={C.green} style={{ flexShrink: 0 }} />}
                                        </div>
                                        {comp.similarityScore !== undefined && (
                                            <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>Similarity: {Math.round(comp.similarityScore * 100)}%</div>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Main View - Comparison */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: 24, background: 'rgba(0,0,0,0.1)' }}>
                        {selectedComparison ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                {/* Controls */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px' }}>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button onClick={() => setShowBaseline(!showBaseline)} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: 'none', display: 'flex', alignItems: 'center', gap: 6, background: showBaseline ? C.accent : C.input, color: showBaseline ? C.bg : C.dim }}>
                                            <Eye size={14} /> Baseline
                                        </button>
                                        <button onClick={() => setShowCurrent(!showCurrent)} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: 'none', display: 'flex', alignItems: 'center', gap: 6, background: showCurrent ? C.accent : C.input, color: showCurrent ? C.bg : C.dim }}>
                                            <Eye size={14} /> Current
                                        </button>
                                        {selectedComparison.diffPath && (
                                            <button onClick={() => setShowDiff(!showDiff)} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: 'none', display: 'flex', alignItems: 'center', gap: 6, background: showDiff ? C.accent : C.input, color: showDiff ? C.bg : C.dim }}>
                                                <Eye size={14} /> Diff
                                            </button>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <button onClick={handleZoomOut} style={{ padding: 6, background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', borderRadius: 4 }}><ZoomOut size={16} /></button>
                                        <span style={{ fontSize: 12, color: C.dim, width: 40, textAlign: 'center' }}>{zoomLevel}%</span>
                                        <button onClick={handleZoomIn} style={{ padding: 6, background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', borderRadius: 4 }}><ZoomIn size={16} /></button>
                                        <button onClick={handleResetZoom} style={{ padding: 6, background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', borderRadius: 4 }}><Maximize2 size={16} /></button>
                                    </div>
                                </div>

                                {/* Comparison View */}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                                    {showBaseline && selectedComparison.baselinePath && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                            <div style={{ fontSize: 12, color: C.dim, fontWeight: 500 }}>Baseline</div>
                                            <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', background: C.bg }}>
                                                <div style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'top left', width: `${100 / (zoomLevel / 100)}%` }}>
                                                    <img src={selectedComparison.baselinePath} alt="Baseline" style={{ width: '100%', display: 'block' }} />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    {showCurrent && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                            <div style={{ fontSize: 12, color: C.dim, fontWeight: 500 }}>
                                                Current Run {selectedComparison.isVisualRegression && <span style={{ color: C.red, marginLeft: 8 }}>⚠️ Changed</span>}
                                            </div>
                                            <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', background: C.bg }}>
                                                <div style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'top left', width: `${100 / (zoomLevel / 100)}%` }}>
                                                    <img src={selectedComparison.currentPath} alt="Current" style={{ width: '100%', display: 'block' }} />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Diff View */}
                                {showDiff && selectedComparison.diffPath && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                                        <div style={{ fontSize: 12, color: C.dim, fontWeight: 500 }}>Difference Highlight</div>
                                        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', background: C.bg }}>
                                            <div style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'top left', width: `${100 / (zoomLevel / 100)}%` }}>
                                                <img src={selectedComparison.diffPath} alt="Difference" style={{ width: '100%', display: 'block' }} />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Analysis Notes */}
                                <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: 16, marginTop: 8 }}>
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                                        <AlertTriangle size={20} color={C.amber} style={{ flexShrink: 0, marginTop: 2 }} />
                                        <div>
                                            <div style={{ fontSize: 14, fontWeight: 600, color: C.amber, marginBottom: 4 }}>
                                                {selectedComparison.isVisualRegression ? 'Visual Regression Detected' : 'No Visual Changes'}
                                            </div>
                                            <p style={{ fontSize: 13, color: '#fcd34d', margin: 0, lineHeight: 1.5, opacity: 0.8 }}>
                                                {selectedComparison.isVisualRegression ? 'The current screenshot shows visual differences from the baseline. Review the diff view to identify specific changes.' : 'The current screenshot matches the baseline. No visual regressions detected.'}
                                            </p>
                                            {selectedComparison.similarityScore !== undefined && (
                                                <div style={{ fontSize: 12, color: '#fcd34d', marginTop: 8, opacity: 0.6 }}>AI Similarity Score: {Math.round(selectedComparison.similarityScore * 100)}%</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.dim }}>
                                <div style={{ textAlign: 'center' }}>
                                    <Eye size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                                    <p style={{ fontSize: 14, margin: 0 }}>Select a screenshot from the sidebar to view comparison</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            </div>
        </div>
    );
}
