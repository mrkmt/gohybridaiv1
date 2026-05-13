import React from 'react';
import { 
  History, 
  Settings, 
  Zap, 
  Database, 
  LayoutDashboard,
  LucideIcon,
  FlaskConical,
  Blocks
} from 'lucide-react';

export type ActivityTab = 'dashboard' | 'kb' | 'history' | 'settings' | 'home' | 'logs' | 'testing' | 'extensions';

interface NavItem {
  id: ActivityTab;
  icon: LucideIcon;
  label: string;
}

const navItems: NavItem[] = [
  { id: 'dashboard', icon: Zap, label: 'Command Center' },
  { id: 'kb', icon: Database, label: 'Knowledge Brain' },
  { id: 'history', icon: History, label: 'Case History' },
  { id: 'extensions', icon: Blocks, label: 'Extensions (MCP)' },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

interface ActivityBarProps {
  activeTab: ActivityTab;
  onTabChange: (tab: ActivityTab) => void;
  position: 'left' | 'right';
}

export const ActivityBar: React.FC<ActivityBarProps> = ({ activeTab, onTabChange, position }) => {
  return (
    <aside 
      className={`activity-bar ${position}`}
      style={{
        width: 'var(--activity-bar-width)',
        height: '100vh',
        backgroundColor: 'var(--bg-sidebar)',
        borderRight: position === 'left' ? '1px solid var(--border-glass)' : 'none',
        borderLeft: position === 'right' ? '1px solid var(--border-glass)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '12px 0',
        zIndex: 100,
        boxShadow: position === 'left' ? '5px 0 15px rgba(0,0,0,0.3)' : '-5px 0 15px rgba(0,0,0,0.3)'
      }}
    >
      {navItems.map((item) => (
        <button
          key={item.id}
          onClick={() => onTabChange(item.id)}
          title={item.label}
          className={`activity-item ${activeTab === item.id ? 'active' : ''}`}
          style={{
            background: 'none',
            border: 'none',
            outline: 'none',
          }}
        >
          <item.icon 
            size={22} 
            strokeWidth={activeTab === item.id ? 2.5 : 2} 
            style={{ 
              filter: activeTab === item.id ? 'drop-shadow(0 0 5px var(--primary-glow))' : 'none' 
            }}
          />
        </button>
      ))}
    </aside>
  );
};
