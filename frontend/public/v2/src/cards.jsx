// Reusable chat "cards" posted by the agent

const Pill = ({ children, kind = '' }) => (
  <span className={`pill ${kind}`}>{children}</span>
);

const StatusDot = ({ status }) => (
  <span className="status-dot" style={{ background: STATUS_DOT_COLOR[status] || '#9FB0C9' }} />
);

const CardHeader = ({ num, title, meta }) => (
  <div className="card-hdr">
    {num && <span className="phase-num">{num}</span>}
    <span>{title}</span>
    {meta && <span style={{marginLeft:'auto', fontFamily:'var(--font-mono)', color:'var(--fg-3)', textTransform:'none', letterSpacing:0}}>{meta}</span>}
  </div>
);

// Phase stepper inside cards
const Stepper = ({ phase }) => {
  const idx = PIPELINE_PHASES.findIndex(p => p.k === phase);
  return (
    <div className="stepper">
      {PIPELINE_PHASES.map((p, i) => {
        const state = i < idx ? 'done' : i === idx ? 'current' : '';
        return (
          <React.Fragment key={p.k}>
            <div className={`step ${state}`}>
              <span className="step-num">{i < idx ? <IconCheck size={10}/> : i + 1}</span>
              <span>{p.label}</span>
            </div>
            {i < PIPELINE_PHASES.length - 1 && <div className="step-sep"/>}
          </React.Fragment>
        );
      })}
    </div>
  );
};

const PIPELINE_PHASES = [
  { k: 'ticket', label: 'Ticket' },
  { k: 'scenarios', label: 'Scenarios' },
  { k: 'explore', label: 'Explore' },
  { k: 'generate', label: 'Generate' },
  { k: 'run', label: 'Run' },
  { k: 'report', label: 'Report' },
];

// Ticket card
const TicketCard = ({ ticket }) => (
  <div className="card">
    <CardHeader num="1" title="Ticket pulled from Jira" meta={ticket.key}/>
    <div className="card-body">
      <div className="ticket-meta">
        <span className="pill ticket-key">{ticket.key}</span>
        <Pill kind={`type-${ticket.type.toLowerCase()}`}>{ticket.type}</Pill>
        <Pill kind={`status-${ticket.status.toLowerCase().replace(/\s/g,'-')}`}>{ticket.status}</Pill>
      </div>
      <div className="ticket-title">{ticket.summary}</div>
      <div className="ticket-desc">{ticket.description}</div>
      <div className="kv-row">
        <span>Module<strong>{ticket.module}</strong></span>
        <span>Priority<strong>{ticket.priority}</strong></span>
        <span>Iteration<strong>{ticket.iterationCount + 1}</strong></span>
      </div>
      {ticket.linkedTickets.length > 0 && (
        <div className="linked-block">
          <span>Linked</span>
          {ticket.linkedTickets.map(l => (
            <React.Fragment key={l.key}>
              <span className="linked-key">{l.key}</span>
              <span style={{color:'var(--fg-2)'}}>{l.summary}</span>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  </div>
);

// Scenario card
const ScenarioCard = ({ scenarios, onToggle }) => {
  const selected = scenarios.filter(s => s.selected).length;
  return (
    <div className="card">
      <CardHeader num="2" title="Scenarios proposed"/>
      <div className="card-body">
        <div className="scn-head">
          <div className="title">Select the scenarios to cover</div>
          <div className="count">{selected} of {scenarios.length}</div>
        </div>
        <div className="scn-list">
          {scenarios.map(s => (
            <label key={s.id} className={`scn-item ${s.selected ? 'selected' : ''}`}>
              <input type="checkbox" className="scn-check" checked={s.selected} onChange={() => onToggle(s.id)}/>
              <span className="scn-label">{s.label}</span>
              <span className={`scn-tag ${s.tag}`}>{s.tag}</span>
            </label>
          ))}
        </div>
        <div className="input-row">
          <input placeholder="Add custom scenario…"/>
          <button className="btn sm"><IconPlus size={12}/> Add</button>
        </div>
      </div>
    </div>
  );
};

// Selector card
const SelectorCard = ({ selectors }) => (
  <div className="card">
    <CardHeader num="3" title="UI exploration complete" meta="staging.gohybrid.vn"/>
    <div className="card-body">
      <div className="status-banner success">
        <IconCheck size={14}/>
        <span>{selectors.length} stable selectors locked. DOM snapshot stored for self-healing.</span>
      </div>
      <div className="selector-list">
        {selectors.map((s, i) => (
          <div className="selector-row" key={i}>
            <span className="sel-name">{s.name}</span>
            <span className="sel-val">{s.selector}</span>
            <span className="sel-type">{s.type}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

// Test case card
const TestCaseCard = ({ cases, onRun }) => (
  <div className="card">
    <CardHeader num="4" title="Playwright cases generated" meta={`${cases.length} cases · Gherkin mirror`}/>
    <div className="card-body">
      <div className="tc-list">
        {cases.map(c => (
          <div className="tc-item" key={c.id}>
            <span className="tc-id">{c.id}</span>
            <span className="tc-name">{c.name}</span>
            <div className="tc-actions"><button className="btn xs">View</button></div>
          </div>
        ))}
      </div>
    </div>
    <div className="card-actions">
      <button className="btn primary" onClick={onRun}><IconPlay size={12}/> Run all</button>
      <button className="btn sm">Export .feature</button>
      <button className="btn sm ghost">Edit in IDE</button>
    </div>
  </div>
);

// Log card
const LogCard = ({ lines, running }) => {
  const ref = React.useRef(null);
  React.useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [lines.length]);
  const totalTests = 4;
  const done = lines.filter(l => l.l.startsWith('✓') || l.l.startsWith('✗')).length;
  return (
    <div className="card">
      <CardHeader num="5" title={running ? 'Executing on playwright · chromium' : 'Execution complete'}/>
      <div className="card-body">
        <div className="exec-stats">
          <span className="count">{done}/{totalTests} tests</span>
          <span>chromium-ap-1</span>
          <span>2 workers</span>
        </div>
        {running && lines.length > 0 && (
          <div className="exec-cur">{lines[lines.length - 1].l.trim()}</div>
        )}
        <div className="log-console" ref={ref}>
          {lines.map((l, i) => (
            <span className={`log-line ${l.c}`} key={i}>
              <span className="ts">{l.t}</span>{l.l}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

// Results card
const ResultsCard = ({ results, onRerun }) => {
  const pass = results.filter(r => r.status === 'pass').length;
  const fail = results.filter(r => r.status === 'fail').length;
  const dur = '13.1s';
  return (
    <div className="card">
      <CardHeader num="6" title="Run summary" meta="Report ready"/>
      <div className="card-body">
        <div className="res-summary">
          <div className="res-stat pass"><div className="n">{pass}</div><div className="l">Passed</div></div>
          <div className="res-stat fail"><div className="n">{fail}</div><div className="l">Failed</div></div>
          <div className="res-stat fault"><div className="n">1</div><div className="l">Healed</div></div>
          <div className="res-stat"><div className="n">{dur}</div><div className="l">Duration</div></div>
        </div>
        <div className="res-list">
          {results.map(r => (
            <div className={`res-item`} key={r.id}>
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
      <div className="card-actions">
        <button className="btn primary">Push report to Jira</button>
        <button className="btn sm" onClick={onRerun}><IconRefresh size={12}/> Rerun failed</button>
        <button className="btn sm ghost">Download trace</button>
      </div>
    </div>
  );
};

Object.assign(window, { Pill, StatusDot, CardHeader, Stepper, PIPELINE_PHASES,
  TicketCard, ScenarioCard, SelectorCard, TestCaseCard, LogCard, ResultsCard });
