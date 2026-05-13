import React, { useState, useEffect, useCallback } from 'react';
import { Ticket, Cpu, Zap, Search } from 'lucide-react';

interface MentionItem {
  id: string;
  label: string;
  type: 'jira' | 'agent' | 'skill';
  description?: string;
}

interface MentionOverlayProps {
  onSelect: (item: MentionItem) => void;
  onClose: () => void;
  query: string;
  jiraTickets: any[];
  agentProfiles: any[];
}

export const MentionOverlay: React.FC<MentionOverlayProps> = ({ 
  onSelect, 
  onClose, 
  query, 
  jiraTickets,
  agentProfiles 
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const skills: MentionItem[] = [
    { id: 'browser', label: 'browser', type: 'skill', description: 'Control browser for web testing' },
    { id: 'terminal', label: 'terminal', type: 'skill', description: 'Execute shell commands' },
    { id: 'filesystem', label: 'filesystem', type: 'skill', description: 'Read/write files' },
  ];

  const items: MentionItem[] = [
    ...jiraTickets.map(t => ({ id: t.id, label: t.id, type: 'jira' as const, description: t.summary })),
    ...agentProfiles.map(p => ({ id: p.name, label: p.name, type: 'agent' as const, description: p.provider })),
    ...skills
  ].filter(item => 
    item.label.toLowerCase().includes(query.toLowerCase()) || 
    (item.description && item.description.toLowerCase().includes(query.toLowerCase()))
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[selectedIndex]) onSelect(items[selectedIndex]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [items, selectedIndex, onSelect, onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (items.length === 0) return null;

  return (
    <div className="mention-overlay glass" style={{
      position: 'absolute',
      bottom: '100%',
      left: 0,
      width: '320px',
      maxHeight: '400px',
      overflowY: 'auto',
      background: 'var(--bg-explorer)',
      border: '1px solid var(--border-glass)',
      borderRadius: '8px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      marginBottom: '8px',
      zIndex: 1000,
      padding: '4px'
    }}>
      <div style={{ padding: '8px', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-glass)', marginBottom: '4px' }}>
        <Search size={14} style={{ color: 'var(--text-dim)', marginRight: '8px' }} />
        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Mentions</span>
      </div>
      
      {items.map((item, index) => (
        <div 
          key={`${item.type}-${item.id}`}
          onClick={() => onSelect(item)}
          onMouseEnter={() => setSelectedIndex(index)}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '8px 12px',
            cursor: 'pointer',
            background: index === selectedIndex ? 'var(--accent-primary-dim)' : 'transparent',
            borderRadius: '4px',
            transition: 'background 0.2s',
            borderLeft: `2px solid ${index === selectedIndex ? 'var(--accent-primary)' : 'transparent'}`
          }}
        >
          <div style={{ color: index === selectedIndex ? 'white' : 'var(--text-dim)', marginRight: '10px' }}>
            {item.type === 'jira' && <Ticket size={16} />}
            {item.type === 'agent' && <Cpu size={16} />}
            {item.type === 'skill' && <Zap size={16} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'white' }}>{item.label}</span>
              <span style={{ fontSize: '10px', color: 'var(--text-dim)', textTransform: 'uppercase' }}>{item.type}</span>
            </div>
            {item.description && (
              <div style={{ fontSize: '11px', color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {item.description}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};
