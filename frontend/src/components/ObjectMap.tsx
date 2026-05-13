import React, { useEffect, useMemo, useState } from 'react';
import {
    AlertCircle,
    BarChart,
    CheckCircle2,
    Cpu,
    DollarSign,
    Eye,
    Globe,
    Key,
    Layers,
    PlayCircle,
    RefreshCcw,
    Save,
    Search,
    ShieldAlert,
    Upload,
    User,
    UserCircle,
} from 'lucide-react';

interface UIElement {
    id: string;
    page: string;
    elementName: string;
    selector: string;
    type: string;
    confidence: number;
    businessLogicHint?: string;
    relatedModule?: string;
    discoveredAt: string;
}

interface UsageSummary {
    totalTokens: number;
    totalCost: number;
}

type DiscoveryMode = 'live-readonly' | 'test-create';

interface DiscoveryForm {
    baseUrl: string;
    customerId: string;
    idNumber: string;
    username: string;
    password: string;
    aiModel: string;
    deepCrawl: boolean;
    maxDepth: number;
    mode: DiscoveryMode;
}

interface DiscoveryPreflightResult {
    success: boolean;
    loginUrl: string;
    landingUrl?: string;
    message: string;
}

interface DiscoveryRun {
    id: string;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'paused';
    startedAt: string;
    completedAt?: string;
    config: Omit<DiscoveryForm, 'password'>;
    pagesDiscovered: number;
    elementsExtracted: number;
    latestError?: string;
    hasCheckpoint?: boolean;
    latestScreenshotPath?: string;
    events: Array<{ timestamp: string; level: 'info' | 'warn' | 'error'; message: string }>;
}

interface SavedProfile extends DiscoveryForm {
    id: string;
    name: string;
}

interface ApiEnvelope<T> {
    data: T;
}

const PROFILE_STORAGE_KEY = 'gohybrid.discovery.profiles';
const emptyForm: DiscoveryForm = {
    baseUrl: '',
    customerId: '',
    idNumber: '',
    username: '',
    password: '',
    aiModel: '',
    deepCrawl: false,
    maxDepth: 1,
    mode: 'live-readonly',
};

function loadProfiles(): SavedProfile[] {
    try {
        const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function maskSecret(value: string): string {
    if (!value) return 'not saved';
    if (value.length <= 2) return '*'.repeat(value.length);
    return `${value[0]}${'*'.repeat(Math.max(2, value.length - 2))}${value[value.length - 1]}`;
}

function unwrapData<T>(payload: T | ApiEnvelope<T>): T {
    if (payload && typeof payload === 'object' && 'data' in (payload as ApiEnvelope<T>)) {
        return (payload as ApiEnvelope<T>).data;
    }
    return payload as T;
}

export const ObjectMap: React.FC<{ apiUrl: string }> = ({ apiUrl }) => {
    const [elements, setElements] = useState<UIElement[]>([]);
    const [usage, setUsage] = useState<UsageSummary>({ totalTokens: 0, totalCost: 0 });
    const [models, setModels] = useState<string[]>([]);
    const [cloudFallbackEnabled, setCloudFallbackEnabled] = useState(false);
    const [runs, setRuns] = useState<DiscoveryRun[]>([]);
    const [profiles, setProfiles] = useState<SavedProfile[]>([]);
    const [selectedProfileId, setSelectedProfileId] = useState('new');
    const [profileName, setProfileName] = useState('');
    const [form, setForm] = useState<DiscoveryForm>(emptyForm);
    const [preflight, setPreflight] = useState<{ status: 'idle' | 'checking' | 'passed' | 'failed'; result?: DiscoveryPreflightResult }>({ status: 'idle' });
    const [filter, setFilter] = useState('');
    const [loading, setLoading] = useState(false);
    const [starting, setStarting] = useState(false);

    const latestRun = runs[0];

    const fetchData = async () => {
        setLoading(true);
        try {
            const [repoRes, usageRes, modelsRes, runsRes] = await Promise.all([
                fetch(`${apiUrl}/api/object-repo`),
                fetch(`${apiUrl}/api/usage/summary`),
                fetch(`${apiUrl}/api/crawler/models`),
                fetch(`${apiUrl}/api/crawler/runs`),
            ]);

            if (repoRes.ok) {
                const data = await repoRes.json();
                setElements(Array.isArray(data) ? data : []);
            }
            if (usageRes.ok) {
                const data = await usageRes.json();
                if (data && typeof data === 'object') setUsage(data);
            }
            if (modelsRes.ok) {
                const payload = unwrapData(await modelsRes.json()) as { models?: string[]; cloudFallbackEnabled?: boolean };
                const nextModels = Array.isArray(payload.models) ? payload.models : [];
                setModels(nextModels);
                setCloudFallbackEnabled(Boolean(payload.cloudFallbackEnabled));
                setForm(current => ({ ...current, aiModel: current.aiModel || nextModels[0] || '' }));
            }
            if (runsRes.ok) {
                const data = unwrapData(await runsRes.json());
                setRuns(Array.isArray(data) ? data : []);
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        setProfiles(loadProfiles());
        fetchData();
    }, []);

    useEffect(() => {
        const hasActiveRun = Array.isArray(runs) && runs.some(run => run.status === 'queued' || run.status === 'running');
        if (!hasActiveRun) return;

        const id = window.setInterval(() => {
            fetch(`${apiUrl}/api/crawler/runs`)
                .then(r => r.ok ? r.json() : Promise.reject())
                .then(p => unwrapData(p))
                .then(p => setRuns(Array.isArray(p) ? p : []))
                .catch(() => undefined);
            fetch(`${apiUrl}/api/object-repo`)
                .then(r => r.ok ? r.json() : Promise.reject())
                .then(p => setElements(Array.isArray(p) ? p : []))
                .catch(() => undefined);
            fetch(`${apiUrl}/api/usage/summary`)
                .then(r => r.ok ? r.json() : Promise.reject())
                .then(p => { if (p && typeof p === 'object') setUsage(p); })
                .catch(() => undefined);
        }, 5000);
        return () => window.clearInterval(id);
    }, [apiUrl, runs.length > 0 && latestRun?.status]);

    useEffect(() => {
        setPreflight(current => current.status === 'idle' ? current : { status: 'idle' });
    }, [form.baseUrl, form.customerId, form.idNumber, form.username, form.password, form.aiModel, form.deepCrawl, form.mode]);

    const filtered = useMemo(() => (Array.isArray(elements) ? elements : []).filter(element =>
        element.page.toLowerCase().includes(filter.toLowerCase()) ||
        element.elementName.toLowerCase().includes(filter.toLowerCase()) ||
        element.selector.toLowerCase().includes(filter.toLowerCase())
    ), [elements, filter]);

    const updateForm = (patch: Partial<DiscoveryForm>) => setForm(current => ({ ...current, ...patch }));

    const applyProfile = (profileId: string) => {
        setSelectedProfileId(profileId);
        if (profileId === 'new') {
            setForm(current => ({ ...emptyForm, aiModel: current.aiModel || models[0] || '' }));
            return;
        }
        const profile = profiles.find(item => item.id === profileId);
        if (profile) {
            setProfileName(profile.name);
            setForm(profile);
        }
    };

    const saveProfile = () => {
        if (!profileName.trim()) {
            window.alert('Enter a profile name first.');
            return;
        }
        const nextProfile: SavedProfile = { id: selectedProfileId === 'new' ? `${Date.now()}` : selectedProfileId, name: profileName.trim(), ...form };
        const nextProfiles = [...profiles.filter(item => item.id !== nextProfile.id), nextProfile].sort((a, b) => a.name.localeCompare(b.name));
        localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(nextProfiles));
        setProfiles(nextProfiles);
        setSelectedProfileId(nextProfile.id);
    };

    const runPreflight = async () => {
        setPreflight({ status: 'checking' });
        const response = await fetch(`${apiUrl}/api/crawler/preflight`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form),
        });
        const payload = await response.json();
        const result = response.ok ? unwrapData(payload) : payload.error?.details || payload.error || payload;
        setPreflight({ status: response.ok ? 'passed' : 'failed', result });
    };

    const startDiscovery = async (resumeRunId?: string) => {
        if (preflight.status !== 'passed' && !resumeRunId) {
            window.alert('Run preflight successfully before starting discovery.');
            return;
        }
        setStarting(true);
        try {
            const response = await fetch(`${apiUrl}/api/crawler/discover`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...form, resumeRunId }),
            });
            const payload = await response.json();
            const result = response.ok ? unwrapData(payload) : payload.error;
            if (!response.ok) throw new Error(result?.message || 'Failed to start discovery');
            await fetchData();
            window.alert(resumeRunId ? `Discovery resumed. Run ID: ${result.runId}` : `Discovery started. Run ID: ${result.runId}`);
        } finally {
            setStarting(false);
        }
    };

    const handleDownloadCSV = () => {
        if (elements.length === 0) return;
        const headers = ["Page", "Element Name", "Type", "Selector", "Confidence", "Discovered At"];
        const rows = elements.map(el => [
            el.page,
            el.elementName,
            el.type,
            el.selector.replace(/"/g, '""'),
            el.confidence.toString(),
            el.discoveredAt
        ]);

        const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `discovered-elements-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleHarvesterUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        setLoading(true);
        try {
            const response = await fetch(`${apiUrl}/api/crawler/import-harvester`, {
                method: 'POST',
                body: formData,
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Import failed');
            await fetchData();
            window.alert(payload.message);
        } catch (err: any) {
            window.alert(`Error: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="card"><BarChart size={20} /><div><small>Total Tokens</small><strong>{(usage.totalTokens ?? 0).toLocaleString()}</strong></div></div>
                <div className="card"><DollarSign size={20} /><div><small>Estimated Cost</small><strong>${(usage.totalCost ?? 0).toFixed(4)}</strong></div></div>
                <div className="card"><Eye size={20} /><div><small>Discovered Objects</small><strong>{elements.length}</strong></div></div>
            </div>

            <div className="banner">
                <ShieldAlert size={18} />
                <span>{form.mode === 'live-readonly' ? 'Live readonly mode: navigation and inspection only. No save/delete/submit actions are allowed.' : 'Test create mode: use only approved test accounts and safe test data.'}</span>
                <span className="ml-auto opacity-70">Target Depth: <strong>{form.maxDepth}</strong></span>
            </div>

            <div className="layout">
                <section className="panel">
                    <div className="panel-head">
                        <div>
                            <h3>Discovery Control</h3>
                            <p>Enter credentials, verify login, then start the background crawl.</p>
                        </div>
                        <button className="secondary" onClick={fetchData} disabled={loading}><RefreshCcw size={16} className={loading ? 'spin' : ''} /> Refresh</button>
                    </div>

                    <div className="profile-row">
                        <div className="field">
                            <label><UserCircle size={14} /> Saved profile</label>
                            <select value={selectedProfileId} onChange={event => applyProfile(event.target.value)}>
                                <option value="new">Current form only</option>
                                {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                            </select>
                        </div>
                        <div className="field">
                            <label><Save size={14} /> Profile name</label>
                            <input value={profileName} onChange={event => setProfileName(event.target.value)} placeholder="Live HR Admin" />
                        </div>
                        <button className="secondary" onClick={saveProfile}><Save size={16} /> Save profile</button>
                    </div>

                    <div className="note">Saved profiles stay in this browser only. Passwords are masked in the UI but stored locally if you save a profile.</div>

                    <div className="grid">
                        <div className="field"><label><Globe size={14} /> Base URL</label><input value={form.baseUrl} onChange={event => updateForm({ baseUrl: event.target.value })} placeholder="https://www.globalhr.app" /></div>
                        <div className="field"><label><Key size={14} /> Customer shortcode</label><input value={form.customerId} onChange={event => updateForm({ customerId: event.target.value })} placeholder="abcd" /></div>
                        <div className="field"><label><User size={14} /> ID number</label><input value={form.idNumber} onChange={event => updateForm({ idNumber: event.target.value })} placeholder="kmtcd-206" /></div>
                        <div className="field"><label><User size={14} /> Username</label><input value={form.username} onChange={event => updateForm({ username: event.target.value })} placeholder="ursa" /></div>
                        <div className="field"><label><Key size={14} /> Password</label><input type="password" value={form.password} onChange={event => updateForm({ password: event.target.value })} placeholder="********" /></div>
                        <div className="field"><label><Cpu size={14} /> Local AI model</label><select value={form.aiModel} onChange={event => updateForm({ aiModel: event.target.value })}>{models.map(model => <option key={model} value={model}>{model}</option>)}</select></div>
                        <div className="field"><label><ShieldAlert size={14} /> Run mode</label><select value={form.mode} onChange={event => updateForm({ mode: event.target.value as DiscoveryMode })}><option value="live-readonly">live-readonly</option><option value="test-create">test-create</option></select></div>
                        <div className="field"><label><Layers size={14} /> Crawl Depth</label><select value={form.maxDepth} onChange={event => updateForm({ maxDepth: Number(event.target.value) })}><option value={1}>1 (Menus only)</option><option value={2}>2 (Sub-pages)</option><option value={3}>3 (Deep Recursion)</option></select></div>
                        <label className="toggle"><span><Layers size={14} /> Deep crawl</span><input type="checkbox" checked={form.deepCrawl} onChange={event => updateForm({ deepCrawl: event.target.checked })} /></label>
                    </div>

                    <div className="note">Model policy: selector analysis uses local Ollama models from the backend. Cloud fallback is {cloudFallbackEnabled ? 'enabled' : 'disabled'}.</div>

                    <div className="actions">
                        <button className="secondary" onClick={runPreflight} disabled={preflight.status === 'checking'}><PlayCircle size={16} /> {preflight.status === 'checking' ? 'Checking...' : 'Run preflight'}</button>
                        <div className="flex gap-2">
                            <button className="primary flex-1" onClick={() => startDiscovery()} disabled={starting || preflight.status !== 'passed'}><Eye size={16} /> {starting ? 'Starting...' : 'Start discovery'}</button>
                            {latestRun?.hasCheckpoint && (latestRun.status === 'paused' || latestRun.status === 'failed') && (
                                <button className="secondary" title="Resume from checkpoint" onClick={() => startDiscovery(latestRun.id)} disabled={starting}>
                                    <RefreshCcw size={16} className={starting ? 'spin' : ''} /> Resume
                                </button>
                            )}
                        </div>
                    </div>

                    <div className={`preflight ${preflight.status}`}>
                        <div className="preflight-title">{preflight.status === 'passed' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />} Preflight status</div>
                        <div>{preflight.result ? preflight.result.message : 'Run preflight to verify the URL, credentials, and landing page.'}</div>
                        {preflight.result?.loginUrl && <code>{preflight.result.loginUrl}</code>}
                        {preflight.result?.landingUrl && <code>{preflight.result.landingUrl}</code>}
                    </div>
                </section>

                <section className="panel">
                    <div className="panel-head"><div><h3>Run Status</h3><p>Latest background crawler state and profile overview.</p></div></div>
                    {latestRun ? (
                        <div className="run-card">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                <div className={`pill ${latestRun.status}`}>{latestRun.status}</div>
                                {latestRun.status === 'running' && <div className="live-indicator"><span className="pulse"></span> LIVE</div>}
                            </div>
                            
                            {latestRun.latestScreenshotPath && (
                                <div className="live-screenshot">
                                    <div className="label">LATEST DISCOVERY SNAPSHOT</div>
                                    <img 
                                        src={`${apiUrl}/api/crawler/screenshot/${latestRun.id}/${latestRun.latestScreenshotPath.split(/[\\/]/).pop()}`} 
                                        alt="Live Crawl Feed"
                                        style={{ width: '100%', borderRadius: '8px', marginTop: '8px', border: '1px solid var(--border-glass)' }}
                                    />
                                </div>
                            )}

                            <div className="run-meta" style={{ marginTop: '1rem' }}>
                                <span>Started: {new Date(latestRun.startedAt).toLocaleString()}</span>
                                <span>Mode: {latestRun.config.mode}</span>
                                <span>Model: {latestRun.config.aiModel}</span>
                                <span>Pages: {latestRun.pagesDiscovered}</span>
                                <span>Elements: {latestRun.elementsExtracted}</span>
                            </div>
                            {latestRun.latestError && <div className="error-box">{latestRun.latestError}</div>}
                            {(latestRun.events || []).slice(-5).reverse().map((event, index) => (
                                <div key={`${latestRun.id}-${index}`} className={`event ${event.level}`}>
                                    <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
                                    <span>{event.message}</span>
                                </div>
                            ))}
                        </div>
                    ) : <div className="note">No discovery runs yet.</div>}

                    <div className="saved">
                        <h4>Saved profiles</h4>
                        {profiles.length === 0 ? <div className="note">No saved profiles yet.</div> : profiles.map(profile => (
                            <div key={profile.id} className="profile-card">
                                <strong>{profile.name}</strong>
                                <span>{profile.baseUrl}/{profile.customerId}</span>
                                <span>{profile.username} / {profile.idNumber}</span>
                                <span>Password: {maskSecret(profile.password)}</span>
                            </div>
                        ))}
                    </div>
                </section>
            </div>

            <div className="toolbar">
                <div className="search"><Search size={16} /><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter by page, element, or selector..." /></div>
                <div className="ml-auto flex gap-2">
                    <label className="secondary cursor-pointer">
                        <Upload size={16} /> Import Harvester
                        <input type="file" accept=".html" className="hidden" onChange={handleHarvesterUpload} />
                    </label>
                    <button className="secondary" onClick={handleDownloadCSV} disabled={elements.length === 0}><Save size={16} /> Export CSV</button>
                </div>
            </div>

            <div className="table-wrap">
                <table>
                    <thead><tr><th>Object Name</th><th>Module Context</th><th>Page</th><th>Selector</th><th>Logic Hint</th><th>Confidence</th></tr></thead>
                    <tbody>
                        {filtered.length === 0 ? <tr><td colSpan={6} className="empty">No elements discovered yet. Start a discovery run after preflight succeeds.</td></tr> : filtered.map(element => (
                            <tr key={element.id}>
                                <td>
                                    <div className="font-semibold">{element.elementName}</div>
                                    <div className="text-[10px] opacity-50 uppercase tracking-tighter">{element.type}</div>
                                </td>
                                <td>
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${element.relatedModule === 'Payroll' ? 'bg-emerald-900/30 text-emerald-400' :
                                        element.relatedModule === 'Leave' ? 'bg-blue-900/30 text-blue-400' :
                                            'bg-slate-800 text-slate-400'
                                        }`}>
                                        {element.relatedModule || 'Generic'}
                                    </span>
                                </td>
                                <td>{element.page.split('/').pop()?.replace('#', '') || '/'}</td>
                                <td><code>{element.selector}</code></td>
                                <td className="text-xs italic text-slate-400 max-w-[200px] truncate" title={element.businessLogicHint}>
                                    {element.businessLogicHint || '-'}
                                </td>
                                <td>
                                    <div className="flex items-center gap-2">
                                        <div className="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                            <div className="h-full bg-blue-500" style={{ width: `${element.confidence}%` }}></div>
                                        </div>
                                        <span className="text-[10px]">{element.confidence}%</span>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <style>{`
                .object-map { display: flex; flex-direction: column; gap: 20px; padding: 24px; }
                .stats, .layout, .grid, .profile-row, .actions, .run-meta { display: grid; gap: 14px; }
                .stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
                .layout { grid-template-columns: minmax(0, 2fr) minmax(320px, 1fr); }
                .card, .panel, .toolbar, .table-wrap, .banner { background: #1e293b; border: 1px solid #334155; border-radius: 14px; }
                .card { display: flex; align-items: center; gap: 12px; padding: 18px; color: #f8fafc; }
                .card small, .panel p, .note, .event, .profile-card span { color: #94a3b8; }
                .card strong { display: block; font-size: 1.35rem; }
                .banner, .panel, .toolbar { padding: 16px; }
                .panel { display: flex; flex-direction: column; gap: 14px; }
                .panel-head { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
                .panel h3, .saved h4 { margin: 0; color: #f8fafc; }
                .profile-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; align-items: end; }
                .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                .field, .toggle { display: flex; flex-direction: column; gap: 6px; }
                .field label, .toggle span { display: flex; align-items: center; gap: 6px; color: #cbd5e1; font-size: 0.82rem; }
                .field input, .field select { background: #0f172a; border: 1px solid #334155; border-radius: 10px; color: #f8fafc; padding: 10px 12px; outline: none; }
                .toggle { justify-content: center; background: #0f172a; border: 1px solid #334155; border-radius: 10px; padding: 12px; color: #f8fafc; }
                .actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                .primary, .secondary { border: none; border-radius: 10px; padding: 10px 14px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; font-weight: 600; }
                .primary { background: linear-gradient(135deg, #0ea5e9, #2563eb); color: white; }
                .secondary { background: #0f172a; border: 1px solid #334155; color: #cbd5e1; }
                .primary:disabled, .secondary:disabled { opacity: 0.6; cursor: not-allowed; }
                .preflight, .run-card, .profile-card { background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 14px; }
                .preflight.passed { border-color: rgba(16, 185, 129, 0.5); }
                .preflight.failed { border-color: rgba(239, 68, 68, 0.5); }
                .preflight-title { display: flex; align-items: center; gap: 8px; color: #f8fafc; margin-bottom: 8px; }
                .preflight code { display: block; margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: #020617; color: #cbd5e1; overflow-wrap: anywhere; }
                .pill { display: inline-flex; width: fit-content; padding: 4px 10px; border-radius: 999px; text-transform: uppercase; font-size: 0.72rem; font-weight: 700; margin-bottom: 10px; }
                .pill.queued { background: rgba(59, 130, 246, 0.15); color: #93c5fd; }
                .pill.running { background: rgba(245, 158, 11, 0.15); color: #fcd34d; }
                .pill.completed { background: rgba(16, 185, 129, 0.15); color: #6ee7b7; }
                .pill.failed { background: rgba(239, 68, 68, 0.15); color: #fca5a5; }
                .run-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); font-size: 0.85rem; margin-bottom: 8px; color: #cbd5e1; }
                .error-box { background: rgba(127, 29, 29, 0.35); border: 1px solid rgba(248, 113, 113, 0.35); color: #fecaca; padding: 10px; border-radius: 10px; margin-bottom: 8px; }
                .event { display: grid; grid-template-columns: 85px 1fr; gap: 8px; font-size: 0.8rem; line-height: 1.4; border-bottom: 1px solid #33415533; padding-bottom: 6px; margin-bottom: 6px; }
                .event span:first-of-type { font-family: monospace; opacity: 0.8; font-size: 0.75rem; }
                .event span:last-of-type { overflow-wrap: break-word; word-break: break-word; color: #cbd5e1; }
                .event:last-child { border-bottom: none; }
                .event.warn { color: #fcd34d; }
                .event.error { color: #fda4af; }
                .saved { display: flex; flex-direction: column; gap: 10px; }
                .profile-card { display: flex; flex-direction: column; gap: 4px; color: #cbd5e1; }
                .toolbar .search { max-width: 380px; display: flex; align-items: center; gap: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 10px; padding: 10px 12px; color: #64748b; }
                .toolbar input { width: 100%; background: transparent; border: none; color: #f8fafc; outline: none; }
                .table-wrap { overflow: hidden; }
                table { width: 100%; border-collapse: collapse; color: #cbd5e1; }
                th, td { text-align: left; padding: 12px 16px; border-bottom: 1px solid #334155; }
                th { background: #334155; color: #f8fafc; }
                td code { display: inline-block; max-width: 520px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .empty { text-align: center; color: #64748b; padding: 48px 16px !important; }
                .spin { animation: spin 1s linear infinite; }
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                
                .live-indicator { display: flex; align-items: center; gap: 6px; color: #f43f5e; font-size: 0.7rem; font-weight: bold; letter-spacing: 1px; }
                .pulse { width: 8px; height: 8px; background: #f43f5e; border-radius: 50%; display: inline-block; animation: pulse-red 2s infinite; }
                @keyframes pulse-red { 
                    0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(244, 63, 94, 0.7); }
                    70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(244, 63, 94, 0); }
                    100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(244, 63, 94, 0); }
                }
                .live-screenshot .label { font-size: 0.65rem; color: #94a3b8; font-weight: bold; margin-bottom: 4px; }

                @media (max-width: 1100px) { .stats, .layout, .grid, .profile-row, .actions, .run-meta { grid-template-columns: 1fr; } }
            `}</style>
        </div>
    );
};
