/**
 * JiraIntegrationSettings
 *
 * Settings panel for the per-user Jira integration.
 * Allows configuring domain, email, API token, site name, and the three
 * project-space keys (GT = Testing, GB = Backlog, GD = Dev).
 *
 * API:
 *   GET  /api/settings/jira        — load masked config
 *   PUT  /api/settings/jira        — save config
 *   POST /api/settings/jira/test   — test connection (no save)
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Save,
  Trash2,
  Zap,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface JiraConfig {
  domain:        string;
  email:         string;
  apiToken:      string;
  hasToken:      boolean;
  siteName:      string;
  gtProjectKey:  string;
  gbProjectKey:  string;
  gdProjectKey:  string;
}

type Status = 'idle' | 'loading' | 'saving' | 'testing' | 'success' | 'error';

interface Feedback {
  type:    'success' | 'error';
  message: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EMPTY_CONFIG: JiraConfig = {
  domain:       '',
  email:        '',
  apiToken:     '',
  hasToken:     false,
  siteName:     '',
  gtProjectKey: '',
  gbProjectKey: '',
  gdProjectKey: '',
};

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem('auth_token') ?? sessionStorage.getItem('auth_token') ?? '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Component ─────────────────────────────────────────────────────────────────

export const JiraIntegrationSettings: React.FC = () => {
  const [config,        setConfig]        = useState<JiraConfig>(EMPTY_CONFIG);
  const [status,        setStatus]        = useState<Status>('idle');
  const [feedback,      setFeedback]      = useState<Feedback | null>(null);
  const [showToken,     setShowToken]     = useState(false);
  const [isEnvFallback, setIsEnvFallback] = useState(false);

  // ── Load ─────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setStatus('loading');
    setFeedback(null);
    try {
      const res  = await fetch('/api/settings/jira', { headers: getAuthHeader() });
      const body = await res.json();
      if (res.ok && body.success) {
        setConfig({ ...EMPTY_CONFIG, ...body.data });
        setIsEnvFallback(body.isEnvFallback ?? false);
      } else {
        throw new Error(body.error ?? 'Failed to load settings');
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setStatus('idle');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Test connection ───────────────────────────────────────────────────────────

  const handleTest = async () => {
    if (!config.domain || !config.email) {
      setFeedback({ type: 'error', message: 'Domain and email are required to test connection.' });
      return;
    }
    if (!config.apiToken && !config.hasToken) {
      setFeedback({ type: 'error', message: 'API token is required to test connection.' });
      return;
    }
    setStatus('testing');
    setFeedback(null);
    try {
      const res  = await fetch('/api/settings/jira/test', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body:    JSON.stringify({
          domain:   config.domain,
          email:    config.email,
          apiToken: config.apiToken || '********',
        }),
      });
      const body = await res.json();
      if (res.ok && body.success) {
        setFeedback({ type: 'success', message: body.message ?? 'Connection successful!' });
      } else {
        throw new Error(body.error ?? 'Connection test failed');
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setStatus('idle');
    }
  };

  // ── Save ──────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!config.domain || !config.email) {
      setFeedback({ type: 'error', message: 'Domain and email are required.' });
      return;
    }
    setStatus('saving');
    setFeedback(null);
    try {
      const res  = await fetch('/api/settings/jira', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body:    JSON.stringify({
          domain:       config.domain.trim(),
          email:        config.email.trim(),
          apiToken:     config.apiToken || '********',
          siteName:     config.siteName.trim(),
          gtProjectKey: config.gtProjectKey.trim().toUpperCase(),
          gbProjectKey: config.gbProjectKey.trim().toUpperCase(),
          gdProjectKey: config.gdProjectKey.trim().toUpperCase(),
        }),
      });
      const body = await res.json();
      if (res.ok && body.success) {
        setFeedback({ type: 'success', message: 'Jira settings saved successfully.' });
        await load(); // refresh to get masked token
      } else {
        throw new Error(body.error ?? 'Save failed');
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setStatus('idle');
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!window.confirm('Remove Jira settings? The system will fall back to environment variables.')) return;
    setStatus('saving');
    setFeedback(null);
    try {
      const res  = await fetch('/api/settings/jira', {
        method:  'DELETE',
        headers: getAuthHeader(),
      });
      const body = await res.json();
      if (res.ok && body.success) {
        setFeedback({ type: 'success', message: 'Jira settings removed. Env-var fallback active.' });
        await load();
      } else {
        throw new Error(body.error ?? 'Delete failed');
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setStatus('idle');
    }
  };

  // ── Field helpers ─────────────────────────────────────────────────────────────

  const field = (key: keyof JiraConfig) => ({
    value:    String(config[key] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setConfig(prev => ({ ...prev, [key]: e.target.value })),
  });

  const busy = status !== 'idle';

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Jira Integration
          </h4>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
            Connect your Atlassian Jira account. Settings are stored per-user in the database.
          </p>
          {isEnvFallback && (
            <span style={{
              display: 'inline-block', marginTop: '6px', fontSize: '11px',
              padding: '2px 8px', borderRadius: '999px',
              background: 'rgba(234,179,8,.15)', color: '#ca8a04',
            }}>
              ⚡ Using environment-variable defaults — save to override per-user
            </span>
          )}
        </div>
        <button
          onClick={load}
          disabled={busy}
          title="Refresh"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px' }}
        >
          <RefreshCw size={14} className={status === 'loading' ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Feedback banner */}
      {feedback && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 16px',
          borderRadius: '8px',
          background: feedback.type === 'success' ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)',
          border: `1px solid ${feedback.type === 'success' ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)'}`,
          color: feedback.type === 'success' ? '#22c55e' : '#ef4444',
          fontSize: '13px',
        }}>
          {feedback.type === 'success'
            ? <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            : <AlertCircle   size={15} style={{ flexShrink: 0, marginTop: 1 }} />}
          {feedback.message}
        </div>
      )}

      {/* ── Connection credentials ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <SectionLabel>Connection</SectionLabel>

        <Row label="Jira Domain" hint="e.g. myorg.atlassian.net (no https://)">
          <Input {...field('domain')} placeholder="myorg.atlassian.net" disabled={busy} />
        </Row>

        <Row label="Account Email" hint="Your Atlassian account email">
          <Input {...field('email')} type="email" placeholder="you@company.com" disabled={busy} />
        </Row>

        <Row label="API Token" hint="Generate at id.atlassian.com → Security → API tokens">
          <div style={{ position: 'relative', flex: 1 }}>
            <Input
              value={config.apiToken}
              onChange={e => setConfig(prev => ({ ...prev, apiToken: e.target.value }))}
              type={showToken ? 'text' : 'password'}
              placeholder={config.hasToken ? '(token saved — enter new to replace)' : 'API token…'}
              disabled={busy}
              style={{ paddingRight: '36px' }}
            />
            <button
              onClick={() => setShowToken(v => !v)}
              style={{
                position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0,
              }}
              title={showToken ? 'Hide' : 'Show'}
            >
              {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Row>

        <Row label="Site Name" hint={'Optional label shown in the UI (e.g. "MyOrg Jira")'}>

          <Input {...field('siteName')} placeholder="My Company Jira" disabled={busy} />
        </Row>
      </div>

      {/* ── Project Space Keys ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <SectionLabel>Project Spaces</SectionLabel>
        <p style={{ margin: '-8px 0 0', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Three Jira projects form the testing workflow:
          <strong> GT</strong> (Testing tickets — entry point) →
          <strong> GB</strong> (Backlog/requirements — context) →
          <strong> GD</strong> (Dev tickets — implementation).
        </p>

        <Row label="GT — Testing" hint="Project key for Testing tickets (e.g. ATT)">
          <Input {...field('gtProjectKey')} placeholder="ATT" disabled={busy}
            style={{ textTransform: 'uppercase', maxWidth: '120px' }} />
        </Row>

        <Row label="GB — Backlog" hint="Project key for Backlog/requirement tickets (e.g. ABA)">
          <Input {...field('gbProjectKey')} placeholder="ABA" disabled={busy}
            style={{ textTransform: 'uppercase', maxWidth: '120px' }} />
        </Row>

        <Row label="GD — Dev" hint="Project key for Developer tickets (e.g. ADA)">
          <Input {...field('gdProjectKey')} placeholder="ADA" disabled={busy}
            style={{ textTransform: 'uppercase', maxWidth: '120px' }} />
        </Row>
      </div>

      {/* ── Actions ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', paddingTop: '4px' }}>
        {/* Test Connection */}
        <ActionButton
          onClick={handleTest}
          disabled={busy}
          icon={status === 'testing' ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
          variant="secondary"
        >
          {status === 'testing' ? 'Testing…' : 'Test Connection'}
        </ActionButton>

        {/* Save */}
        <ActionButton
          onClick={handleSave}
          disabled={busy}
          icon={status === 'saving' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          variant="primary"
        >
          {status === 'saving' ? 'Saving…' : 'Save Settings'}
        </ActionButton>

        {/* Delete (only if not already using env fallback) */}
        {!isEnvFallback && (
          <ActionButton
            onClick={handleDelete}
            disabled={busy}
            icon={<Trash2 size={14} />}
            variant="danger"
          >
            Remove Config
          </ActionButton>
        )}
      </div>

      {/* Help text */}
      <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Settings are stored encrypted in the database and scoped to your account.
        When no DB config exists, the system falls back to server environment variables.
        The API token is never returned to the browser after saving.
      </p>
    </div>
  );
};

// ── Sub-components ─────────────────────────────────────────────────────────────

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{
    fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
    color: 'var(--text-muted)', paddingBottom: '4px',
    borderBottom: '1px solid var(--border-glass)',
  }}>
    {children}
  </div>
);

interface RowProps {
  label:    string;
  hint?:    string;
  children: React.ReactNode;
}

const Row: React.FC<RowProps> = ({ label, hint, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
    <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>
      {label}
    </label>
    {children}
    {hint && (
      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{hint}</span>
    )}
  </div>
);

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input: React.FC<InputProps> = (props) => (
  <input
    {...props}
    style={{
      width: '100%', padding: '8px 12px', borderRadius: '6px', fontSize: '13px',
      background: 'var(--bg-input, rgba(255,255,255,.05))',
      border: '1px solid var(--border-glass)',
      color: 'var(--text-primary)', outline: 'none',
      transition: 'border-color .15s',
      boxSizing: 'border-box',
      ...props.style,
    }}
    onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; }}
    onBlur={e  => { e.currentTarget.style.borderColor = 'var(--border-glass)'; }}
  />
);

interface ActionButtonProps {
  onClick:   () => void;
  disabled?: boolean;
  icon?:     React.ReactNode;
  variant:   'primary' | 'secondary' | 'danger';
  children:  React.ReactNode;
}

const VARIANT_STYLES: Record<ActionButtonProps['variant'], React.CSSProperties> = {
  primary:   { background: 'var(--accent-primary)', color: '#fff' },
  secondary: { background: 'rgba(255,255,255,.07)', color: 'var(--text-primary)', border: '1px solid var(--border-glass)' },
  danger:    { background: 'rgba(239,68,68,.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,.3)' },
};

const ActionButton: React.FC<ActionButtonProps> = ({ onClick, disabled, icon, variant, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '8px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: 500,
      cursor: disabled ? 'not-allowed' : 'pointer',
      border: 'none', transition: 'opacity .15s',
      opacity: disabled ? 0.6 : 1,
      ...VARIANT_STYLES[variant],
    }}
  >
    {icon}
    {children}
  </button>
);
