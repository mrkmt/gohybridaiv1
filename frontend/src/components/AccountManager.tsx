import React, { useEffect, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function AccountManager() {
  const [ownerId, setOwnerId] = useState<string>(() => localStorage.getItem('ownerId') || 'owner-1');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'owner' | 'admin'>('owner');
  const [adminKey, setAdminKey] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchList();
  }, [ownerId]);

  const fetchList = async () => {
    if (!ownerId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`http://localhost:3000/api/users?ownerId=${encodeURIComponent(ownerId)}`);
      if (!res.ok) throw new Error('Failed to fetch users');
      const data = await res.json();
      setUsers(data.users || []);
    } catch (e: any) {
      setError(e.message || 'Error');
    } finally {
      setLoading(false);
    }
  };

  const setActiveForExtension = async (userId: string) => {
    if (!ownerId) return setError('ownerId required');
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/extension/active-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId, activeUserId: userId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to set active user');
      alert('Active user published for extension');
    } catch (e: any) {
      setError(e.message || 'Error');
    } finally {
      setLoading(false);
    }
  };

  const createUser = async () => {
    if (!ownerId || !displayName) {
      setError('Owner ID and display name are required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string,string> = { 'Content-Type': 'application/json' };
      if (role === 'admin' && adminKey) headers['x-api-key'] = adminKey;

      const res = await fetch('http://localhost:3000/api/users', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ownerId, displayName, role })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create user');
      // Persist ownerId locally for convenience
      localStorage.setItem('ownerId', ownerId);
      setDisplayName('');
      fetchList();
    } catch (e: any) {
      setError(e.message || 'Error creating user');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 12 }}>
      <h3>Account Management</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input value={ownerId} onChange={e => setOwnerId(e.target.value)} placeholder="ownerId" />
        <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="display name" />
        <select value={role} onChange={e => setRole(e.target.value as any)}>
          <option value="owner">Owner</option>
          <option value="admin">Admin</option>
        </select>
        <input value={adminKey} onChange={e => setAdminKey(e.target.value)} placeholder="admin key (for admins)" />
        <button onClick={createUser} disabled={loading}>Create</button>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}

      <div style={{ marginTop: 12 }}>
        <strong>Accounts for owner: {ownerId}</strong>
        {loading && <div>Loading...</div>}
        {!loading && users.length === 0 && <div>No accounts yet.</div>}
        <ul>
          {users.map(u => (
            <li key={u.id} style={{ marginBottom: 6 }}>
              {u.display_name} <small style={{ color: '#666' }}>({u.id})</small>
              <button style={{ marginLeft: 8 }} onClick={() => { navigator.clipboard?.writeText(u.id); alert('Copied userId to clipboard'); }}>Copy ID</button>
              <button style={{ marginLeft: 8 }} onClick={() => setActiveForExtension(u.id)}>Publish to Extension</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
