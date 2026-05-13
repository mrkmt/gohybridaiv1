// Wizard — stacked step cards that appear sequentially in chat
// Order: Ticket → Discovery → Scenarios → Test Cases → Approve & Run → Results

const STEPS = [
  { id: 'ticket',    num: 1, label: 'Ticket' },
  { id: 'discovery', num: 2, label: 'Discovery' },
  { id: 'scenarios', num: 3, label: 'Scenarios' },
  { id: 'testcases', num: 4, label: 'Test cases' },
  { id: 'run',       num: 5, label: 'Run' },
];

// ════════════════════════════════════════════════════════════
// Stepper — horizontal progress pinned above chat
// ════════════════════════════════════════════════════════════
const WizardStepper = ({ current, completed, onJump }) => {
  const currentIdx = STEPS.findIndex(s => s.id === current);
  return (
    <div className="wz-stepper">
      {STEPS.map((s, i) => {
        const isCurrent = s.id === current;
        const isDone = completed.includes(s.id);
        const isClickable = isDone || isCurrent;
        return (
          <React.Fragment key={s.id}>
            <button
              className={`wz-step ${isCurrent ? 'current' : ''} ${isDone ? 'done' : ''}`}
              onClick={() => isClickable && onJump && onJump(s.id)}
              disabled={!isClickable}>
              <span className="wz-step-num">{isDone ? <IconCheck size={11}/> : s.num}</span>
              <span className="wz-step-label">{s.label}</span>
            </button>
            {i < STEPS.length - 1 && <span className={`wz-step-bar ${i < currentIdx ? 'done' : ''}`}/>}
          </React.Fragment>
        );
      })}
    </div>
  );
};

// ════════════════════════════════════════════════════════════
// Wizard card shell — stacked in chat, all stay visible
// ════════════════════════════════════════════════════════════
const WzCard = ({ num, title, eyebrow, state, onEdit, children, actions }) => (
  <div className={`wz-card ${state}`}>
    <div className="wz-card-head">
      <div className="wz-card-num">{state === 'done' ? <IconCheck size={12}/> : num}</div>
      <div className="wz-card-head-text">
        {eyebrow && <div className="wz-card-eyebrow">{eyebrow}</div>}
        <div className="wz-card-title">{title}</div>
      </div>
      {state === 'done' && onEdit && (
        <button className="wz-card-edit" onClick={onEdit} title="Edit this step — downstream regenerates">
          <IconRefresh size={11}/> Edit
        </button>
      )}
    </div>
    {children && <div className="wz-card-body">{children}</div>}
    {actions && <div className="wz-card-actions">{actions}</div>}
  </div>
);

// ════════════════════════════════════════════════════════════
// Step 1 — Ticket
// ════════════════════════════════════════════════════════════
const WzStepTicket = ({ ticket, state, onNext, onEdit }) => (
  <WzCard num={1} state={state}
    eyebrow={`${ticket.key} · ${ticket.module}`}
    title={ticket.summary}
    onEdit={onEdit}
    actions={state === 'active' && (
      <>
        <button className="btn primary sm" onClick={onNext}>
          Explore the UI <IconChevronRight size={11}/>
        </button>
        <button className="btn sm ghost">Open in Jira</button>
      </>
    )}>
    <div className="wz-ticket-meta">
      <Pill kind={`type-${ticket.type.toLowerCase()}`}>{ticket.type}</Pill>
      <Pill kind={`status-${ticket.status.toLowerCase().replace(/\s/g,'-')}`}>{ticket.status}</Pill>
      <span className="wz-meta-k">Priority</span><span className="wz-meta-v">{ticket.priority}</span>
      <span className="wz-meta-k">Iterations</span><span className="wz-meta-v">{ticket.iterationCount}</span>
    </div>
    <p className="wz-ticket-desc">{ticket.description}</p>
    {ticket.linkedTickets.length > 0 && (
      <div className="wz-ticket-links">
        {ticket.linkedTickets.map(l => (
          <span className="wz-ticket-link" key={l.key}>
            <code>{l.key}</code>{l.summary}
          </span>
        ))}
      </div>
    )}
  </WzCard>
);

// ════════════════════════════════════════════════════════════
// Step 2 — Discovery
// ════════════════════════════════════════════════════════════
const WzStepDiscovery = ({ state, onNext, onEdit, progress }) => {
  const loading = state === 'active' && progress < 1;
  const count = Math.floor(MOCK_SELECTORS.length * Math.min(progress, 1));
  return (
    <WzCard num={2} state={state}
      eyebrow={loading ? 'Explorer Agent · scanning staging.gohybrid.vn' : 'Explorer Agent'}
      title={loading ? 'Locking selectors…' : `${MOCK_SELECTORS.length} stable selectors locked`}
      onEdit={onEdit}
      actions={state === 'active' && !loading && (
        <button className="btn primary sm" onClick={onNext}>
          Generate scenarios <IconChevronRight size={11}/>
        </button>
      )}>
      {loading && (
        <div className="wz-progress">
          <div className="wz-progress-bar" style={{ width: `${Math.min(progress, 1) * 100}%` }}/>
          <div className="wz-progress-text">{count}/{MOCK_SELECTORS.length} elements indexed</div>
        </div>
      )}
      {!loading && (
        <div className="wz-selector-grid">
          {MOCK_SELECTORS.map((s, i) => (
            <div className="wz-selector" key={i}>
              <span className="wz-selector-name">{s.name}</span>
              <code className="wz-selector-val">{s.selector}</code>
            </div>
          ))}
        </div>
      )}
    </WzCard>
  );
};

// ════════════════════════════════════════════════════════════
// Step 3 — Scenarios (AI list + add form + freeform)
// ════════════════════════════════════════════════════════════
const TAG_OPTS = ['Happy', 'Negative', 'Edge', 'Regression'];

const WzStepScenarios = ({ state, scenarios, setScenarios, onNext, onEdit }) => {
  const [addOpen, setAddOpen] = React.useState(false);
  const [newLabel, setNewLabel] = React.useState('');
  const [newTag, setNewTag] = React.useState('Happy');
  const [freeform, setFreeform] = React.useState('');

  const toggle = id => setScenarios(s => s.map(x => x.id === id ? { ...x, selected: !x.selected } : x));
  const remove = id => setScenarios(s => s.filter(x => x.id !== id));

  const addOne = () => {
    if (!newLabel.trim()) return;
    setScenarios(s => [...s, { id: `user-${Date.now()}`, label: newLabel.trim(), tag: newTag, selected: true, source: 'user' }]);
    setNewLabel(''); setAddOpen(false);
  };

  const addFreeform = () => {
    const lines = freeform.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    setScenarios(s => [
      ...s,
      ...lines.map((l, i) => ({ id: `ff-${Date.now()}-${i}`, label: l, tag: 'Happy', selected: true, source: 'user' }))
    ]);
    setFreeform('');
  };

  const selCount = scenarios.filter(s => s.selected).length;

  return (
    <WzCard num={3} state={state}
      eyebrow="Scenario Agent"
      title={`${selCount} of ${scenarios.length} scenarios selected`}
      onEdit={onEdit}
      actions={state === 'active' && (
        <>
          <button className="btn primary sm" disabled={!selCount} onClick={onNext}>
            Generate test cases <IconChevronRight size={11}/>
          </button>
          <span className="wz-actions-hint">{selCount} will be turned into Playwright cases</span>
        </>
      )}>
      <div className="wz-scn-list">
        {scenarios.map(sc => (
          <label key={sc.id} className={`wz-scn ${sc.selected ? 'on' : ''}`}>
            <input type="checkbox" checked={sc.selected} onChange={() => toggle(sc.id)} disabled={state !== 'active'}/>
            <span className="wz-scn-label">{sc.label}</span>
            <span className={`wz-scn-tag ${sc.tag.toLowerCase()}`}>{sc.tag}</span>
            {sc.source === 'user' && <span className="wz-scn-src">you</span>}
            {state === 'active' && (
              <button className="wz-scn-del" onClick={e => { e.preventDefault(); remove(sc.id); }} title="Remove">
                <IconX size={11}/>
              </button>
            )}
          </label>
        ))}
      </div>

      {state === 'active' && (
        <div className="wz-scn-add-group">
          {!addOpen ? (
            <button className="btn sm ghost" onClick={() => setAddOpen(true)}>
              <IconPlus size={11}/> Add a scenario
            </button>
          ) : (
            <div className="wz-scn-add">
              <input className="wz-input" placeholder="e.g. Reject leave when reason is empty" value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addOne()}
                autoFocus/>
              <select className="wz-select" value={newTag} onChange={e => setNewTag(e.target.value)}>
                {TAG_OPTS.map(t => <option key={t}>{t}</option>)}
              </select>
              <button className="btn primary sm" onClick={addOne} disabled={!newLabel.trim()}>Add</button>
              <button className="btn sm ghost" onClick={() => { setAddOpen(false); setNewLabel(''); }}>Cancel</button>
            </div>
          )}

          <details className="wz-freeform-details">
            <summary>Paste scenarios or instructions (one per line)</summary>
            <div className="wz-freeform">
              <textarea className="wz-input" rows={3} placeholder={'Also cover:\n— User on Firefox 115\n— Leave request overlapping a public holiday'}
                value={freeform} onChange={e => setFreeform(e.target.value)}/>
              <button className="btn sm" onClick={addFreeform} disabled={!freeform.trim()}>
                Add {freeform.split('\n').map(l => l.trim()).filter(Boolean).length || ''} as scenarios
              </button>
            </div>
          </details>
        </div>
      )}
    </WzCard>
  );
};

// ════════════════════════════════════════════════════════════
// Step 4 — Test cases (with per-TC approve + modal editor)
// ════════════════════════════════════════════════════════════
const WzStepTestCases = ({ state, cases, setCases, onRun, onEdit, onOpenEditor }) => {
  const approveAll = () => setCases(cs => cs.map(c => ({ ...c, approved: true })));
  const approvedCount = cases.filter(c => c.approved).length;

  const toggleApprove = id => setCases(cs => cs.map(c => c.id === id ? { ...c, approved: !c.approved } : c));
  const removeTC = id => setCases(cs => cs.filter(c => c.id !== id));
  const addTC = () => {
    const n = cases.length + 1;
    const nc = {
      id: `TC-${String(n).padStart(3, '0')}`,
      name: 'New test case',
      scenarioId: null,
      approved: false,
      steps: [{ action: 'Describe the action', expected: 'Describe the expected result', data: '' }],
    };
    setCases(cs => [...cs, nc]);
    onOpenEditor(nc.id);
  };

  return (
    <WzCard num={4} state={state}
      eyebrow="Test Case Agent"
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
            <button className={`wz-tc-check ${tc.approved ? 'on' : ''}`}
              onClick={() => toggleApprove(tc.id)}
              title={tc.approved ? 'Approved — click to un-approve' : 'Approve this case'}
              disabled={state !== 'active'}>
              {tc.approved ? <IconCheck size={11}/> : null}
            </button>
            <div className="wz-tc-body" onClick={() => onOpenEditor(tc.id)}>
              <div className="wz-tc-top">
                <code className="wz-tc-id">{tc.id}</code>
                <span className="wz-tc-name">{tc.name}</span>
              </div>
              <div className="wz-tc-bottom">
                <span className="wz-tc-steps-n">{tc.steps.length} step{tc.steps.length !== 1 ? 's' : ''}</span>
                {tc.steps.slice(0, 2).map((s, i) => (
                  <span className="wz-tc-step-preview" key={i}>› {s.action}</span>
                ))}
              </div>
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
// Test-case step editor drawer (slide-in from right)
// ════════════════════════════════════════════════════════════
const TestCaseEditor = ({ tc, onSave, onClose }) => {
  const [name, setName] = React.useState(tc.name);
  const [steps, setSteps] = React.useState(tc.steps);

  const updateStep = (i, patch) => setSteps(ss => ss.map((s, j) => j === i ? { ...s, ...patch } : s));
  const addStep = () => setSteps(ss => [...ss, { action: '', expected: '', data: '' }]);
  const removeStep = i => setSteps(ss => ss.filter((_, j) => j !== i));
  const moveStep = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const copy = [...steps];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    setSteps(copy);
  };

  return (
    <div className="tce-backdrop" onClick={onClose}>
      <div className="tce-drawer" onClick={e => e.stopPropagation()}>
        <div className="tce-head">
          <div>
            <div className="tce-eyebrow">Edit test case</div>
            <code className="tce-id">{tc.id}</code>
          </div>
          <button className="btn xs ghost" onClick={onClose}><IconX size={12}/></button>
        </div>

        <div className="tce-field">
          <label className="tce-label">Name</label>
          <input className="wz-input" value={name} onChange={e => setName(e.target.value)}/>
        </div>

        <div className="tce-steps-head">
          <span className="tce-label">Steps</span>
          <button className="btn xs" onClick={addStep}><IconPlus size={10}/> Add step</button>
        </div>

        <div className="tce-steps">
          {steps.map((s, i) => (
            <div className="tce-step" key={i}>
              <div className="tce-step-num-col">
                <div className="tce-step-num">{i + 1}</div>
                <div className="tce-step-move">
                  <button className="wz-icon-btn tiny" disabled={i === 0} onClick={() => moveStep(i, -1)}>↑</button>
                  <button className="wz-icon-btn tiny" disabled={i === steps.length - 1} onClick={() => moveStep(i, 1)}>↓</button>
                </div>
              </div>
              <div className="tce-step-fields">
                <div className="tce-sub">
                  <label>Action</label>
                  <input className="wz-input" value={s.action} placeholder="e.g. Click the Submit button"
                    onChange={e => updateStep(i, { action: e.target.value })}/>
                </div>
                <div className="tce-sub">
                  <label>Expected result</label>
                  <input className="wz-input" value={s.expected} placeholder="e.g. Toast shows 'Leave submitted'"
                    onChange={e => updateStep(i, { expected: e.target.value })}/>
                </div>
                <div className="tce-sub">
                  <label>Test data / inputs</label>
                  <input className="wz-input mono" value={s.data} placeholder="e.g. date=2026-04-25, reason=Personal"
                    onChange={e => updateStep(i, { data: e.target.value })}/>
                </div>
              </div>
              <button className="wz-icon-btn danger" onClick={() => removeStep(i)} title="Remove step">
                <IconTrash size={11}/>
              </button>
            </div>
          ))}
          {steps.length === 0 && (
            <div className="tce-empty">No steps yet. Click "Add step" to start.</div>
          )}
        </div>

        <div className="tce-foot">
          <button className="btn sm ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary sm" onClick={() => onSave({ ...tc, name, steps })}>
            <IconCheck size={11}/> Save changes
          </button>
        </div>
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════
// Step 5 — Run (triggers workspace pane automatically)
// ════════════════════════════════════════════════════════════
const WzStepRun = ({ state, cases, running, done, onOpenLive, onOpenResults, onRerun }) => {
  const approved = cases.filter(c => c.approved);
  const pass = MOCK_RESULTS.filter(r => r.status === 'pass').length;
  const fail = MOCK_RESULTS.filter(r => r.status === 'fail').length;

  if (state === 'active' && running) {
    return (
      <WzCard num={5} state="active"
        eyebrow="Executor Agent · streaming"
        title={`Running ${approved.length} tests on chromium…`}
        actions={<button className="btn sm" onClick={onOpenLive}><IconZap size={11}/> Open live console →</button>}>
        <div className="wz-run-live">
          <span className="wz-run-pulse"/>
          <span>Live logs streaming in the workspace pane →</span>
        </div>
      </WzCard>
    );
  }

  if (state === 'done' && done) {
    return (
      <WzCard num={5} state="done"
        eyebrow="Run complete · 13.1s"
        title={`${pass} passed · ${fail} failed`}
        actions={
          <>
            <button className="btn sm" onClick={onOpenResults}>View report →</button>
            <button className="btn sm" onClick={onRerun}><IconRefresh size={11}/> Rerun failed</button>
            <button className="btn primary sm">Push to Jira</button>
          </>
        }>
        <div className="wz-run-summary">
          {MOCK_RESULTS.map(r => (
            <div className={`wz-run-res ${r.status}`} key={r.id}>
              <span className={`exp-test-dot ${r.status}`}/>
              <code className="wz-run-res-id">{r.id}</code>
              <span className="wz-run-res-name">{r.name}</span>
              <span className="wz-run-res-dur">{r.duration}</span>
            </div>
          ))}
        </div>
      </WzCard>
    );
  }

  return null;
};

Object.assign(window, {
  STEPS, WizardStepper, WzCard,
  WzStepTicket, WzStepDiscovery, WzStepScenarios, WzStepTestCases, WzStepRun,
  TestCaseEditor,
});
