import React, { useState } from 'react';
import { 
  Play, 
  ChevronRight, 
  ChevronDown, 
  Filter, 
  Search, 
  FlaskConical, 
  Zap, 
  Terminal,
  CheckCircle2,
  XCircle,
  Clock
} from 'lucide-react';

interface TestItem {
  id: string;
  name: string;
  type: 'playwright' | 'api';
  status: 'passed' | 'failed' | 'running' | 'idle';
  lastRun?: string;
}

const mockTests: TestItem[] = [
  { id: 'pw-1', name: 'Login Flow Auth', type: 'playwright', status: 'passed', lastRun: '2m ago' },
  { id: 'pw-2', name: 'Leave Application Submit', type: 'playwright', status: 'failed', lastRun: '10m ago' },
  { id: 'api-1', name: 'GET /api/user-profile', type: 'api', status: 'passed', lastRun: '1h ago' },
  { id: 'api-2', name: 'POST /api/leave/request', type: 'api', status: 'idle' },
];

export const TestExplorer: React.FC = () => {
  const [expandedSections, setExpandedSections] = useState<string[]>(['playwright', 'api']);
  const [filter, setFilter] = useState('');

  const toggleSection = (section: string) => {
    setExpandedSections(prev => 
      prev.includes(section) ? prev.filter(s => s !== section) : [...prev, section]
    );
  };

  const renderStatusIcon = (status: TestItem['status']) => {
    switch (status) {
      case 'passed': return <CheckCircle2 size={14} className="text-accent-emerald" style={{ color: 'var(--accent-emerald)' }} />;
      case 'failed': return <XCircle size={14} className="text-accent-rose" style={{ color: 'var(--accent-rose)' }} />;
      case 'running': return <Clock size={14} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />;
      default: return <div style={{ width: 14, height: 14, borderRadius: '50%', border: '1px solid var(--border-glass)' }} />;
    }
  };

  const filteredTests = mockTests.filter(t => 
    t.name.toLowerCase().includes(filter.toLowerCase())
  );

  const playthroughTests = filteredTests.filter(t => t.type === 'playwright');
  const apiTests = filteredTests.filter(t => t.type === 'api');

  return (
    <div className="test-explorer" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-glass)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Testing</span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button className="icon-btn-small" title="Run All"><Play size={14} /></button>
            <button className="icon-btn-small" title="Filter"><Filter size={14} /></button>
          </div>
        </div>
        <div className="search-box" style={{ 
          display: 'flex', 
          alignItems: 'center', 
          background: 'rgba(0,0,0,0.2)', 
          borderRadius: '4px', 
          padding: '2px 8px',
          border: '1px solid var(--border-glass)'
        }}>
          <Search size={12} style={{ color: 'var(--text-dim)', marginRight: '6px' }} />
          <input 
            type="text" 
            placeholder="Filter (e.g. text, !exclude)" 
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ 
              background: 'none', 
              border: 'none', 
              color: 'white', 
              fontSize: '12px', 
              width: '100%', 
              outline: 'none',
              padding: '4px 0'
            }} 
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {/* Playwright Section */}
        <div className="explorer-section">
          <div 
            onClick={() => toggleSection('playwright')}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              padding: '4px 8px', 
              cursor: 'pointer',
              background: 'rgba(255,255,255,0.03)',
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--text-light)'
            }}
          >
            {expandedSections.includes('playwright') ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <FlaskConical size={14} style={{ margin: '0 6px', color: 'var(--accent-primary)' }} />
            PLAYWRIGHT
            <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-dim)' }}>{playthroughTests.length}</span>
          </div>
          {expandedSections.includes('playwright') && playthroughTests.map(test => (
            <div 
              key={test.id} 
              className="test-item"
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                padding: '4px 12px 4px 32px', 
                cursor: 'pointer',
                fontSize: '12px',
                color: 'var(--text-dim)',
                transition: 'background 0.2s'
              }}
            >
              <div style={{ marginRight: '8px' }}>{renderStatusIcon(test.status)}</div>
              <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{test.name}</span>
              <div className="test-actions" style={{ display: 'none', gap: '4px' }}>
                <Play size={12} className="hover-primary" />
                <Terminal size={12} />
              </div>
            </div>
          ))}
        </div>

        {/* API Section */}
        <div className="explorer-section" style={{ marginTop: '8px' }}>
          <div 
            onClick={() => toggleSection('api')}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              padding: '4px 8px', 
              cursor: 'pointer',
              background: 'rgba(255,255,255,0.03)',
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--text-light)'
            }}
          >
            {expandedSections.includes('api') ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <Zap size={14} style={{ margin: '0 6px', color: 'var(--accent-primary)' }} />
            API ASSERT
            <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-dim)' }}>{apiTests.length}</span>
          </div>
          {expandedSections.includes('api') && apiTests.map(test => (
            <div 
              key={test.id} 
              className="test-item"
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                padding: '4px 12px 4px 32px', 
                cursor: 'pointer',
                fontSize: '12px',
                color: 'var(--text-dim)',
                transition: 'background 0.2s'
              }}
            >
              <div style={{ marginRight: '8px' }}>{renderStatusIcon(test.status)}</div>
              <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{test.name}</span>
              <div className="test-actions" style={{ display: 'none', gap: '4px' }}>
                <Play size={12} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .test-item:hover {
          background: rgba(255,255,255,0.05);
          color: white !important;
        }
        .test-item:hover .test-actions {
          display: flex !important;
        }
        .hover-primary:hover {
          color: var(--accent-primary);
        }
        .icon-btn-small {
          background: none;
          border: none;
          color: var(--text-dim);
          cursor: pointer;
          padding: 2px;
          border-radius: 4px;
        }
        .icon-btn-small:hover {
          background: rgba(255,255,255,0.1);
          color: white;
        }
      `}</style>
    </div>
  );
};
