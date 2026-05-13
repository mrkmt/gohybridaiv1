import React, { useState, useEffect, useRef } from 'react';
import { Search, Compass, Settings, Database, AppWindow, ArrowRight } from 'lucide-react';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: any) => void;
  onToggleSidebar: () => void;
}

interface CommandItem {
  id: string;
  category: string;
  label: string;
  icon: React.ReactNode;
  action: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, onNavigate, onToggleSidebar }) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: CommandItem[] = [
    { id: 'nav-dashboard', category: 'Navigation', label: 'Go to Command Center (Dashboard)', icon: <Compass size={16} />, action: () => onNavigate('dashboard') },
    { id: 'nav-kb', category: 'Navigation', label: 'Go to Knowledge Base', icon: <Database size={16} />, action: () => onNavigate('knowledge') },
    { id: 'nav-settings', category: 'Navigation', label: 'Go to Settings', icon: <Settings size={16} />, action: () => onNavigate('settings') },
    { id: 'view-sidebar', category: 'View', label: 'Toggle Sidebar Position (Left/Right)', icon: <AppWindow size={16} />, action: onToggleSidebar },
  ];

  const filteredCommands = commands.filter(cmd => 
    cmd.label.toLowerCase().includes(query.toLowerCase()) || 
    cmd.category.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const executeCommand = (index: number) => {
    const cmd = filteredCommands[index];
    if (cmd) {
      cmd.action();
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev < filteredCommands.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : prev));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      executeCommand(selectedIndex);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: '12vh'
      }}
      onClick={onClose}
    >
      <div 
        style={{
          width: '600px',
          maxWidth: '90vw',
          backgroundColor: '#1e1e24', // VS Code style dark theme
          borderRadius: '8px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,255,255,0.1)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <Search size={18} style={{ color: 'var(--text-muted)', marginRight: '12px' }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'white',
              fontSize: '15px',
              fontFamily: 'inherit'
            }}
          />
        </div>

        <div style={{ maxHeight: '350px', overflowY: 'auto', padding: '8px' }}>
          {filteredCommands.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
              No commands found.
            </div>
          ) : (
            filteredCommands.map((cmd, index) => (
              <div 
                key={cmd.id}
                onClick={() => executeCommand(index)}
                onMouseEnter={() => setSelectedIndex(index)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  backgroundColor: selectedIndex === index ? 'var(--accent-primary)' : 'transparent',
                  color: selectedIndex === index ? 'white' : 'var(--text-main)',
                  transition: 'background-color 0.1s'
                }}
              >
                <div style={{ 
                  marginRight: '12px', 
                  opacity: selectedIndex === index ? 1 : 0.7 
                }}>
                  {cmd.icon}
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500 }}>{cmd.label}</span>
                  <span style={{ fontSize: '11px', color: selectedIndex === index ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)' }}>
                    {cmd.category}
                  </span>
                </div>
                {selectedIndex === index && <ArrowRight size={14} style={{ opacity: 0.7 }} />}
              </div>
            ))
          )}
        </div>
        
        <div style={{ 
          padding: '8px 16px', 
          fontSize: '11px', 
          color: 'var(--text-muted)', 
          borderTop: '1px solid rgba(255,255,255,0.05)',
          display: 'flex',
          justifyContent: 'space-between'
        }}>
          <div>
            <span style={{ 
              background: 'rgba(255,255,255,0.1)', 
              padding: '2px 6px', 
              borderRadius: '4px',
              marginRight: '6px'
            }}>↑↓</span> to navigate
          </div>
          <div>
            <span style={{ 
              background: 'rgba(255,255,255,0.1)', 
              padding: '2px 6px', 
              borderRadius: '4px',
              marginRight: '6px'
            }}>↵</span> to select
          </div>
          <div>
            <span style={{ 
              background: 'rgba(255,255,255,0.1)', 
              padding: '2px 6px', 
              borderRadius: '4px',
              marginRight: '6px'
            }}>esc</span> to close
          </div>
        </div>
      </div>
    </div>
  );
};
