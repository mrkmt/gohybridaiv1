import React, { useState } from 'react';
import { 
  MessageSquare, 
  LayoutDashboard, 
  Settings, 
  ChevronLeft, 
  ChevronRight,
  Bot,
  Zap,
  Layout,
  Monitor
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for Tailwind class merging
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface NavItemProps {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  collapsed?: boolean;
  onClick: () => void;
}

const NavItem: React.FC<NavItemProps> = ({ icon: Icon, label, active, collapsed, onClick }) => (
  <button
    onClick={onClick}
    className={cn(
      "group relative flex items-center gap-3 rounded-xl p-3 transition-all duration-300",
      active 
        ? "bg-blue-600/20 text-blue-400 shadow-[0_0_20px_rgba(37,99,235,0.15)]" 
        : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-100"
    )}
  >
    <Icon className={cn("h-5 w-5 transition-transform duration-300 group-hover:scale-110", active && "text-blue-400")} />
    {!collapsed && (
      <span className="text-sm font-medium tracking-wide transition-opacity duration-300">
        {label}
      </span>
    )}
    {active && (
      <div className="absolute left-0 h-10 w-1 rounded-r-full bg-blue-500 shadow-[0_0_10px_#3b82f6]" />
    )}
    {collapsed && (
      <div className="absolute left-14 hidden rounded-md bg-slate-900 px-2 py-1 text-xs text-white group-hover:block border border-slate-700 whitespace-nowrap z-50">
        {label}
      </div>
    )}
  </button>
);

interface MainLayoutProps {
  children: React.ReactNode;
  activeView: 'chat' | 'dashboard' | 'settings';
  onViewChange: (view: 'chat' | 'dashboard' | 'settings') => void;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children, activeView, onViewChange }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className="flex h-screen w-full bg-[#0a0a14] text-slate-100 selection:bg-blue-500/30">
      {/* Sidebar with Glassmorphism */}
      <aside 
        className={cn(
          "relative flex flex-col border-r border-slate-800/50 bg-slate-900/30 backdrop-blur-2xl transition-all duration-500 ease-in-out z-40",
          isCollapsed ? "w-20" : "w-64"
        )}
      >
        {/* Logo Section */}
        <div className="flex h-20 items-center px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 shadow-lg shadow-blue-900/20 ring-1 ring-blue-400/30">
              <Bot className="h-6 w-6 text-white" />
            </div>
            {!isCollapsed && (
              <span className="animate-in fade-in slide-in-from-left-4 duration-500 text-xl font-bold tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
                GoHybrid <span className="text-blue-500 text-xs align-top ml-1 opacity-80 uppercase tracking-widest font-black">AI</span>
              </span>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex flex-1 flex-col gap-2 px-3 py-4">
          <NavItem 
            icon={MessageSquare} 
            label="Chat Intelligence" 
            active={activeView === 'chat'} 
            collapsed={isCollapsed}
            onClick={() => onViewChange('chat')}
          />
          <NavItem 
            icon={LayoutDashboard} 
            label="Execution Center" 
            active={activeView === 'dashboard'} 
            collapsed={isCollapsed}
            onClick={() => onViewChange('dashboard')}
          />
          <div className="my-2 h-px bg-slate-800/50 mx-3" />
          <NavItem 
            icon={Settings} 
            label="System Settings" 
            active={activeView === 'settings'} 
            collapsed={isCollapsed}
            onClick={() => onViewChange('settings')}
          />
        </nav>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-slate-800/50">
          <div className={cn(
            "flex flex-col gap-4",
            isCollapsed ? "items-center" : ""
          )}>
            {!isCollapsed && (
              <div className="rounded-xl bg-slate-800/30 p-4 border border-slate-700/50">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="h-4 w-4 text-amber-400" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Engine Status</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                  <span className="text-sm font-medium text-emerald-400">Core Active</span>
                </div>
              </div>
            )}
            
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="flex h-10 w-full items-center justify-center rounded-lg hover:bg-slate-800/50 text-slate-400 hover:text-white transition-colors"
            >
              {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="relative flex flex-1 flex-col overflow-hidden">
        {/* Top Header Glassmorphism */}
        <header className="flex h-16 items-center justify-between px-8 border-b border-white/5 bg-slate-900/20 backdrop-blur-md z-30">
          <div className="flex items-center gap-4 text-xs font-medium text-slate-500 tracking-wider uppercase">
             <span>Main Workspace</span>
             <ChevronRight className="h-3 w-3" />
             <span className="text-slate-300 lowercase font-mono">/v1.1.0-stable</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/50 border border-slate-700/50 text-xs font-medium text-slate-400 hover:text-white cursor-pointer transition-colors">
              <Monitor className="h-3.5 w-3.5" />
              <span>Preview Mode</span>
            </div>
            <button className="h-8 w-8 rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-all">
              <Layout className="h-4 w-4" />
            </button>
            <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 border border-blue-400/30 flex items-center justify-center text-white font-bold text-xs">
              K
            </div>
          </div>
        </header>

        {/* Content Container */}
        <div className="flex-1 overflow-auto relative p-6">
           {children}

           {/* Background Decorative Elements */}
           <div className="fixed top-1/4 -right-20 w-96 h-96 bg-blue-600/10 rounded-full blur-[128px] -z-10 pointer-events-none" />
           <div className="fixed bottom-1/4 -left-20 w-96 h-96 bg-indigo-600/10 rounded-full blur-[128px] -z-10 pointer-events-none" />
        </div>
      </main>
    </div>
  );
};
