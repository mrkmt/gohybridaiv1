// Non-chat screens: Login, Settings, Pipeline, Test Explorer

// ════════════════════════════════════════════════════════════
// Login
// ════════════════════════════════════════════════════════════
const LoginScreen = ({ onLogin }) => {
  const [email, setEmail] = React.useState('gohybrid@ai.com');
  const [pw, setPw] = React.useState('Global@2026');
  return (
    <div className="login-shell">
      <div className="login-brand">
        <div className="aura-bg"/>
        <div className="login-brand-top">
          <div className="login-brand-logo">
            <span className="mark">G</span>
            GoHybrid<span className="dot">.</span>
          </div>
        </div>
        <div className="login-brand-body">
          <div className="login-brand-eyebrow">vieLAB · Autonomous QA</div>
          <h1 className="login-brand-title">
            Ship features faster, <span className="aura-text">trust the tests.</span>
          </h1>
          <p className="login-brand-sub">
            Drop a Jira ticket in — GoHybrid proposes scenarios, explores your staging app, writes Playwright tests, runs them in parallel, and pushes a report back to the ticket.
          </p>
        </div>
        <div className="login-brand-footer">
          {['Reads Jira, GitHub, and staging in one session','Self-heals broken selectors mid-run','Gherkin + Playwright output your team can commit'].map(f => (
            <div key={f} className="login-feature">
              <span className="check"><IconCheck size={10}/></span>{f}
            </div>
          ))}
        </div>
      </div>

      <div className="login-form-wrap">
        <form className="login-form" onSubmit={e => { e.preventDefault(); onLogin(); }}>
          <h1>Sign in to your workspace</h1>
          <p className="sub">Continue with your GoHybrid corporate account to resume sessions.</p>

          <div className="login-field">
            <label>Work email</label>
            <div className="login-input-wrap">
              <IconMail size={14}/>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}/>
            </div>
          </div>
          <div className="login-field">
            <label>Password</label>
            <div className="login-input-wrap">
              <IconLock size={14}/>
              <input type="password" value={pw} onChange={e => setPw(e.target.value)}/>
            </div>
          </div>

          <button type="submit" className="login-submit">Sign in <IconChevronRight size={14}/></button>

          <div className="login-sso">or continue with</div>
          <div className="login-sso-btns">
            <button type="button" className="login-sso-btn" onClick={onLogin}>
              <svg width="14" height="14" viewBox="0 0 48 48"><path fill="#4285f4" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.7 2.5 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6C12.3 13 17.7 9.5 24 9.5z"/><path fill="#34a853" d="M46.1 24.6c0-1.7-.2-3.3-.5-4.9H24v9.3h12.4c-.5 2.9-2.1 5.4-4.5 7v5.8h7.3c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#fbbc05" d="M10.4 28.8a14.5 14.5 0 0 1 0-9.6l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.6 2.6 10.8l7.8-6z"/><path fill="#ea4335" d="M24 48c6.5 0 11.9-2.2 15.9-5.8l-7.3-5.8c-2 1.4-4.6 2.2-8.6 2.2-6.3 0-11.7-3.5-13.7-10.6l-7.8 6C6.5 42.6 14.6 48 24 48z"/></svg>
              Google
            </button>
            <button type="button" className="login-sso-btn" onClick={onLogin}>
              <svg width="14" height="14" viewBox="0 0 24 24"><path fill="#00A4EF" d="M11 11H2V2h9z"/><path fill="#00A4EF" d="M22 11h-9V2h9z"/><path fill="#00A4EF" d="M11 22H2v-9h9z"/><path fill="#00A4EF" d="M22 22h-9v-9h9z"/></svg>
              Microsoft
            </button>
          </div>

          <div className="login-footer">
            Need access? <a href="#">Ping #qa-tooling</a>
          </div>
        </form>
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════
// Settings
// ════════════════════════════════════════════════════════════
const SettingsScreen = () => {
  const [tab, setTab] = React.useState('integrations');
  return (
    <div className="settings">
      <nav className="settings-nav">
        {[
          ['profile','Profile'],
          ['integrations','Integrations'],
          ['agents','Agents & models'],
          ['environments','Environments'],
          ['runners','Runners'],
          ['notifications','Notifications'],
        ].map(([k,l]) => (
          <button key={k} className={`settings-nav-item ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </nav>
      <div className="settings-content">
        <div className="settings-header">
          <h1>{tab === 'integrations' ? 'Integrations' : tab === 'profile' ? 'Profile' : tab === 'agents' ? 'Agents & models' : tab === 'environments' ? 'Environments' : tab === 'runners' ? 'Runners' : 'Notifications'}</h1>
          <p>{tab === 'integrations' ? 'Systems GoHybrid reads tickets from and writes reports back to.' : tab === 'profile' ? 'Your account and preferences within the workspace.' : tab === 'agents' ? 'Tune which agents drive each phase of the pipeline.' : tab === 'environments' ? 'Target URLs and credentials used during execution.' : tab === 'runners' ? 'Parallel execution capacity across browsers.' : 'Choose when and where GoHybrid pings you.'}</p>
        </div>

        {tab === 'profile' && <ProfilePanel/>}
        {tab === 'integrations' && <IntegrationsPanel/>}
        {tab === 'agents' && <AgentsPanel/>}
        {tab === 'environments' && <EnvironmentsPanel/>}
        {tab === 'runners' && <RunnersPanel/>}
        {tab === 'notifications' && <NotificationsPanel/>}
      </div>
    </div>
  );
};

const ToggleField = ({ label, hint, defaultOn }) => {
  const [on, setOn] = React.useState(!!defaultOn);
  return (
    <div className="field-row">
      <div className="label-col">
        <div className="label">{label}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
      <button type="button" className={`toggle ${on?'on':''}`} onClick={()=>setOn(!on)}/>
    </div>
  );
};

const ProfilePanel = () => (
  <>
    <div className="settings-section">
      <h2>Account</h2>
      <p className="sub">Used across every session and report.</p>
      <div className="field-row">
        <div className="label-col"><div className="label">Name</div></div>
        <input type="text" defaultValue="GoHybrid AI"/>
      </div>
      <div className="field-row">
        <div className="label-col"><div className="label">Email</div><div className="hint">SSO-managed, read-only.</div></div>
        <input type="email" defaultValue="gohybrid@ai.com" readOnly/>
      </div>
      <div className="field-row">
        <div className="label-col"><div className="label">Default project</div></div>
        <input type="text" defaultValue="ATT — Attendance & HR"/>
      </div>
    </div>
    <div className="settings-section">
      <h2>Preferences</h2>
      <ToggleField label="Keep chat history indefinitely" hint="Otherwise auto-archive sessions after 30 days." defaultOn/>
      <ToggleField label="Auto-run tests after generation" hint="Kick off Playwright as soon as cases are approved."/>
      <ToggleField label="Daily QA digest" hint="Email summary of my sessions and their status." defaultOn/>
    </div>
  </>
);

const IntegrationsPanel = () => {
  const rows = [
    { n:'Jira Cloud', sub:'gohybrid.atlassian.net', desc:'Reads tickets, writes execution reports as attachments and comments.', on:true },
    { n:'GitHub', sub:'gohybrid/monorepo', desc:'Links failing tests to commits. Opens PRs with regenerated selectors.', on:true },
    { n:'Playwright Cloud', sub:'runner-pool-ap', desc:'Headless browser pool for parallel execution.', on:true },
    { n:'Slack', sub:'#qa-automation', desc:'Posts run summaries and blocker alerts.', on:true },
    { n:'Confluence', sub:'Not connected', desc:'Sync generated test docs into the QA knowledge base.', on:false },
    { n:'Xray', sub:'Not connected', desc:'Report Playwright runs as Xray test executions.', on:false },
  ];
  return rows.map(r => (
    <div className="settings-section" key={r.n}>
      <h2>{r.n} {r.on && <span className="conn-pill"><span className="dot"/>Connected</span>}</h2>
      <p className="sub">{r.desc}</p>
      <div className="field-row">
        <div className="label-col">
          <div className="label">{r.on ? 'Workspace' : 'Status'}</div>
          <div className="hint">{r.sub}</div>
        </div>
        <div style={{justifySelf:'end', display:'flex', gap:6}}>
          <button className="btn sm">{r.on ? 'Manage' : 'Connect'}</button>
          {r.on && <button className="btn sm ghost danger">Disconnect</button>}
        </div>
      </div>
    </div>
  ));
};

const AgentsPanel = () => {
  const agents = [
    { n:'Scenario Agent', m:'gohybrid-reasoning-3 · 128k', d:'Generates happy-path, negative, edge, and regression scenarios from a ticket.', t:0.4 },
    { n:'Explorer Agent', m:'gohybrid-browser-1', d:'Navigates the staging app and discovers stable selectors.', t:0.1 },
    { n:'TestCase Agent', m:'gohybrid-codegen-2', d:'Emits Gherkin feature files and Playwright scripts.', t:0.2 },
    { n:'Healer Agent', m:'gohybrid-browser-1', d:'Rewrites broken selectors mid-run using the DOM snapshot.', t:0.0 },
  ];
  return (
    <>
      {agents.map(a => (
        <div className="settings-section" key={a.n}>
          <h2>{a.n}</h2>
          <p className="sub">{a.d}</p>
          <div className="field-row">
            <div className="label-col"><div className="label">Model</div></div>
            <input type="text" defaultValue={a.m}/>
          </div>
          <div className="field-row">
            <div className="label-col"><div className="label">Temperature</div><div className="hint">Higher values produce more diverse outputs.</div></div>
            <input type="text" defaultValue={a.t.toFixed(2)}/>
          </div>
        </div>
      ))}
    </>
  );
};

const EnvironmentsPanel = () => (
  <div className="settings-section">
    <h2>Configured environments</h2>
    <p className="sub">Tests can be pinned to any of these at run time.</p>
    {[
      { n:'staging', u:'staging.gohybrid.vn', a:'SSO (Azure)', s:'healthy' },
      { n:'staging-hr', u:'hr.staging.gohybrid.vn', a:'Service account', s:'healthy' },
      { n:'sandbox', u:'sandbox.gohybrid.vn', a:'Basic auth', s:'degraded' },
    ].map(e => (
      <div className="field-row" key={e.n}>
        <div className="label-col">
          <div className="label">{e.n}</div>
          <div className="hint">{e.u} · {e.a}</div>
        </div>
        <div style={{justifySelf:'end', display:'flex', gap:8, alignItems:'center'}}>
          <span className="pill" style={{color: e.s==='healthy' ? 'var(--pass)' : 'var(--fault)'}}>{e.s}</span>
          <button className="btn sm">Edit</button>
        </div>
      </div>
    ))}
    <div style={{marginTop:16}}><button className="btn sm"><IconPlus size={12}/> Add environment</button></div>
  </div>
);

const RunnersPanel = () => (
  <div className="settings-section">
    <h2>Runner pool</h2>
    <p className="sub">8 of 12 workers idle · autoscaling enabled.</p>
    {[
      { n:'chromium-ap-1', busy:3, cap:4, br:'Chromium 124' },
      { n:'chromium-ap-2', busy:1, cap:4, br:'Chromium 124' },
      { n:'webkit-ap-1', busy:0, cap:2, br:'WebKit 17.4' },
      { n:'firefox-ap-1', busy:0, cap:2, br:'Firefox 125' },
    ].map(r => (
      <div className="field-row" key={r.n}>
        <div className="label-col">
          <div className="label">{r.n}</div>
          <div className="hint">{r.br} · {r.busy}/{r.cap} workers</div>
        </div>
        <div style={{justifySelf:'end', width:120, display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4}}>
          <span className="pill" style={{color: r.busy ? 'var(--fault)' : 'var(--pass)'}}>{r.busy ? 'busy' : 'idle'}</span>
          <div style={{width:'100%', height:3, background:'var(--bg-2)', borderRadius:99, overflow:'hidden'}}>
            <div style={{width:`${(r.busy/r.cap)*100}%`, height:'100%', background:'var(--aura-gradient)'}}/>
          </div>
        </div>
      </div>
    ))}
  </div>
);

const NotificationsPanel = () => (
  <div className="settings-section">
    <h2>Notifications</h2>
    <ToggleField label="A run I started finishes" defaultOn/>
    <ToggleField label="A regression suite fails" defaultOn/>
    <ToggleField label="Selector healing succeeds"/>
    <ToggleField label="Someone @mentions me in a session" defaultOn/>
    <ToggleField label="Weekly QA digest" hint="Every Monday 9:00 ICT" defaultOn/>
  </div>
);

// ════════════════════════════════════════════════════════════
// Pipeline dashboard
// ════════════════════════════════════════════════════════════
const PipelineScreen = () => {
  const phases = [
    { k:'ticket', label:'Ticket', state:'done', meta:'0.4s' },
    { k:'scenarios', label:'Scenarios', state:'done', meta:'1.8s' },
    { k:'explore', label:'Explore', state:'done', meta:'11.2s' },
    { k:'generate', label:'Generate', state:'done', meta:'3.1s' },
    { k:'run', label:'Run', state:'current', meta:'13.1s' },
    { k:'report', label:'Report', state:'', meta:'—' },
  ];
  return (
    <div className="pipeline">
      <div className="pipeline-hero">
        <div className="eyebrow">Session · ATT-22 · iteration 3</div>
        <h1>Leave application fails when end date equals start date</h1>
        <p className="sub">Autonomous pipeline running end-to-end on <code>staging.gohybrid.vn</code>. 3 passed, 1 failed, 1 selector self-healed.</p>
        <div className="pipeline-hero-row">
          <div className="pipeline-hero-stat"><div className="n">5/6</div><div className="l">Phases complete</div></div>
          <div className="pipeline-hero-stat"><div className="n">29.6s</div><div className="l">Elapsed</div></div>
          <div className="pipeline-hero-stat"><div className="n">4</div><div className="l">Tests</div></div>
          <div className="pipeline-hero-stat"><div className="n">87%</div><div className="l">Flow coverage</div></div>
          <div style={{marginLeft:'auto', display:'flex', gap:8}}>
            <button className="btn"><IconRefresh size={12}/> Restart</button>
            <button className="btn primary">Push report to Jira</button>
          </div>
        </div>
      </div>

      <div className="timeline-card">
        <div className="timeline-card-head">
          <h3>Pipeline timeline</h3>
          <div className="meta">auto · 4-step agent chain</div>
        </div>
        <div className="timeline">
          {phases.map((p, i) => (
            <div key={p.k} className={`tl-phase ${p.state}`}>
              <div className="tl-phase-node">{p.state === 'done' ? <IconCheck size={13}/> : i+1}</div>
              {i < phases.length - 1 && <div className="tl-phase-bar"/>}
              <div className="tl-phase-label">{p.label}</div>
              <div className="tl-phase-meta">{p.meta}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="pipe-grid">
        <div className="detail-card">
          <h3>Live execution</h3>
          <div className="log-console" style={{height:220}}>
            {MOCK_LOG_LINES.map((l,i) => (
              <span className={`log-line ${l.c}`} key={i}><span className="ts">{l.t}</span>{l.l}</span>
            ))}
          </div>
        </div>
        <div className="detail-card">
          <h3>Detected stack</h3>
          <div className="big">React + Vite · Playwright 1.42</div>
          <div className="tech-tags" style={{marginBottom:16}}>
            <span className="tech-tag primary">React 18 <span className="pct">confident</span></span>
            <span className="tech-tag">TypeScript</span>
            <span className="tech-tag">Redux Toolkit</span>
            <span className="tech-tag">Tailwind</span>
            <span className="tech-tag">MSW</span>
          </div>
          <h3>Artifacts</h3>
          {[
            { n:'att-22.feature', s:'2.1 KB' },
            { n:'leave.spec.ts', s:'6.8 KB' },
            { n:'trace-TC-003.zip', s:'412 KB' },
            { n:'run-summary.json', s:'3.4 KB' },
          ].map(a => (
            <div className="miniline" key={a.n}>
              <span className="k">{a.n}</span>
              <span className="v">{a.s}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════
// Test Explorer
// ════════════════════════════════════════════════════════════
const ExplorerScreen = () => {
  const [sel, setSel] = React.useState('pw-3');
  const all = [...EXPLORER_TESTS.playwright, ...EXPLORER_TESTS.api, ...EXPLORER_TESTS.regression];
  const active = all.find(t => t.id === sel) || all[0];

  return (
    <div className="explorer">
      <div className="exp-side">
        <div className="exp-search">
          <IconSearch size={14} style={{color:'var(--fg-3)', marginLeft:4}}/>
          <input placeholder="Filter tests…"/>
        </div>
        <div className="exp-tree">
          {[
            ['playwright','UI · Playwright', EXPLORER_TESTS.playwright],
            ['api','API suite', EXPLORER_TESTS.api],
            ['regression','Regression', EXPLORER_TESTS.regression],
          ].map(([k, label, items]) => (
            <div className="exp-group open" key={k}>
              <div className="exp-group-hdr">
                <IconChevronRight size={10} className="chevron"/>
                <span>{label}</span>
                <span className="count">{items.length}</span>
              </div>
              {items.map(t => (
                <div key={t.id} className={`exp-test ${sel === t.id ? 'active' : ''}`} onClick={() => setSel(t.id)}>
                  <span className={`exp-test-dot ${t.status}`}/>
                  <span className="name">{t.name}</span>
                  <span className="time">{t.time}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="exp-main">
        <div className="exp-tabs">
          <div className="exp-tab active">Script<span className="count">1</span></div>
          <div className="exp-tab">Steps<span className="count">7</span></div>
          <div className="exp-tab">Gherkin</div>
          <div className="exp-tab">Trace</div>
          <div className="exp-tab">History<span className="count">48h</span></div>
          <div style={{marginLeft:'auto', display:'flex', alignItems:'center', gap:8, paddingRight:16}}>
            <button className="btn sm"><IconPlay size={12}/> Run</button>
          </div>
        </div>
        <div className="exp-detail">
          <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:4}}>
            <div>
              <div style={{fontSize:11, fontFamily:'var(--font-mono)', color:'var(--fg-3)', marginBottom:4}}>{active.tag} · {active.id}</div>
              <h2>{active.name}</h2>
            </div>
            <span className={`res-badge ${active.status}`} style={{marginTop:6}}>{active.status.toUpperCase()}</span>
          </div>
          <div className="exp-detail-meta">
            <span><IconActivity size={11}/> last run {active.time}</span>
            <span><IconGitBranch size={11}/> main · 8d2f1a</span>
            <span><IconZap size={11}/> chromium-ap-1</span>
          </div>

          <div className="section-title">Playwright script</div>
          <div className="code-block">
            <div className="code-block-head">
              <span className="file">tests/att-22/weekend-boundary.spec.ts</span>
              <span style={{marginLeft:'auto'}}>TypeScript</span>
            </div>
            <div className="code-block-body"><pre style={{margin:0}}>
{`import { test, expect } from '@playwright/test';

test('${active.name}', async ({ page }) => {
  await page.goto('/leave/new');
  await page.fill('input[name="startDate"]', '2026-04-25'); // Saturday
  await page.fill('input[name="endDate"]',   '2026-04-25');
  await page.fill('textarea[name="reason"]', 'Personal');
  await page.click('button[data-action="submit-leave"]');

  await expect(page.getByTestId('leave-balance')).toHaveText('23');
  await expect(page.getByRole('status')).toContainText('Leave submitted');
});`}
            </pre></div>
          </div>

          <div className="section-title">Step trace</div>
          <div className="step-table">
            {[
              { i:1, a:'goto', t:'/leave/new', v:'', s:'210ms' },
              { i:2, a:'fill', t:'input[name="startDate"]', v:'2026-04-25', s:'48ms' },
              { i:3, a:'fill', t:'input[name="endDate"]', v:'2026-04-25', s:'41ms' },
              { i:4, a:'fill', t:'textarea[name="reason"]', v:'"Personal"', s:'39ms' },
              { i:5, a:'click', t:'button[data-action="submit-leave"]', v:'', s:'312ms' },
              { i:6, a:'expect', t:'getByTestId("leave-balance")', v:'toHaveText("23")', s:'fail 1944ms', fail:true },
            ].map(r => (
              <div className="step-row" key={r.i}>
                <span className="i">{r.i}</span>
                <span className="action">{r.a}</span>
                <span className="target"><code>{r.t}</code></span>
                <span className="val">{r.v}</span>
                <span className={`stat ${r.fail ? 'fail' : ''}`}>{r.s}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { LoginScreen, SettingsScreen, PipelineScreen, ExplorerScreen });
