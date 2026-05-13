// GoHybrid — Main app shell
// Wizard-driven chat: Ticket → Discovery → Scenarios → Test Cases → Execution → Results

// ════════════════════════════════════════════════════════════
// Sidebar
// ════════════════════════════════════════════════════════════
const Sidebar = ({ view, setView, activeSession, setActiveSession, onNewChat, onLogout, onOpenSettings }) => (
  <aside className="sidebar">
    <div className="sb-brand">
      <div className="sb-brand-mark">G</div>
      <div className="sb-brand-text">GoHybrid<span className="dot">.</span></div>
    </div>

    <button className="sb-new" onClick={onNewChat}>
      <IconPlus size={13}/> New test session <kbd>⌘N</kbd>
    </button>

    <div className="sb-nav">
      <button className={`sb-nav-item ${view==='chat'?'active':''}`} onClick={()=>setView('chat')}>
        <IconMessage size={14}/>Chat
      </button>
      <button className={`sb-nav-item ${view==='pipeline'?'active':''}`} onClick={()=>setView('pipeline')}>
        <IconActivity size={14}/>Pipeline<span className="badge">live</span>
      </button>
      <button className={`sb-nav-item ${view==='explorer'?'active':''}`} onClick={()=>setView('explorer')}>
        <IconFlask size={14}/>Test explorer<span className="badge">11</span>
      </button>
      <button className={`sb-nav-item ${view==='settings'?'active':''}`} onClick={onOpenSettings}>
        <IconSettings size={14}/>Settings
      </button>
    </div>

    <div className="sb-section-label">
      <span>Recent sessions</span>
      <span>{SIDEBAR_SESSIONS.length}</span>
    </div>
    <div className="sb-list">
      {SIDEBAR_SESSIONS.map(s => (
        <div key={s.id}
          className={`sb-item ${activeSession === s.id && view === 'chat' ? 'active' : ''}`}
          onClick={() => { setActiveSession(s.id); setView('chat'); }}>
          <div className="sb-item-top">
            <span className="status-dot" style={{ background: STATUS_DOT_COLOR[s.status] || '#9FB0C9' }}/>
            <span>{s.id}</span>
            {s.iter > 0 && <span className="iter">↻{s.iter}</span>}
          </div>
          <div className="sb-item-summary">{s.summary}</div>
        </div>
      ))}
    </div>

    <div className="sb-user">
      <div className="sb-user-avatar">LN</div>
      <div className="sb-user-text">
        <div className="sb-user-name">Linh Nguyen</div>
        <div className="sb-user-role">Senior QA</div>
      </div>
      <button className="sb-user-btn" onClick={onLogout} title="Sign out"><IconLogout size={13}/></button>
    </div>
  </aside>
);

// ════════════════════════════════════════════════════════════
// Topbar
// ════════════════════════════════════════════════════════════
const Topbar = ({ ticket, view, workspaceOpen, toggleWorkspace }) => {
  const label = view==='pipeline' ? 'Pipeline' : view==='explorer' ? 'Test explorer' : view==='settings' ? 'Settings' : 'Chat';
  return (
    <div className="topbar">
      <div className="topbar-title">
        <span>{label}</span>
        {view==='chat' && ticket && (
          <>
            <span className="topbar-crumb">{ticket.key}</span>
            <span className={`topbar-status ${ticket.status.toLowerCase().replace(/\s/g,'-')}`}>
              <span className="dot"/>{ticket.status}
            </span>
          </>
        )}
      </div>
      <div className="topbar-spacer"/>
      {view==='chat' && workspaceOpen != null && (
        <button className="topbar-action" onClick={toggleWorkspace}>
          {workspaceOpen ? '← Close' : '→ Workspace'}
        </button>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════
// Workspace pane (right side) — Live run + Results only
// ════════════════════════════════════════════════════════════
const WorkspacePane = ({ tab, setTab, logLines, running, runDone, onRerun }) => {
  const ref = React.useRef(null);
  React.useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [logLines.length]);

  const pass = MOCK_RESULTS.filter(r => r.status==='pass').length;
  const fail = MOCK_RESULTS.filter(r => r.status==='fail').length;

  return (
    <div className="workspace">
      <div className="ws-tabs">
        <button className={`ws-tab ${tab==='live'?'active':''} ${running?'live':''}`} onClick={()=>setTab('live')}>
          <IconZap size={12}/>Live run
          {running && <span className="ws-badge live">LIVE</span>}
        </button>
        <button className={`ws-tab ${tab==='results'?'active':''}`} onClick={()=>setTab('results')} disabled={!runDone}>
          <IconActivity size={12}/>Results
          {runDone && <span className="ws-badge">{pass}/{pass+fail}</span>}
        </button>
      </div>

      <div className="ws-body">
        {tab==='live' && (
          <div className="ws-pane">
            <div className="ws-pane-head">
              <div>
                <div className="ws-pane-eyebrow">{running ? 'Streaming · chromium · 2 workers' : runDone ? 'Complete' : 'Idle'}</div>
                <h2 className="ws-pane-title">{running ? 'Executing tests…' : runDone ? 'Run finished' : 'Live execution'}</h2>
              </div>
              {running && <span className="conn-pill" style={{color:'var(--accent-amber)',background:'rgba(245,165,36,0.1)',borderColor:'rgba(245,165,36,0.28)'}}><span className="dot" style={{background:'var(--accent-amber)'}}/>LIVE</span>}
            </div>

            <div className="live-grid">
              {MOCK_TEST_CASES.map((tc) => {
                const finishedLine = logLines.find(l => l.l.startsWith(`✓ ${tc.id}`) || l.l.startsWith(`✗ ${tc.id}`));
                const startedLine = logLines.find(l => l.l.includes(tc.id) && l.l.startsWith('⏵'));
                let st = 'idle';
                if (finishedLine) st = finishedLine.l.startsWith('✓') ? 'pass' : 'fail';
                else if (startedLine) st = 'running';
                return (
                  <div key={tc.id} className={`live-tc live-tc-${st}`}>
                    <span className={`exp-test-dot ${st}`}/>
                    <span className="live-tc-id">{tc.id}</span>
                    <span className="live-tc-name">{tc.name}</span>
                    <span className="live-tc-state">{st}</span>
                  </div>
                );
              })}
            </div>

            <div className="exec-stats" style={{marginBottom:8}}>
              <span className="count">{logLines.filter(l=>l.l.startsWith('✓')||l.l.startsWith('✗')).length}/{MOCK_TEST_CASES.length} tests</span>
              <span>chromium-ap-1</span>
              <span>2 workers</span>
            </div>
            <div className="log-console" ref={ref} style={{height:340}}>
              {logLines.map((l,i) => (
                <span className={`log-line ${l.c}`} key={i}>
                  <span className="ts">{l.t}</span>{l.l}
                </span>
              ))}
              {!running && !runDone && (
                <span className="log-line muted">Waiting for execution to start…</span>
              )}
            </div>
          </div>
        )}

        {tab==='results' && runDone && (
          <div className="ws-pane">
            <div className="ws-pane-head">
              <div>
                <div className="ws-pane-eyebrow">Report ready · 13.1s</div>
                <h2 className="ws-pane-title">{pass} passed · {fail} failed</h2>
              </div>
              <div style={{display:'flex',gap:6}}>
                <button className="btn sm" onClick={onRerun}><IconRefresh size={12}/> Rerun failed</button>
                <button className="btn primary sm">Push to Jira</button>
              </div>
            </div>
            <div className="res-summary">
              <div className="res-stat pass"><div className="n">{pass}</div><div className="l">Passed</div></div>
              <div className="res-stat fail"><div className="n">{fail}</div><div className="l">Failed</div></div>
              <div className="res-stat fault"><div className="n">1</div><div className="l">Healed</div></div>
              <div className="res-stat"><div className="n">13.1s</div><div className="l">Duration</div></div>
            </div>
            <div className="res-list">
              {MOCK_RESULTS.map(r => (
                <div className="res-item" key={r.id}>
                  <span className={`res-badge ${r.status}`}>{r.status.toUpperCase()}</span>
                  <div className="res-body">
                    <div className="res-name">{r.name}</div>
                    {r.note && <div className="res-note">{r.note}</div>}
                  </div>
                  <span className="res-dur">{r.duration}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab==='results' && !runDone && (
          <div className="ws-pane" style={{height:'100%',justifyContent:'center',alignItems:'center',display:'flex',flexDirection:'column',gap:10,textAlign:'center'}}>
            <div className="ws-empty-mark"><IconActivity size={22}/></div>
            <div className="ws-empty-label">No results yet</div>
            <div className="ws-empty-hint">Run the approved test cases first.</div>
          </div>
        )}
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════
// Command parser
// ════════════════════════════════════════════════════════════
const parseCmd = (raw) => {
  const s = raw.trim();
  const m1 = s.match(/^(?:test|run)\s+([A-Z]+-\d+)/i);
  if (m1) return { kind: 'run', ticket: m1[1].toUpperCase() };
  const m2 = s.match(/^(?:check|status)\s+(?:ticket\s+)?([A-Z]+-\d+)(?:\s+status)?/i);
  if (m2) return { kind: 'status', ticket: m2[1].toUpperCase() };
  const m3 = s.match(/^([A-Z]+-\d+)$/i);
  if (m3) return { kind: 'run', ticket: m3[1].toUpperCase() };
  return { kind: 'help' };
};

// ════════════════════════════════════════════════════════════
// Wizard chat view
// ════════════════════════════════════════════════════════════

// Keyword helper for Gherkin display
const GHERKIN_KWS = ['Given','When','Then','And'];
const stepKeyword = (i, total) => {
  if (i === 0) return 'Given';
  if (i === total - 1) return 'Then';
  return i === 1 ? 'When' : 'And';
};

const WizardChatView = ({ session, setSession, workspaceOpen, setWorkspaceOpen }) => {
  // Pipeline state
  const [wizState, setWizState] = React.useState('idle'); // idle | running | done
  const [currentStep, setCurrentStep] = React.useState(null);
  const [completedSteps, setCompletedSteps] = React.useState([]);
  const [activeTicket, setActiveTicket] = React.useState(null);

  // Step data
  const [scenarios, setScenarios] = React.useState(null);
  const [testCases, setTestCases] = React.useState(null);
  const [discoveryProgress, setDiscoveryProgress] = React.useState(0);
  const [discoveryDone, setDiscoveryDone] = React.useState(false);

  // Execution
  const [shownLogs, setShownLogs] = React.useState(0);
  const [running, setRunning] = React.useState(false);
  const [runDone, setRunDone] = React.useState(false);
  const [wsTab, setWsTab] = React.useState('live');

  // Editor modal
  const [editorTcId, setEditorTcId] = React.useState(null);

  // Composer
  const [input, setInput] = React.useState('');
  const scrollRef = React.useRef(null);

  const scrollToBottom = () => {
    setTimeout(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, 80);
  };

  const completeStep = (id) => {
    setCompletedSteps(cs => cs.includes(id) ? cs : [...cs, id]);
  };

  // ── Start pipeline ──
  const startPipeline = (ticketId) => {
    const ticket = SAMPLE_TICKETS[ticketId];
    if (!ticket) return;

    setActiveTicket(ticket);
    setSession(ticketId);
    setCurrentStep('ticket');
    setCompletedSteps([]);
    setScenarios(null);
    setTestCases(null);
    setDiscoveryProgress(0);
    setDiscoveryDone(false);
    setRunning(false);
    setRunDone(false);
    setShownLogs(0);
    setWorkspaceOpen(false);
    setWizState('running');
    scrollToBottom();
  };

  // ── Advance: Ticket → Discovery ──
  const goDiscovery = () => {
    completeStep('ticket');
    setCurrentStep('discovery');
    setDiscoveryProgress(0);
    setDiscoveryDone(false);

    // Animate discovery progress
    let p = 0;
    const iv = setInterval(() => {
      p += 0.07;
      setDiscoveryProgress(Math.min(p, 1));
      if (p >= 1) {
        clearInterval(iv);
        setDiscoveryDone(true);
        scrollToBottom();
      }
    }, 120);
  };

  // ── Advance: Discovery → Scenarios ──
  const goScenarios = () => {
    completeStep('discovery');
    setCurrentStep('scenarios');
    setScenarios(JSON.parse(JSON.stringify(MOCK_SCENARIOS)));
    scrollToBottom();
  };

  // ── Advance: Scenarios → Test cases ──
  const goTestCases = () => {
    completeStep('scenarios');
    setCurrentStep('testcases');
    setTestCases(JSON.parse(JSON.stringify(MOCK_TEST_CASES)));
    scrollToBottom();
  };

  // ── Regenerate downstream when editing an earlier step ──
  const editStep = (stepId) => {
    const order = ['ticket','discovery','scenarios','testcases','run'];
    const idx = order.indexOf(stepId);
    const toRemove = order.slice(idx);
    setCompletedSteps(cs => cs.filter(s => !toRemove.includes(s)));
    setCurrentStep(stepId);
    if (stepId === 'scenarios') { setTestCases(null); setRunning(false); setRunDone(false); setShownLogs(0); }
    if (stepId === 'testcases') { setRunning(false); setRunDone(false); setShownLogs(0); }
    scrollToBottom();
  };

  // ── Run execution ──
  const startRun = () => {
    const approved = (testCases || []).filter(c => c.approved);
    if (!approved.length) return;
    completeStep('testcases');
    setCurrentStep('run');
    setWorkspaceOpen(true);
    setWsTab('live');
    setRunning(true);
    setRunDone(false);
    setShownLogs(0);
    scrollToBottom();

    const iv = setInterval(() => {
      setShownLogs(n => {
        if (n >= MOCK_LOG_LINES.length) {
          clearInterval(iv);
          setRunning(false);
          setRunDone(true);
          completeStep('run');
          setWsTab('results');
          scrollToBottom();
          return n;
        }
        return n + 1;
      });
    }, 180);
  };

  const rerun = () => {
    setRunDone(false);
    setShownLogs(0);
    setRunning(true);
    setWsTab('live');
    const iv = setInterval(() => {
      setShownLogs(n => {
        if (n >= MOCK_LOG_LINES.length) { clearInterval(iv); setRunning(false); setRunDone(true); setWsTab('results'); return n; }
        return n + 1;
      });
    }, 180);
  };

  // ── Editor modal ──
  const openEditor = (id) => setEditorTcId(id);
  const saveEditor = (updated) => {
    setTestCases(cs => cs.map(c => c.id === updated.id ? updated : c));
    setEditorTcId(null);
  };
  const editorTc = editorTcId && testCases ? testCases.find(c => c.id === editorTcId) : null;

  // ── Handle composer ──
  const handleSend = (val) => {
    const cmd = parseCmd(val);
    if (cmd.kind === 'run') startPipeline(cmd.ticket);
    else if (cmd.kind === 'status') {
      const t = SAMPLE_TICKETS[cmd.ticket];
      if (t) startPipeline(cmd.ticket);
    }
    setInput('');
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (input.trim()) handleSend(input); }
  };

  const stepState = (id) => {
    if (completedSteps.includes(id)) return 'done';
    if (currentStep === id) return 'active';
    return 'inactive';
  };

  return (
    <div className={`chat-and-ws ${workspaceOpen ? 'ws-open' : ''}`}>
      <div className="chat-view">
        {/* Stepper */}
        {wizState !== 'idle' && (
          <WizardStepper
            current={currentStep}
            completed={completedSteps}
            onJump={editStep}
          />
        )}

        {/* Cards scroll */}
        <div className="wz-chat-scroll" ref={scrollRef}>
          {/* Welcome */}
          {wizState === 'idle' && (
            <div className="empty" style={{flex:1}}>
              <div className="empty-mark">
                <div className="empty-mark-inner">G</div>
              </div>
              <h2 className="empty-title">
                Start with a <span className="aura-text">Jira ticket</span>
              </h2>
              <p className="empty-sub">
                Type <code>Test ATT-22</code> to run the full pipeline, or click one below to begin.
              </p>
              <div className="empty-tickets">
                {Object.values(SAMPLE_TICKETS).filter(t => t.status !== 'Done' && t.status !== 'Bug Done').map(t => (
                  <button key={t.key} className="empty-ticket" onClick={() => startPipeline(t.key)}>
                    <div className="empty-ticket-top">
                      <span className="status-dot" style={{background: STATUS_DOT_COLOR[t.status]}}/>
                      {t.key}
                    </div>
                    <div className="empty-ticket-sum">{t.summary.slice(0, 60)}{t.summary.length > 60 ? '…' : ''}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 1: Ticket ── */}
          {activeTicket && (currentStep === 'ticket' || completedSteps.includes('ticket')) && (
            <WzStepTicket
              ticket={activeTicket}
              state={stepState('ticket')}
              onNext={goDiscovery}
              onEdit={() => editStep('ticket')}
            />
          )}

          {/* ── Step 2: Discovery ── */}
          {(currentStep === 'discovery' || completedSteps.includes('discovery')) && (
            <WzStepDiscovery
              state={stepState('discovery')}
              progress={discoveryProgress}
              onNext={goScenarios}
              onEdit={() => editStep('discovery')}
            />
          )}

          {/* ── Step 3: Scenarios ── */}
          {scenarios && (currentStep === 'scenarios' || completedSteps.includes('scenarios')) && (
            <WzStepScenarios
              state={stepState('scenarios')}
              scenarios={scenarios}
              setScenarios={setScenarios}
              onNext={goTestCases}
              onEdit={() => editStep('scenarios')}
            />
          )}

          {/* ── Step 4: Test cases (human readable) ── */}
          {testCases && (currentStep === 'testcases' || completedSteps.includes('testcases')) && (
            <WzStepTestCasesHR
              state={stepState('testcases')}
              cases={testCases}
              setCases={setTestCases}
              onRun={startRun}
              onEdit={() => editStep('testcases')}
              onOpenEditor={openEditor}
            />
          )}

          {/* ── Step 5: Execution / Results ── */}
          {(currentStep === 'run' || completedSteps.includes('run')) && (
            <WzStepRun
              state={stepState('run')}
              cases={testCases || []}
              running={running}
              done={runDone}
              onOpenLive={() => setWsTab('live')}
              onOpenResults={() => setWsTab('results')}
              onRerun={rerun}
            />
          )}
        </div>

        {/* Composer */}
        <div className="wz-composer">
          <div className="wz-composer-inner">
            <textarea
              className="wz-composer-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={wizState === 'idle' ? 'Type "Test ATT-22" to start…' : 'Ask a question or type another ticket ID…'}
              rows={1}
            />
            <button className="wz-composer-btn" onClick={() => input.trim() && handleSend(input)} disabled={!input.trim()}>
              <IconSend size={13}/>
            </button>
          </div>
          <div style={{maxWidth:680,margin:'6px auto 0',padding:'0 4px',display:'flex',justifyContent:'space-between'}}>
            <div style={{display:'flex',gap:5}}>
              {['Test ATT-22','Test ATT-15','check ticket ATT-08 status'].map(s => (
                <button key={s} className="wz-scn-src" style={{cursor:'pointer',fontSize:11}} onClick={() => setInput(s)}>{s}</button>
              ))}
            </div>
            <span style={{fontSize:11,color:'var(--fg-3)'}}>↵ to send</span>
          </div>
        </div>
      </div>

      {/* Right workspace — Live + Results */}
      {workspaceOpen && (
        <WorkspacePane
          tab={wsTab}
          setTab={setWsTab}
          logLines={MOCK_LOG_LINES.slice(0, shownLogs)}
          running={running}
          runDone={runDone}
          onRerun={rerun}
        />
      )}

      {/* Test case editor modal */}
      {editorTc && (
        <TestCaseEditor
          tc={editorTc}
          onSave={saveEditor}
          onClose={() => setEditorTcId(null)}
        />
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════
// Human-readable test case card (Given/When/Then)
// ════════════════════════════════════════════════════════════
const WzStepTestCasesHR = ({ state, cases, setCases, onRun, onEdit, onOpenEditor }) => {
  const [expanded, setExpanded] = React.useState({});
  const toggleExpand = id => setExpanded(e => ({ ...e, [id]: !e[id] }));

  const approveAll = () => setCases(cs => cs.map(c => ({ ...c, approved: true })));
  const toggleApprove = id => setCases(cs => cs.map(c => c.id === id ? { ...c, approved: !c.approved } : c));
  const removeTC = id => setCases(cs => cs.filter(c => c.id !== id));

  const addTC = () => {
    const n = cases.length + 1;
    const nc = {
      id: `TC-${String(n).padStart(3, '0')}`,
      name: 'New test case',
      scenarioId: null,
      approved: false,
      steps: [
        { action: 'Navigate to the target page', expected: 'Page loads successfully', data: '' },
      ],
    };
    setCases(cs => [...cs, nc]);
    onOpenEditor(nc.id);
  };

  const approvedCount = cases.filter(c => c.approved).length;

  return (
    <WzCard num={4} state={state}
      eyebrow="Test Case Agent · Gherkin / Human-readable"
      title={`${cases.length} test cases · ${approvedCount} approved`}
      onEdit={onEdit}
      actions={state === 'active' && (
        <>
          <button className="btn primary sm" disabled={approvedCount === 0} onClick={onRun}>
            <IconPlay size={11}/> Run {approvedCount} approved
          </button>
          <button className="btn sm" onClick={approveAll}>Approve all & run</button>
          <button className="btn sm ghost" onClick={addTC}><IconPlus size={11}/> Add case</button>
        </>
      )}>
      <div className="wz-tc-list">
        {cases.map(tc => (
          <div className={`wz-tc ${tc.approved ? 'approved' : ''}`} key={tc.id}>
            <button
              className={`wz-tc-check ${tc.approved ? 'on' : ''}`}
              onClick={() => toggleApprove(tc.id)}
              disabled={state !== 'active'}
              title={tc.approved ? 'Approved' : 'Approve'}>
              {tc.approved && <IconCheck size={11}/>}
            </button>

            <div className="wz-tc-body" onClick={() => toggleExpand(tc.id)}>
              <div className="wz-tc-top">
                <code className="wz-tc-id">{tc.id}</code>
                <span className="wz-tc-name">{tc.name}</span>
                <span style={{marginLeft:'auto',color:'var(--fg-3)',fontSize:10}}>
                  {expanded[tc.id] ? '▲' : '▼'}
                </span>
              </div>

              {/* Always show step count summary */}
              {!expanded[tc.id] && (
                <div className="wz-tc-bottom">
                  <span className="wz-tc-steps-n">{tc.steps.length} steps</span>
                  <span className="wz-tc-step-preview">
                    Given {tc.steps[0]?.action}
                  </span>
                </div>
              )}

              {/* Expanded: Gherkin view */}
              {expanded[tc.id] && (
                <div className="wz-tc-steps">
                  {tc.steps.map((s, i) => {
                    const kw = stepKeyword(i, tc.steps.length);
                    return (
                      <div className="wz-tc-step" key={i}>
                        <span className={`wz-tc-step-kw ${kw.toLowerCase()}`}>{kw}</span>
                        <div style={{flex:1}}>
                          <div className="wz-tc-step-text">{s.action}</div>
                          <div style={{fontSize:11,color:'var(--pass)',marginTop:2}}>→ {s.expected}</div>
                          {s.data && <div className="wz-tc-step-data">{s.data}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="wz-tc-tools">
              <button className="wz-icon-btn" onClick={() => onOpenEditor(tc.id)} title="Edit steps">
                <IconCommand size={11}/>
              </button>
              {state === 'active' && (
                <button className="wz-icon-btn danger" onClick={() => removeTC(tc.id)} title="Delete">
                  <IconTrash size={11}/>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </WzCard>
  );
};

// ════════════════════════════════════════════════════════════
// Tweaks panel
// ════════════════════════════════════════════════════════════
const TWEAK_DEFAULS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "density": "cozy",
  "auraIntensity": 0.35
}/*EDITMODE-END*/;

const TweaksPanel = ({ tweaks, setTweak, onClose }) => (
  <div className="tweaks-panel">
    <div className="tweaks-hdr">
      <span><IconSliders size={12} style={{verticalAlign:'-2px',marginRight:6}}/>Tweaks</span>
      <button className="btn xs ghost" onClick={onClose}><IconX size={11}/></button>
    </div>
    <div className="tweaks-body">
      <div className="tweak-row">
        <div className="name">Theme</div>
        <div className="seg">
          {['dark','light'].map(t => (
            <button key={t} className={`seg-opt ${tweaks.theme===t?'active':''}`} onClick={()=>setTweak('theme',t)}>{t}</button>
          ))}
        </div>
      </div>
      <div className="tweak-row">
        <div className="name">Density</div>
        <div className="seg">
          {['compact','cozy','comfortable'].map(d => (
            <button key={d} className={`seg-opt ${tweaks.density===d?'active':''}`} onClick={()=>setTweak('density',d)}>{d[0].toUpperCase()}</button>
          ))}
        </div>
      </div>
      <div className="tweak-row">
        <div className="name">Aura intensity<span className="desc" style={{fontSize:10,color:'var(--fg-3)',display:'block'}}>{Math.round(tweaks.auraIntensity*100)}%</span></div>
        <input className="range" type="range" min="0" max="1" step="0.05" value={tweaks.auraIntensity}
          onChange={e => setTweak('auraIntensity', parseFloat(e.target.value))}/>
      </div>
    </div>
  </div>
);

// ════════════════════════════════════════════════════════════
// Root App
// ════════════════════════════════════════════════════════════
const App = () => {
  const [authed, setAuthed] = React.useState(() => localStorage.getItem('gh_authed') === '1');
  const [view, setView] = React.useState(() => localStorage.getItem('gh_view') || 'chat');
  const [session, setSession] = React.useState('ATT-22');
  const [workspaceOpen, setWorkspaceOpen] = React.useState(false);
  const [tweaks, setTweaks] = React.useState(TWEAK_DEFAULS);
  const [tweaksOpen, setTweaksOpen] = React.useState(false);

  React.useEffect(() => { localStorage.setItem('gh_view', view); }, [view]);
  React.useEffect(() => { localStorage.setItem('gh_authed', authed ? '1' : '0'); }, [authed]);

  React.useEffect(() => {
    const onMsg = (e) => {
      if (!e.data) return;
      if (e.data.type === '__activate_edit_mode') setTweaksOpen(true);
      if (e.data.type === '__deactivate_edit_mode') setTweaksOpen(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  React.useEffect(() => {
    document.documentElement.dataset.theme = tweaks.theme;
    document.documentElement.dataset.density = tweaks.density;
    document.documentElement.style.setProperty('--aura-intensity', tweaks.auraIntensity);
  }, [tweaks]);

  const setTweak = (k, v) => {
    setTweaks(t => {
      const next = { ...t, [k]: v };
      window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [k]: v } }, '*');
      return next;
    });
  };

  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)}/>;

  return (
    <div className="app-shell">
      <div className="aura-bg"/>
      <div className="aura-bg bottom"/>
      <Sidebar
        view={view}
        setView={setView}
        activeSession={session}
        setActiveSession={setSession}
        onNewChat={() => { setView('chat'); setSession(null); setWorkspaceOpen(false); }}
        onLogout={() => setAuthed(false)}
        onOpenSettings={() => setView('settings')}
      />
      <main className="main">
        <Topbar
          ticket={view==='chat' ? SAMPLE_TICKETS[session] : null}
          view={view}
          workspaceOpen={view==='chat' ? workspaceOpen : null}
          toggleWorkspace={() => setWorkspaceOpen(v => !v)}
        />
        {view==='chat' && (
          <WizardChatView
            session={session}
            setSession={setSession}
            workspaceOpen={workspaceOpen}
            setWorkspaceOpen={setWorkspaceOpen}
          />
        )}
        {view==='pipeline' && <PipelineScreen/>}
        {view==='explorer' && <ExplorerScreen/>}
        {view==='settings' && <SettingsScreen/>}
      </main>
      {tweaksOpen && <TweaksPanel tweaks={tweaks} setTweak={setTweak} onClose={()=>setTweaksOpen(false)}/>}
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
