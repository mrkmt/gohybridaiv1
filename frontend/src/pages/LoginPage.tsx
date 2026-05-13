import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Shield, Lock, Mail, Loader2, Sparkles } from 'lucide-react';

export function LoginPage() {
  const [identifier, setIdentifier] = useState('gohybrid@ai.com');
  const [password, setPassword] = useState('Global@2026');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(identifier, password);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const C = {
    bg: '#0f172a',
    card: 'rgba(30, 41, 59, 0.7)',
    border: 'rgba(255, 255, 255, 0.08)',
    accent: '#38bdf8',
    text: '#f8fafc',
    dim: '#94a3b8'
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: `radial-gradient(circle at top right, #1e293b, ${C.bg}), radial-gradient(circle at bottom left, #0ea5e920, ${C.bg})`,
      fontFamily: "'Inter', sans-serif",
      padding: '20px'
    }}>
      {/* Decorative Elements */}
      <div style={{ position: 'fixed', top: '10%', left: '10%', width: '300px', height: '300px', background: C.accent, filter: 'blur(150px)', opacity: 0.05, borderRadius: '50%', zIndex: 0 }} />
      <div style={{ position: 'fixed', bottom: '10%', right: '10%', width: '400px', height: '400px', background: '#818cf8', filter: 'blur(150px)', opacity: 0.05, borderRadius: '50%', zIndex: 0 }} />

      <form onSubmit={handleSubmit} style={{
        background: C.card,
        backdropFilter: 'blur(20px)',
        padding: '40px',
        borderRadius: '24px',
        width: '100%',
        maxWidth: '420px',
        border: `1px solid ${C.border}`,
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
        zIndex: 1,
        position: 'relative'
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{ 
                width: '64px', height: '64px', borderRadius: '18px', background: 'rgba(56, 189, 248, 0.1)', 
                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px',
                border: `1px solid ${C.accent}20`
            }}>
                <Shield size={32} color={C.accent} />
            </div>
            <h1 style={{ color: C.text, fontSize: '24px', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
                GoHybrid AI
            </h1>
            <p style={{ color: C.dim, fontSize: '14px', marginTop: '8px' }}>
                Sign in to your autonomous workspace
            </p>
        </div>

        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            color: '#fca5a5',
            padding: '12px 16px',
            borderRadius: '12px',
            marginBottom: '20px',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            <AlertTriangle size={16} />
            {error}
          </div>
        )}

        {/* Input Group: Email */}
        <div style={{ marginBottom: '20px' }}>
            <label style={{ color: C.dim, fontSize: '12px', fontWeight: 600, marginBottom: '8px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Work Email
            </label>
            <div style={{ position: 'relative' }}>
                <Mail size={18} color={C.dim} style={{ position: 'absolute', left: '14px', top: '13px' }} />
                <input
                    type="email"
                    value={identifier}
                    onChange={e => setIdentifier(e.target.value)}
                    placeholder="name@company.com"
                    required
                    style={{
                        width: '100%',
                        padding: '12px 16px 12px 42px',
                        borderRadius: '12px',
                        border: `1px solid ${C.border}`,
                        background: 'rgba(15, 23, 42, 0.4)',
                        color: C.text,
                        fontSize: '14px',
                        boxSizing: 'border-box',
                        outline: 'none',
                        transition: 'border-color 0.2s'
                    }}
                />
            </div>
        </div>

        {/* Input Group: Password */}
        <div style={{ marginBottom: '32px' }}>
            <label style={{ color: C.dim, fontSize: '12px', fontWeight: 600, marginBottom: '8px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Password
            </label>
            <div style={{ position: 'relative' }}>
                <Lock size={18} color={C.dim} style={{ position: 'absolute', left: '14px', top: '13px' }} />
                <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    style={{
                        width: '100%',
                        padding: '12px 16px 12px 42px',
                        borderRadius: '12px',
                        border: `1px solid ${C.border}`,
                        background: 'rgba(15, 23, 42, 0.4)',
                        color: C.text,
                        fontSize: '14px',
                        boxSizing: 'border-box',
                        outline: 'none',
                        transition: 'border-color 0.2s'
                    }}
                />
            </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            padding: '14px',
            borderRadius: '12px',
            border: 'none',
            background: loading ? 'rgba(56, 189, 248, 0.5)' : C.accent,
            color: '#000',
            fontSize: '15px',
            fontWeight: 700,
            cursor: loading ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            transition: 'transform 0.1s active, opacity 0.2s'
          }}
        >
          {loading ? (
            <><Loader2 size={18} className="animate-spin" /> Authenticating...</>
          ) : (
            <>Sign In <Sparkles size={18} /></>
          )}
        </button>

        <div style={{ textAlign: 'center', marginTop: '24px', fontSize: '12px', color: C.dim }}>
            Powered by **Antigravity Engine**
        </div>
      </form>
    </div>
  );
}

function AlertTriangle({ size }: { size: number }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
    );
}
