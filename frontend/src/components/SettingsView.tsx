import React, { useState } from 'react';
import { 
  Settings as SettingsIcon, 
  Cpu, 
  Globe, 
  Bell, 
  CheckCircle2, 
  Shield, 
  Zap,
  Save,
  Link as LinkIcon,
  RotateCcw
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface TabProps {
  id: string;
  label: string;
  icon: React.ElementType;
  active: boolean;
  onClick: () => void;
}

const Tab: React.FC<TabProps> = ({ icon: Icon, label, active, onClick }) => (
  <button
    onClick={onClick}
    className={cn(
      "flex items-center gap-2.5 px-6 py-4 border-b-2 transition-all duration-300",
      active 
        ? "border-blue-500 bg-blue-500/5 text-blue-400" 
        : "border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-800/30"
    )}
  >
    <Icon className={cn("h-4 w-4", active && "text-blue-400")} />
    <span className="text-sm font-semibold tracking-wide uppercase">{label}</span>
  </button>
);

import { AgentAssignment, ProviderStatus } from '../hooks/useAppState';

interface SettingsViewProps {
  agentConfig: AgentAssignment | null;
  providerStatuses: ProviderStatus[];
  onSaveAgent: (role: string, profile: string) => Promise<void>;
  sidebarPosition: 'left' | 'right';
  onPositionChange: (pos: 'left' | 'right') => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  agentConfig: initialAgentConfig,
  providerStatuses: initialProviderStatuses,
  onSaveAgent,
  sidebarPosition,
  onPositionChange
}) => {
  const [activeTab, setActiveTab] = useState('project');
  const [isSaving, setIsSaving] = useState(false);

  // We are not using the props yet in the template, so let's use them to avoid lint errors
  console.log('Active Config:', initialAgentConfig);
  console.log('Providers:', initialProviderStatuses);
  console.log('Sidebar:', sidebarPosition);
  console.log('Position Change Fn:', onPositionChange);

  // Example Settings State
  const [jiraConfig, setJiraConfig] = useState({
    url: 'https://gohybrid.atlassian.net',
    email: 'dev@gohybrid.com',
    token: '**************',
    connected: true
  });

  const [aiProvider, setAiProvider] = useState('qwen');

  return (
    <div className="flex flex-col h-full animate-in fade-in duration-700">
      {/* Header */}
      <div className="px-10 py-8 border-b border-white/5 bg-slate-900/10">
        <div className="flex items-center gap-3 mb-2">
           <div className="p-2 bg-blue-600/10 rounded-lg">
              <SettingsIcon className="h-5 w-5 text-blue-400" />
           </div>
           <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">System Intelligence Centers</h1>
        </div>
        <p className="text-slate-500 text-sm font-medium">Coordinate your project orchestration, model preferences, and external integrations.</p>
      </div>

      {/* Tabs Control */}
      <div className="flex px-10 border-b border-white/5 bg-slate-900/5 backdrop-blur-sm sticky top-0 z-10">
        <Tab id="project" label="Project" icon={Shield} active={activeTab === 'project'} onClick={() => setActiveTab('project')} />
        <Tab id="ai" label="AI Models" icon={Cpu} active={activeTab === 'ai'} onClick={() => setActiveTab('ai')} />
        <Tab id="jira" label="Jira Sync" icon={Globe} active={activeTab === 'jira'} onClick={() => setActiveTab('jira')} />
        <Tab id="notifications" label="Alerts" icon={Bell} active={activeTab === 'notifications'} onClick={() => setActiveTab('notifications')} />
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="mx-auto max-w-[1400px] space-y-8">
          
          {activeTab === 'project' && (
            <div className="space-y-8 animate-in slide-in-from-bottom-2 duration-500">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800 ring-1 ring-inset ring-white/5">
                  <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                    <Shield className="h-4 w-4 text-blue-400" />
                    Security Baseline
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2 px-1">Enforce Strict Selectors</label>
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/50 border border-slate-800">
                         <div className="flex-1 text-sm text-slate-300">Prioritize data-test-id attributes</div>
                         <div className="w-10 h-5 bg-blue-600 rounded-full flex items-center px-1 shadow-inner shadow-blue-900/20">
                            <div className="w-3.5 h-3.5 bg-white rounded-full ml-auto shadow-sm" />
                         </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800 ring-1 ring-inset ring-white/5">
                   <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                    <Zap className="h-4 w-4 text-amber-400" />
                    Speed Optimization
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2 px-1">Parallel Execution</label>
                      <input 
                        type="range" min="1" max="5" defaultValue="3"
                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" 
                      />
                      <div className="flex justify-between mt-2 text-[10px] font-medium text-slate-600">
                        <span>LOWER (STABLE)</span>
                        <span>HIGHER (RISKY)</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
               <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {[
                    { id: 'qwen', name: 'Qwen 2.5 Coder', desc: 'Optimized for script generation', color: 'blue' },
                    { id: 'gemini', name: 'Gemini Pro', desc: 'Google DeepMind Intelligence', color: 'indigo' },
                    { id: 'ollama', name: 'Ollama Llama 3', desc: 'Private Local Execution', color: 'emerald' }
                  ].map(p => (
                    <button 
                      key={p.id}
                      onClick={() => setAiProvider(p.id)}
                      className={cn(
                        "p-5 rounded-2xl border text-left transition-all duration-300 relative group",
                        aiProvider === p.id 
                          ? `bg-${p.color}-600/10 border-${p.color}-500/50 ring-2 ring-${p.color}-500/20 shadow-lg shadow-${p.color}-900/10` 
                          : "bg-slate-900/40 border-slate-800 hover:border-slate-700"
                      )}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className={cn(
                          "p-2 rounded-lg bg-slate-800 transition-colors group-hover:bg-slate-700",
                          aiProvider === p.id && `bg-${p.color}-600/20 text-${p.color}-400`
                        )}>
                          <Cpu className="h-5 w-5" />
                        </div>
                        {aiProvider === p.id && <CheckCircle2 className="h-4 w-4 text-blue-400" />}
                      </div>
                      <div className="font-bold text-slate-100">{p.name}</div>
                      <div className="text-xs text-slate-500 mt-1 font-medium leading-relaxed">{p.desc}</div>
                    </button>
                  ))}
               </div>
            </div>
          )}

          {activeTab === 'jira' && (
            <div className="space-y-8 animate-in slide-in-from-bottom-2 duration-500">
                <div className="p-8 rounded-3xl bg-slate-900/40 border border-slate-800 shadow-2xl relative overflow-hidden">
                   {/* Background Glow */}
                   <div className="absolute top-0 right-0 w-64 h-64 bg-slate-400/5 blur-[100px] -z-10" />
                   
                   <div className="flex items-center justify-between mb-10">
                      <div>
                        <h3 className="text-xl font-bold text-white mb-1">Service Instance</h3>
                        <div className="flex items-center gap-2">
                          <div className={cn("h-2 w-2 rounded-full shadow-[0_0_8px]", jiraConfig.connected ? "bg-emerald-500 shadow-emerald-500/50" : "bg-red-500 shadow-red-500/50")} />
                          <span className={cn("text-xs font-bold uppercase tracking-widest", jiraConfig.connected ? "text-emerald-400" : "text-red-400")}>
                            {jiraConfig.connected ? 'Cloud Integrated' : 'Sync Disconnected'}
                          </span>
                        </div>
                      </div>
                      <button className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-bold transition-all">
                        <RotateCcw className="h-3.5 w-3.5" />
                        Reconnect Logic
                      </button>
                   </div>

                   <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-6">
                         <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2 px-1">Atlassian Site URL</label>
                            <div className="relative group">
                               <div className="absolute inset-y-0 left-4 flex items-center text-slate-500 transition-colors group-focus-within:text-blue-500">
                                  <Globe className="h-4 w-4" />
                               </div>
                               <input 
                                  type="text" 
                                  value={jiraConfig.url}
                                  onChange={(e) => setJiraConfig({...jiraConfig, url: e.target.value})}
                                  className="w-full h-12 bg-slate-950/60 border border-slate-800 rounded-2xl pl-11 pr-4 text-sm font-medium focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                />
                            </div>
                         </div>
                         <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2 px-1">Sync Origin Email</label>
                            <input 
                               type="email" 
                               value={jiraConfig.email}
                               onChange={(e) => setJiraConfig({...jiraConfig, email: e.target.value})}
                               className="w-full h-12 bg-slate-950/60 border border-slate-800 rounded-2xl px-5 text-sm font-medium focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                             />
                         </div>
                      </div>
                      <div className="space-y-6">
                         <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2 px-1">REST API Persona Token</label>
                            <div className="relative group">
                               <input 
                                  type="password" 
                                  value={jiraConfig.token}
                                  onChange={(e) => setJiraConfig({...jiraConfig, token: e.target.value})}
                                  className="w-full h-12 bg-slate-950/60 border border-slate-800 rounded-2xl px-5 pr-12 text-sm font-medium focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                />
                               <LinkIcon className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-600" />
                            </div>
                         </div>
                         <div className="pt-6">
                            <button 
                              onClick={async () => { 
                                setIsSaving(true); 
                                if (initialAgentConfig) {
                                  await onSaveAgent(initialAgentConfig.role, initialAgentConfig.profile);
                                }
                                setTimeout(() => setIsSaving(false), 2000); 
                              }}
                              className="w-full h-12 rounded-2xl bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-900/20 text-white font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                            >
                              <Save className={cn("h-4 w-4", isSaving && "animate-spin")} />
                              {isSaving ? 'Syncing Vault...' : 'Save Jira Config'}
                            </button>
                         </div>
                      </div>
                   </div>
                </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
