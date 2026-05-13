import React from 'react';
import { KnowledgeBaseSettings } from './KnowledgeBaseSettings';
import TestUserManager from './TestUserManager';
import { JiraIntegrationSettings } from './JiraIntegrationSettings';
import { ScriptLibraryPanel } from './ScriptLibraryPanel';
import { SprintRegressionPanel } from './SprintRegressionPanel';
import { Cpu, UserCheck, Shield, Sliders, CheckCircle2, Zap, Save, Plus, Trash2, Eye, Code, Globe, AlertTriangle, GitBranch, Monitor, Sparkles } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface UnifiedSettingsProps {
  agentConfig: any;
  providerStatuses: any[];
  onSaveAgent: (role: string, profile: string) => void;
  onPositionChange: (pos: 'left' | 'right') => void;
  sidebarPosition: 'left' | 'right';
}

export const UnifiedSettings: React.FC<UnifiedSettingsProps> = ({
  agentConfig,
  providerStatuses,
  onSaveAgent,
  onPositionChange,
  sidebarPosition
}) => {
  const [customPaths, setCustomPaths] = React.useState<string[]>([]);
  const [mcpServers, setMcpServers] = React.useState<any[]>([]);
  const [isSavingMCP, setIsSavingMCP] = React.useState(false);
  const [discoveryStrategy, setDiscoveryStrategy] = React.useState('hybrid');
  const [sourceCodePath, setSourceCodePath] = React.useState('');
  const [fallbackToExtension, setFallbackToExtension] = React.useState(true);
  const [isSavingDiscovery, setIsSavingDiscovery] = React.useState(false);

  React.useEffect(() => {
    fetchDiscoveryConfig();
    // Fetch initial MCP and Custom Skills data
    Promise.all([
      fetch('/api/mcp/servers'),
      fetch('/api/skills/custom')
    ]).then(async ([mcpRes, skillsRes]) => {
      if (mcpRes.ok) setMcpServers(await mcpRes.json());
    });
  }, []);

  const fetchDiscoveryConfig = async () => {
    try {
      const res = await fetch('/api/settings/discovery');
      if (res.ok) {
        const data = await res.json();
        if (data.config) {
          setDiscoveryStrategy(data.config.strategy || 'hybrid');
          setSourceCodePath(data.config.sourceCodePath || '');
          setFallbackToExtension(data.config.fallbackToExtension !== false);
        }
      }
    } catch (err) {
      console.warn('[Settings] Failed to load discovery config:', err);
    }
  };

  const handleSaveDiscovery = async () => {
    setIsSavingDiscovery(true);
    try {
      const res = await fetch('/api/settings/discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy: discoveryStrategy,
          sourceCodePath: sourceCodePath.trim(),
          fallbackToExtension,
        })
      });
      if (res.ok) {
        const data = await res.json();
        setSourceCodePath(data.config?.sourceCodePath || sourceCodePath);
      }
    } catch (err) {
      console.error('[Settings] Failed to save discovery config:', err);
    } finally {
      setIsSavingDiscovery(false);
    }
  };

  const handleSaveCustomPaths = async () => {
    setIsSavingMCP(true);
    try {
      await fetch('/api/skills/custom/paths', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: customPaths.filter(p => p.trim()) })
      });
      alert('Custom Skill Paths saved successfully!');
    } catch (err) {
      alert('Failed to save skill paths');
    }
    setIsSavingMCP(false);
  };

  const handleSaveMCPServers = async () => {
    setIsSavingMCP(true);
    try {
      await fetch('/api/mcp/servers/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servers: mcpServers.filter(s => s.command && s.name) })
      });
      alert('MCP Servers configured successfully!');
      
      // Refresh status
      const mcpRes = await fetch(`${API_URL}/api/mcp/servers`);
      if (mcpRes.ok) setMcpServers(await mcpRes.json());
      
    } catch (err) {
      alert('Failed to save MCP servers');
    }
    setIsSavingMCP(false);
  };

  return (
    <div className="unified-settings" style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto', height: '100%', overflowY: 'auto' }}>
      <header style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 600, color: 'white', margin: '0 0 8px 0' }}>Settings</h2>
        <p style={{ color: 'var(--text-dim)', margin: 0 }}>Configure your workspace, AI agents, and system preferences.</p>
      </header>

      <div style={{ display: 'grid', gap: '24px' }}>
        {/* Appearance Section */}
        <section className="glass panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <Sliders size={20} style={{ color: 'var(--accent-primary)' }} />
            <h3 style={{ margin: 0, fontSize: '18px' }}>Appearance</h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 500, color: 'white' }}>Sidebar Position</div>
              <div style={{ fontSize: '13px', color: 'var(--text-dim)' }}>Choose where the Activity Bar should appear.</div>
            </div>
            <div style={{ display: 'flex', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '4px', borderRadius: '8px' }}>
              <button 
                onClick={() => onPositionChange('left')}
                style={{
                  padding: '6px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: sidebarPosition === 'left' ? 'var(--accent-primary)' : 'transparent',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '13px',
                  transition: 'all 0.2s'
                }}
              >Left</button>
              <button 
                onClick={() => onPositionChange('right')}
                style={{
                  padding: '6px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: sidebarPosition === 'right' ? 'var(--accent-primary)' : 'transparent',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '13px',
                  transition: 'all 0.2s'
                }}
              >Right</button>
            </div>
          </div>
        </section>

        {/* UI Version Section */}
        <section className="glass panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <Monitor size={20} style={{ color: 'var(--accent-primary)' }} />
            <h3 style={{ margin: 0, fontSize: '18px' }}>UI Version</h3>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '16px' }}>
            Switch between the current stable UI (V1) and the new prototype design (V2).
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {[
              { id: 'v1', label: 'V1 (Current)', desc: 'Stable React + Vite build', icon: Monitor },
              { id: 'v2', label: 'V2 (New Design)', desc: 'Prototype with new UI/UX', icon: Sparkles },
            ].map(opt => (
              <div
                key={opt.id}
                onClick={() => {
                  localStorage.setItem('ui-version', opt.id);
                  window.location.href = opt.id === 'v2' ? '/v2/GoHybrid.html' : '/';
                }}
                style={{
                  padding: '16px',
                  borderRadius: '10px',
                  border: `2px solid ${localStorage.getItem('ui-version') === opt.id || (!localStorage.getItem('ui-version') && opt.id === 'v1') ? 'var(--accent-primary)' : 'var(--border-glass)'}`,
                  background: localStorage.getItem('ui-version') === opt.id || (!localStorage.getItem('ui-version') && opt.id === 'v1') ? 'rgba(45, 212, 191, 0.05)' : 'rgba(0,0,0,0.15)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <opt.icon size={18} style={{ color: 'var(--accent-primary)' }} />
                  <span style={{ fontWeight: 600, fontSize: '14px', color: 'white' }}>{opt.label}</span>
                  {(localStorage.getItem('ui-version') === opt.id || (!localStorage.getItem('ui-version') && opt.id === 'v1')) && (
                    <CheckCircle2 size={14} style={{ color: 'var(--accent-primary)', marginLeft: 'auto' }} />
                  )}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{opt.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Extensions & MCP Section */}
        <section className="glass panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Zap size={20} style={{ color: 'var(--accent-primary)' }} />
              <h3 style={{ margin: 0, fontSize: '18px' }}>Extensions & Skills (MCP)</h3>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            {/* Custom Skill Paths */}
            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '10px' }}>
              <h4 style={{ fontSize: '14px', color: 'var(--text-dim)', marginBottom: '12px' }}>CUSTOM SKILL PATHS</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '16px' }}>
                Add local directories containing .md or .json skills (e.g., C:\Users\...\.claude\skills).
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                {customPaths.map((cp, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '8px' }}>
                    <input 
                      type="text" 
                      value={cp} 
                      onChange={(e) => {
                        const newPaths = [...customPaths];
                        newPaths[idx] = e.target.value;
                        setCustomPaths(newPaths);
                      }}
                      placeholder="C:\path\to\skills" 
                      className="dashboard-input" 
                      style={{ flex: 1, fontSize: '13px' }}
                    />
                    <button 
                      onClick={() => setCustomPaths(customPaths.filter((_, i) => i !== idx))}
                      style={{ background: 'transparent', border: 'none', color: 'var(--accent-rose)', cursor: 'pointer' }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
              
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  onClick={() => setCustomPaths([...customPaths, ''])}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-glass)', padding: '6px 12px', borderRadius: '6px', color: 'white', cursor: 'pointer' }}
                >
                  <Plus size={14} /> Add Path
                </button>
                <button 
                  onClick={handleSaveCustomPaths}
                  disabled={isSavingMCP}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', background: 'var(--accent-primary)', border: 'none', padding: '6px 12px', borderRadius: '6px', color: 'white', cursor: 'pointer' }}
                >
                  <Save size={14} /> Save Paths
                </button>
              </div>
            </div>

            {/* MCP Servers */}
            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '10px' }}>
              <h4 style={{ fontSize: '14px', color: 'var(--text-dim)', marginBottom: '12px' }}>LOCAL MCP SERVERS</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '16px' }}>
                Configure local Model Context Protocol (MCP) tool servers via stdio.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '12px' }}>
                {mcpServers.map((server, idx) => (
                  <div key={idx} style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <input 
                        type="text" 
                        value={server.name} 
                        onChange={(e) => {
                          const newServers = [...mcpServers];
                          newServers[idx].name = e.target.value;
                          setMcpServers(newServers);
                        }}
                        placeholder="Server Name (e.g. SQLite)" 
                        className="dashboard-input" 
                        style={{ width: '45%', fontSize: '13px' }}
                      />
                      <div style={{ fontSize: '12px', color: server.connected ? 'var(--accent-emerald)' : 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {server.connected && <CheckCircle2 size={12} />}
                        {server.connected ? 'Connected' : 'Offline'} ({server.toolCount || 0} tools)
                        <button 
                          onClick={() => setMcpServers(mcpServers.filter((_, i) => i !== idx))}
                          style={{ background: 'transparent', border: 'none', color: 'var(--accent-rose)', cursor: 'pointer', marginLeft: '8px' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input 
                        type="text" 
                        value={server.command} 
                        onChange={(e) => {
                          const newServers = [...mcpServers];
                          newServers[idx].command = e.target.value;
                          setMcpServers(newServers);
                        }}
                        placeholder="Command (e.g. npx)" 
                        className="dashboard-input" 
                        style={{ width: '30%', fontSize: '13px' }}
                      />
                      <input 
                        type="text" 
                        value={server.args?.join(' ') || ''} 
                        onChange={(e) => {
                          const newServers = [...mcpServers];
                          newServers[idx].args = e.target.value.split(' ');
                          setMcpServers(newServers);
                        }}
                        placeholder="Args (e.g. -y @modelcontextprotocol/server-postgres)" 
                        className="dashboard-input" 
                        style={{ flex: 1, fontSize: '13px' }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  onClick={() => setMcpServers([...mcpServers, { id: Date.now().toString(), name: '', command: '', args: [], connected: false }])}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-glass)', padding: '6px 12px', borderRadius: '6px', color: 'white', cursor: 'pointer' }}
                >
                  <Plus size={14} /> Add Server
                </button>
                <button 
                  onClick={handleSaveMCPServers}
                  disabled={isSavingMCP}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', background: 'var(--accent-primary)', border: 'none', padding: '6px 12px', borderRadius: '6px', color: 'white', cursor: 'pointer' }}
                >
                  <Save size={14} /> Save & Connect
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* AI Agent Configuration */}
        <section className="glass panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <Cpu size={20} style={{ color: 'var(--accent-primary)' }} />
            <h3 style={{ margin: 0, fontSize: '18px' }}>AI Agent Intelligence</h3>
          </div>
          
          {/* AI Providers Grid */}
          <div style={{ marginBottom: '24px' }}>
            <h4 style={{ fontSize: '14px', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '12px', letterSpacing: '0.05em' }}>AI Providers & Models</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
              {providerStatuses.map(provider => (
                <div key={provider.id} style={{ 
                  padding: '12px', 
                  background: 'rgba(0,0,0,0.2)', 
                  borderRadius: '10px', 
                  border: `1px solid ${provider.status === 'ready' ? 'rgba(16, 185, 129, 0.2)' : 'var(--border-glass)'}`,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    <div style={{ fontWeight: 'bold', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {provider.name}
                      {provider.status === 'ready' && <CheckCircle2 size={12} style={{ color: 'var(--accent-emerald)' }} />}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{provider.model}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '10px', color: provider.status === 'ready' ? 'var(--accent-emerald)' : 'var(--accent-rose)', fontWeight: 'bold' }}>
                      {provider.status.toUpperCase()}
                    </div>
                    {provider.isLocal && <div style={{ fontSize: '9px', color: 'var(--accent-primary)' }}>LOCAL</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Agent Role Assignment */}
          {agentConfig && (
            <div style={{ background: 'rgba(45, 212, 191, 0.05)', padding: '16px', borderRadius: '10px', border: '1px solid rgba(45, 212, 191, 0.1)' }}>
              <h4 style={{ fontSize: '14px', color: 'var(--accent-primary)', marginBottom: '16px' }}>Specialist Assignments</h4>
              <div style={{ display: 'grid', gap: '16px' }}>
                {Object.entries(agentConfig.assignments || {}).map(([role, currentProfile]: [string, any]) => (
                  <div key={role} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ textTransform: 'capitalize', fontSize: '14px' }}>{role.replace('_', ' ')} Agent</div>
                    <select 
                      value={currentProfile}
                      onChange={(e) => onSaveAgent(role, e.target.value)}
                      className="dashboard-input"
                      style={{ width: '200px', fontSize: '13px' }}
                    >
                      {agentConfig.profiles?.map((p: any) => (
                        <option key={p.name} value={p.name}>{p.name} ({p.provider})</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Test Discovery Strategy Section */}
        <section className="glass panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <Eye size={20} style={{ color: 'var(--accent-primary)' }} />
            <h3 style={{ margin: 0, fontSize: '18px' }}>Test Discovery Strategy</h3>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '16px' }}>
            How the system discovers module structure, selectors, and workflows for test generation.
          </p>

          {/* Strategy Selection */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            {[
              { id: 'ai-first', label: 'AI-First', icon: Zap, desc: 'Generate from Jira. No recording needed.', color: 'var(--accent-primary)' },
              { id: 'source-code', label: 'Source Code API', icon: Code, desc: 'Parse Angular components. (Coming soon)', color: 'var(--accent-amber)', disabled: true },
              { id: 'extension', label: 'Browser Extension', icon: Globe, desc: 'Manual recording for special cases.', color: 'var(--accent-emerald)' },
            ].map(opt => (
              <div
                key={opt.id}
                onClick={() => !opt.disabled && setDiscoveryStrategy(opt.id)}
                style={{
                  padding: '16px',
                  borderRadius: '10px',
                  border: `2px solid ${discoveryStrategy === opt.id ? opt.color : 'var(--border-glass)'}`,
                  background: discoveryStrategy === opt.id ? `${opt.color}10` : 'rgba(0,0,0,0.15)',
                  cursor: opt.disabled ? 'not-allowed' : 'pointer',
                  opacity: opt.disabled ? 0.5 : 1,
                  transition: 'all 0.2s',
                  position: 'relative',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <opt.icon size={18} style={{ color: opt.color }} />
                  <span style={{ fontWeight: 600, fontSize: '14px', color: 'white' }}>{opt.label}</span>
                  {discoveryStrategy === opt.id && <CheckCircle2 size={14} style={{ color: opt.color, marginLeft: 'auto' }} />}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{opt.desc}</div>
                {opt.disabled && (
                  <div style={{ position: 'absolute', top: '8px', right: '8px', fontSize: '9px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.1)', color: 'var(--text-dim)' }}>
                    COMING SOON
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Hybrid mode info */}
          {discoveryStrategy === 'ai-first' && (
            <div style={{ fontSize: '12px', color: 'var(--accent-emerald)', padding: '10px', background: 'rgba(16, 185, 129, 0.08)', borderRadius: '8px', marginBottom: '16px' }}>
              AI will infer selectors from Jira ticket text, module names, and existing object repository. Self-healing handles failures at runtime.
            </div>
          )}
          {discoveryStrategy === 'extension' && (
            <div style={{ fontSize: '12px', color: 'var(--accent-amber)', padding: '10px', background: 'rgba(245, 158, 11, 0.08)', borderRadius: '8px', marginBottom: '16px', display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
              <AlertTriangle size={14} style={{ marginTop: '1px', flexShrink: 0 }} />
              Manual recording is optional. Use this when AI confidence is low for complex multi-step workflows.
            </div>
          )}

          {/* Source Code Path (placeholder) */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-dim)', display: 'block', marginBottom: '6px' }}>
              Frontend Source Code Path (for Source Code API strategy)
            </label>
            <input
              type="text"
              value={sourceCodePath}
              onChange={(e) => setSourceCodePath(e.target.value)}
              placeholder="/path/to/frontend/src (e.g., D:/KMT/My class/AI/GoHybridAI/frontend/kb-ui/src)"
              className="dashboard-input"
              style={{ fontSize: '13px' }}
            />
            <p style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' }}>
              The system will parse Angular components, route configs, and form control names to build selector knowledge.
            </p>
          </div>

          {/* Fallback toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'rgba(0,0,0,0.15)', borderRadius: '8px', marginBottom: '16px' }}>
            <div>
              <div style={{ fontWeight: 500, color: 'white', fontSize: '13px' }}>Fallback to AI defaults</div>
              <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>Use AI-generated selectors when no recording exists</div>
            </div>
            <button
              onClick={() => setFallbackToExtension(!fallbackToExtension)}
              style={{
                width: '44px', height: '24px', borderRadius: '12px', border: 'none',
                padding: '2px',
                background: fallbackToExtension ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)',
                cursor: 'pointer', position: 'relative', transition: 'all 0.2s'
              }}
            >
              <div style={{
                width: '20px', height: '20px', borderRadius: '50%', background: 'white',
                transition: 'all 0.2s',
                transform: fallbackToExtension ? 'translateX(20px)' : 'translateX(0)'
              }} />
            </button>
          </div>

          {/* Save button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={handleSaveDiscovery}
              disabled={isSavingDiscovery}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                fontSize: '13px', background: 'var(--accent-primary)',
                border: 'none', padding: '8px 20px', borderRadius: '8px',
                color: 'white', cursor: isSavingDiscovery ? 'not-allowed' : 'pointer',
                opacity: isSavingDiscovery ? 0.6 : 1,
              }}
            >
              <Save size={14} /> {isSavingDiscovery ? 'Saving...' : 'Save Discovery Strategy'}
            </button>
          </div>
        </section>

        {/* Jira Integration Section */}
        <section className="glass panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <GitBranch size={20} style={{ color: 'var(--accent-primary)' }} />
            <h3 style={{ margin: 0, fontSize: '18px' }}>Jira Integration</h3>
          </div>
          <JiraIntegrationSettings />
        </section>

        {/* Script Library Section */}
        <section className="glass panel" style={{ padding: '20px' }}>
          <ScriptLibraryPanel />
        </section>

        {/* Sprint Regression Section */}
        <section className="glass panel" style={{ padding: '20px' }}>
          <SprintRegressionPanel />
        </section>

        {/* Business Logic Section */}
        <section className="glass panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <Shield size={20} style={{ color: 'var(--accent-primary)' }} />
            <h3 style={{ margin: 0, fontSize: '18px' }}>Business Logic & Memory</h3>
          </div>
          <KnowledgeBaseSettings />
        </section>

        {/* Test Accounts Section */}
        <section className="glass panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <UserCheck size={20} style={{ color: 'var(--accent-primary)' }} />
            <h3 style={{ margin: 0, fontSize: '18px' }}>Test Account Vault</h3>
          </div>
          <TestUserManager />
        </section>
      </div>
    </div>
  );
};
