import React from 'react';
import { ActivityTab } from './ActivityBar';
import { TestExplorer } from './TestExplorer';

interface ExplorerBarProps {
  activeTab: ActivityTab;
  title?: string;
  children?: React.ReactNode;
}

export const ExplorerBar: React.FC<ExplorerBarProps> = ({ activeTab, title, children }) => {
  const renderExplorerContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <div style={{ padding: '12px' }}>
            <h3 style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '12px' }}>Active Tickets</h3>
            <div style={{ color: 'var(--text-dim)', fontSize: '12px' }}>Select a ticket to begin...</div>
          </div>
        );
      case 'kb':
        return (
          <div style={{ padding: '12px' }}>
            <h3 style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '12px' }}>Modules</h3>
            <div style={{ color: 'var(--text-dim)', fontSize: '12px' }}>Knowledge matrix loading...</div>
          </div>
        );
      case 'testing':
        return <TestExplorer />;
      default:
        return null;
    }
  };

  if (['home', 'settings', 'logs'].includes(activeTab)) return null;

  return (
    <div 
      className="explorer-bar"
      style={{
        width: 'var(--explorer-width)',
        height: '100vh',
        backgroundColor: 'var(--bg-explorer)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 90,
      }}
    >
      {title && (
        <div style={{ 
          padding: '12px 16px', 
          borderBottom: '1px solid var(--border)',
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }}>
          {title}
        </div>
      )}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {children || renderExplorerContent()}
      </div>
    </div>
  );
};
