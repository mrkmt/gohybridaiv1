import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ActivityBar, ActivityTab } from '../components/ActivityBar';
import { Maximize2, Minimize2, X, Terminal, ChevronUp, ChevronDown, Plus, Trash2 } from 'lucide-react';

interface TermTab {
  id: string;
  name: string;
  logs: any[];
}

interface ModernLayoutProps {
  children: React.ReactNode;
  activeTab: ActivityTab;
  onTabChange: (tab: ActivityTab) => void;
  explorerTitle: string;
  explorerContent?: React.ReactNode;
  bottomPanelContent?: React.ReactNode; // Default/Global logs
  sidebarPosition: 'left' | 'right';
}

export const ModernLayout: React.FC<ModernLayoutProps> = ({ 
  children, 
  activeTab, 
  onTabChange, 
  sidebarPosition,
  explorerTitle,
  explorerContent,
  bottomPanelContent
}) => {
  // Resizable state
  const [explorerWidth, setExplorerWidth] = useState(280);
  const [panelHeight, setPanelHeight] = useState(220);
  const [panelState, setPanelState] = useState<'visible' | 'minimized' | 'maximized'>('visible');
  
  // Terminal Tabs state
  const [terminals, setTerminals] = useState<TermTab[]>([
    { id: 'default', name: 'System', logs: [] }
  ]);
  const [activeTermId, setActiveTermId] = useState('default');
  
  const isResizingWidth = useRef(false);
  const isResizingHeight = useRef(false);

  // Sync global logs to the 'default' terminal if provided
  useEffect(() => {
    if (bottomPanelContent) {
      // Note: In a real app, we'd append or sync. Here we just ensure the default tab shows the content.
    }
  }, [bottomPanelContent]);

  const addNewTerminal = () => {
    const newId = `term-${Date.now()}`;
    const newTerm: TermTab = {
      id: newId,
      name: `bash ${terminals.length}`,
      logs: [{ timestamp: Date.now(), category: 'INFO', source: 'SHELL', message: 'New terminal session started.' }]
    };
    setTerminals([...terminals, newTerm]);
    setActiveTermId(newId);
    if (panelState === 'minimized') setPanelState('visible');
  };

  const closeTerminal = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (terminals.length === 1) return; // Keep at least one
    const newTerminals = terminals.filter(t => t.id !== id);
    setTerminals(newTerminals);
    if (activeTermId === id) setActiveTermId(newTerminals[0].id);
  };

  const startResizingWidth = useCallback((e: React.MouseEvent) => {
    isResizingWidth.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResizing);
    document.body.style.cursor = 'col-resize';
  }, []);

  const startResizingHeight = useCallback((e: React.MouseEvent) => {
    isResizingHeight.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResizing);
    document.body.style.cursor = 'row-resize';
  }, []);

  const stopResizing = useCallback(() => {
    isResizingWidth.current = false;
    isResizingHeight.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', stopResizing);
    document.body.style.cursor = 'default';
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isResizingWidth.current) {
      const newWidth = sidebarPosition === 'left' ? e.clientX - 52 : window.innerWidth - e.clientX - 52;
      if (newWidth > 150 && newWidth < 600) setExplorerWidth(newWidth);
    }
    if (isResizingHeight.current) {
      const newHeight = window.innerHeight - e.clientY;
      if (newHeight > 100 && newHeight < window.innerHeight * 0.8) setPanelHeight(newHeight);
    }
  }, [sidebarPosition]);

  const togglePanel = () => {
    if (panelState === 'minimized') setPanelState('visible');
    else setPanelState('minimized');
  };

  const maximizePanel = () => {
    if (panelState === 'maximized') setPanelState('visible');
    else setPanelState('maximized');
  };

  const activeTerm = terminals.find(t => t.id === activeTermId) || terminals[0];

  return (
    <div className="modern-layout" style={{ 
      display: 'flex', 
      height: '100vh', 
      backgroundColor: 'var(--bg-dark)', 
      overflow: 'hidden',
      flexDirection: sidebarPosition === 'right' ? 'row-reverse' : 'row'
    }}>
      {/* Activity Bar */}
      <ActivityBar 
        activeTab={activeTab} 
        onTabChange={onTabChange} 
        position={sidebarPosition} 
      />
      
      {/* Explorer Sidebar */}
      <div 
        className="explorer-container glass"
        style={{
          width: `${explorerWidth}px`,
          backgroundColor: 'var(--bg-explorer)',
          borderRight: sidebarPosition === 'left' ? '1px solid var(--border-glass)' : 'none',
          borderLeft: sidebarPosition === 'right' ? '1px solid var(--border-glass)' : 'none',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 50,
          position: 'relative'
        }}
      >
        <div style={{ 
          padding: '14px 16px', 
          borderBottom: '1px solid var(--border-glass)', 
          background: 'rgba(255,255,255,0.02)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span style={{ 
            fontSize: '11px', 
            fontWeight: 600, 
            color: 'var(--text-dim)', 
            letterSpacing: '0.08em', 
            textTransform: 'uppercase' 
          }}>
            {explorerTitle}
          </span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {explorerContent}
        </div>

        {/* Resize Handle Width */}
        <div 
          onMouseDown={startResizingWidth}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            [sidebarPosition === 'left' ? 'right' : 'left']: '-3px',
            width: '6px',
            cursor: 'col-resize',
            zIndex: 100,
            transition: 'background 0.2s',
          }}
          className="resize-handle-h"
        />
      </div>

      {/* Main Content Area */}
      <main 
        style={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column',
          position: 'relative',
          backgroundColor: 'var(--bg-dark)',
          minWidth: 0,
        }}
      >
        <div className="main-content" style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
          {children}
        </div>

        {/* Bottom Panel (Terminal) */}
        <div 
          className={`bottom-panel glass ${panelState}`}
          style={{
            height: panelState === 'maximized' ? '100%' : panelState === 'minimized' ? '36px' : `${panelHeight}px`,
            borderTop: '1px solid var(--border-glass)',
            backgroundColor: 'var(--bg-panel)',
            display: 'flex',
            flexDirection: 'column',
            transition: panelState === 'visible' ? 'none' : 'height 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            position: panelState === 'maximized' ? 'absolute' : 'relative',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: panelState === 'maximized' ? 1000 : 100
          }}
        >
          {/* Resize Handle Height */}
          {panelState === 'visible' && (
            <div 
              onMouseDown={startResizingHeight}
              style={{
                position: 'absolute',
                top: '-3px',
                left: 0,
                right: 0,
                height: '6px',
                cursor: 'row-resize',
                zIndex: 101,
              }}
            />
          )}

          <div style={{ 
            padding: '0 16px', 
            height: '36px',
            borderBottom: panelState === 'minimized' ? 'none' : '1px solid var(--border-glass)', 
            display: 'flex', 
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'rgba(255,255,255,0.02)',
            cursor: 'pointer'
          }}
            onClick={(e) => {
              if ((e.target as HTMLElement).tagName !== 'BUTTON') togglePanel();
            }}
          >
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', height: '100%', overflow: 'hidden' }}>
              {terminals.map(term => (
                <div 
                  key={term.id}
                  onClick={(e) => { e.stopPropagation(); setActiveTermId(term.id); if (panelState === 'minimized') setPanelState('visible'); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '0 12px',
                    height: '100%',
                    fontSize: '11px',
                    fontWeight: activeTermId === term.id ? 600 : 500,
                    color: activeTermId === term.id ? 'var(--text-main)' : 'var(--text-dim)',
                    borderBottom: activeTermId === term.id ? '2px solid var(--primary)' : 'none',
                    background: activeTermId === term.id ? 'rgba(255,255,255,0.03)' : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  <Terminal size={12} />
                  <span style={{ whiteSpace: 'nowrap' }}>{term.name.toUpperCase()}</span>
                  {terminals.length > 1 && (
                    <X 
                      size={10} 
                      className="close-term"
                      onClick={(e) => closeTerminal(e, term.id)} 
                      style={{ opacity: 0.5, marginLeft: '4px' }}
                    />
                  )}
                </div>
              ))}
              <button 
                className="icon-btn-sm" 
                onClick={(e) => { e.stopPropagation(); addNewTerminal(); }}
                style={{ marginLeft: '8px', opacity: 0.6 }}
                title="New Terminal"
              >
                <Plus size={14} />
              </button>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button className="icon-btn-sm" onClick={(e) => { e.stopPropagation(); maximizePanel(); }}>
                {panelState === 'maximized' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
              <button className="icon-btn-sm" onClick={(e) => { e.stopPropagation(); togglePanel(); }}>
                {panelState === 'minimized' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>
          </div>

          {(panelState === 'visible' || panelState === 'maximized') && (
            <div style={{ 
              flex: 1, 
              overflowY: 'auto', 
              padding: '12px 16px', 
              backgroundColor: 'rgba(0,0,0,0.25)',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              lineHeight: '1.5',
              display: 'flex',
              flexDirection: 'column'
            }}>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {activeTermId === 'default' ? bottomPanelContent : (
                  <div style={{ color: 'var(--text-dim)' }}>
                    {activeTerm.logs.map((log, i) => (
                      <div key={i}>[{new Date(log.timestamp).toLocaleTimeString()}] {log.message}</div>
                    ))}
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px', color: 'var(--primary)' }}>
                      <span style={{ fontWeight: 'bold' }}>&gt;</span>
                      <span className="cursor-blink">_</span>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Terminal Input Area */}
              <div style={{ 
                marginTop: '12px', 
                borderTop: '1px solid var(--border-glass)', 
                padding: '12px 0 4px',
                display: 'flex',
                gap: '8px',
                alignItems: 'center'
              }}>
                <span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>guest@gohybrid</span>
                <span style={{ color: 'var(--text-muted)' }}>:</span>
                <span style={{ color: 'var(--primary)', fontWeight: 600 }}>~</span>
                <span style={{ color: 'var(--text-muted)' }}>$</span>
                <input 
                  type="text"
                  placeholder="Type a command..."
                  style={{
                    flex: 1,
                    background: 'none',
                    border: 'none',
                    outline: 'none',
                    color: 'var(--text-main)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px'
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const val = (e.target as HTMLInputElement).value;
                      if (!val) return;
                      // Local echo for bash tabs
                      if (activeTermId !== 'default') {
                        setTerminals(prev => prev.map(t => t.id === activeTermId ? { ...t, logs: [...t.logs, { timestamp: Date.now(), message: `$ ${val}` }] } : t));
                      }
                      (e.target as HTMLInputElement).value = '';
                    }
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </main>

      <style>{`
        .icon-btn-sm {
          background: none;
          border: none;
          color: var(--text-dim);
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.2s, color 0.2s;
          outline: none;
        }
        .icon-btn-sm:hover {
          background: rgba(255,255,255,0.05);
          color: var(--text-main);
        }
        .resize-handle-h:hover {
          background: var(--primary);
        }
        .close-term:hover {
          color: var(--accent-rose);
          opacity: 1 !important;
        }
        .cursor-blink { animation: blink 1s step-end infinite; }
        @keyframes blink { 
          0%, 100% { opacity: 1; } 
          50% { opacity: 0; } 
        }
      `}</style>
    </div>
  );
};
