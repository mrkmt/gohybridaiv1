import React, { useState, useEffect } from 'react';
import { UserCheck, ShieldCheck } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export type TargetEnv = 'testing' | 'uat' | 'live';

export type ExtendedCredentials = {
  targetEnv: TargetEnv;
  baseUrl: string;
  customerId: string;
  testIdNumber: string;
  testUsername: string;
  testPassword: string;
};

export type Phase3CredentialsFormProps = {
  value: ExtendedCredentials;
  onChange: (next: ExtendedCredentials) => void;
  onBack: () => void;
  onGenerate: () => void;
  disabled?: boolean;
};

export function Phase3CredentialsForm(props: Phase3CredentialsFormProps) {
  const { value, onChange, onBack, onGenerate, disabled } = props;
  const [vaultUsers, setVaultUsers] = useState<any[]>([]);

  useEffect(() => {
    fetch(`${API_URL}/api/test-users`)
      .then(res => res.json())
      .then(data => {
        setVaultUsers(data);
        // NEW: Auto-select a matching user for the current environment
        const matchingUser = data.find((u: any) => u.targetEnv === value.targetEnv && u.isDefault) || 
                           data.find((u: any) => u.targetEnv === value.targetEnv);
        if (matchingUser && !value.testIdNumber) {
          onChange({
            ...value,
            baseUrl: matchingUser.baseUrl || value.baseUrl,
            customerId: matchingUser.customerId || value.customerId,
            testIdNumber: matchingUser.idNumber,
            testUsername: matchingUser.username,
            testPassword: matchingUser.password
          });
        }
      })
      .catch(err => console.error('Failed to load vault users', err));
  }, []);

  const handleVaultSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const user = vaultUsers.find(u => u.id === e.target.value);
    if (user) {
      onChange({
        ...value,
        targetEnv: user.targetEnv || value.targetEnv,
        baseUrl: user.baseUrl || value.baseUrl,
        customerId: user.customerId || value.customerId,
        testIdNumber: user.idNumber,
        testUsername: user.username,
        testPassword: user.password
      });
    }
  };

  const setField = <K extends keyof ExtendedCredentials>(key: K, nextValue: ExtendedCredentials[K]) => {
    onChange({ ...value, [key]: nextValue });
  };

  const canGenerate =
    value.baseUrl.trim().length > 0 &&
    value.customerId.trim().length > 0 &&
    value.testIdNumber.trim().length > 0 &&
    value.testUsername.trim().length > 0 &&
    value.testPassword.trim().length > 0;

  return (
    <>
      <h3>PHASE 3: PLAYWRIGHT SCRIPT GENERATION (HITL)</h3>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginBottom: '1.5rem' }}>
        Provide required test credentials. The generated script will use environment variables (no hardcoded secrets).
      </p>

      {/* NEW: Vault Quick Select */}
      <div className="panel glass" style={{ marginBottom: '1.5rem', padding: '1rem', background: 'rgba(45, 212, 191, 0.05)', border: '1px solid rgba(45, 212, 191, 0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          <ShieldCheck size={16} style={{ color: 'var(--accent-primary)' }} />
          <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--accent-primary)' }}>CREDENTIAL VAULT QUICK-LOAD</span>
        </div>
        <select 
          className="dashboard-input" 
          style={{ width: '100%', background: 'rgba(0,0,0,0.3)', color: 'white' }}
          onChange={handleVaultSelect}
          defaultValue=""
        >
          <option value="" disabled>-- Select a test user from vault --</option>
          {vaultUsers.map(u => (
            <option key={u.id} value={u.id}>[{u.userLevel}] {u.label} ({u.idNumber})</option>
          ))}
        </select>
      </div>

      <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="input-group">
          <label style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Target Environment *</label>
          <select
            value={value.targetEnv}
            onChange={(e) => setField('targetEnv', e.target.value as TargetEnv)}
            disabled={disabled}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '6px',
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid var(--border-glass)',
              color: 'white',
              boxSizing: 'border-box',
            }}
          >
            <option value="testing">Testing</option>
            <option value="uat">UAT</option>
            <option value="live">Live</option>
          </select>
        </div>

        <div className="input-group">
          <label style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Base URL *</label>
          <input
            type="url"
            required
            value={value.baseUrl}
            onChange={(e) => setField('baseUrl', e.target.value)}
            disabled={disabled}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '6px',
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid var(--border-glass)',
              color: 'white',
              boxSizing: 'border-box',
            }}
            placeholder="https://www.globalhr.app"
            autoComplete="off"
          />
        </div>

        <div className="input-group">
          <label style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Customer URL Code / Tenant ID *</label>
          <input
            type="text"
            required
            value={value.customerId}
            onChange={(e) => setField('customerId', e.target.value)}
            disabled={disabled}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '6px',
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid var(--border-glass)',
              color: 'white',
              boxSizing: 'border-box',
            }}
            placeholder="abcd"
            autoComplete="off"
          />
        </div>

        <div className="input-group">
          <label style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>ID Number *</label>
          <input
            type="text"
            required
            value={value.testIdNumber}
            onChange={(e) => setField('testIdNumber', e.target.value)}
            disabled={disabled}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '6px',
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid var(--border-glass)',
              color: 'white',
              boxSizing: 'border-box',
            }}
            placeholder="kmtcd-206"
            autoComplete="off"
          />
        </div>

        <div className="input-group">
          <label style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Test Username *</label>
          <input
            type="text"
            required
            value={value.testUsername}
            onChange={(e) => setField('testUsername', e.target.value)}
            disabled={disabled}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '6px',
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid var(--border-glass)',
              color: 'white',
              boxSizing: 'border-box',
            }}
            placeholder="ursa"
            autoComplete="off"
          />
        </div>

        <div className="input-group" style={{ gridColumn: '1 / -1' }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Test Password *</label>
          <input
            type="password"
            required
            value={value.testPassword}
            onChange={(e) => setField('testPassword', e.target.value)}
            disabled={disabled}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '6px',
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid var(--border-glass)',
              color: 'white',
              boxSizing: 'border-box',
            }}
            placeholder="(required)"
            autoComplete="off"
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginTop: '2rem' }}>
        <button className="btn-secondary" onClick={onBack} style={{ flex: 1 }} disabled={disabled}>
          BACK
        </button>
        <button className="btn-primary" onClick={onGenerate} style={{ flex: 2 }} disabled={disabled || !canGenerate}>
          GENERATE PLAYWRIGHT SCRIPT
        </button>
      </div>
    </>
  );
}
