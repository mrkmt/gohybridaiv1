/**
 * StageSelector Component
 * 
 * Environment stage selector for test execution
 * Supports Testing, UAT, and Live stages with automatic URL/credential updates
 */

import React from 'react';
import { Code, Shield, Globe, Database, User, Zap, Clock, Monitor } from 'lucide-react';
import { TestEnvironment } from '../services/TestExecutionService';

interface StageSelectorProps {
    environment: TestEnvironment;
    onEnvironmentChange: (env: TestEnvironment) => void;
    disabled?: boolean;
}

const STAGE_CONFIG: Record<string, {
    label: string;
    icon: React.ElementType;
    color: string;
    baseUrl: string;
    description: string;
}> = {
    testing: {
        label: 'Testing Stage',
        icon: Code,
        color: 'amber',
        baseUrl: 'https://test.globalhr.com.mm',
        description: 'Development & QA testing'
    },
    uat: {
        label: 'UAT Stage',
        icon: Shield,
        color: 'blue',
        baseUrl: 'https://uat.globalhr.com.mm',
        description: 'User acceptance testing'
    },
    live: {
        label: 'Live Production',
        icon: Globe,
        color: 'green',
        baseUrl: 'https://www.globalhr.com.mm',
        description: 'Production environment'
    }
};

export function StageSelector({ environment, onEnvironmentChange, disabled = false }: StageSelectorProps) {
    const handleStageChange = (stage: 'testing' | 'uat' | 'live') => {
        const config = STAGE_CONFIG[stage];
        const baseUrl = config.baseUrl;
        const customerId = environment.customerId || '';
        const fullUrl = customerId
            ? `${baseUrl}${baseUrl.endsWith('/') ? '' : '/'}${customerId}#/login`
            : baseUrl;
        onEnvironmentChange({
            ...environment,
            stage,
            baseUrl,
            fullUrl
        });
    };

    return (
        <div className="space-y-4">
            <div>
                <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                    <Globe size={16} className="text-blue-400" />
                    Select Environment Stage
                </h4>
                <div className="grid grid-cols-3 gap-3">
                    {(Object.entries(STAGE_CONFIG) as Array<[string, typeof STAGE_CONFIG['testing']]>).map(([stage, config]) => {
                        const Icon = config.icon;
                        const isSelected = environment.stage === stage;
                        const colorClasses = {
                            amber: {
                                border: 'border-amber-500',
                                bg: 'bg-amber-500/10',
                                text: 'text-amber-400'
                            },
                            blue: {
                                border: 'border-blue-500',
                                bg: 'bg-blue-500/10',
                                text: 'text-blue-400'
                            },
                            green: {
                                border: 'border-green-500',
                                bg: 'bg-green-500/10',
                                text: 'text-green-400'
                            }
                        };

                        const colors = colorClasses[config.color as keyof typeof colorClasses];

                        return (
                            <label
                                key={stage}
                                className={`cursor-pointer transition-all ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                <input
                                    type="radio"
                                    name="test-env"
                                    value={stage}
                                    checked={isSelected}
                                    onChange={() => !disabled && handleStageChange(stage as any)}
                                    className="sr-only peer"
                                    disabled={disabled}
                                />
                                <div
                                    className={`p-4 rounded-lg border-2 text-center transition-all ${
                                        isSelected
                                            ? `${colors.border} ${colors.bg}`
                                            : 'border-slate-600 hover:border-slate-500 bg-slate-800/30'
                                    }`}
                                >
                                    <Icon size={24} className={`w-6 h-6 mx-auto mb-2 ${colors.text}`} />
                                    <div className="text-sm font-medium text-white">{config.label}</div>
                                    <div className="text-xs text-slate-400 mt-1">{config.description}</div>
                                    <div className="text-xs text-slate-500 mt-2 font-mono truncate">
                                        {config.baseUrl}
                                    </div>
                                </div>
                            </label>
                        );
                    })}
                </div>
            </div>

            {/* Test Execution Settings Group */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 space-y-6">
                <div>
                    <h4 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                        <Database size={16} className="text-purple-400" />
                        Test Execution Settings
                    </h4>
                    
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-slate-400">Baseline Data URL</label>
                            <input
                                type="text"
                                value={environment.baseUrl}
                                onChange={(e) => {
                                    const baseUrl = e.target.value;
                                    const customerId = environment.customerId || '';
                                    onEnvironmentChange({ 
                                        ...environment, 
                                        baseUrl, 
                                        fullUrl: customerId ? `${baseUrl}${baseUrl.endsWith('/') ? '' : '/'}${customerId}#/login` : baseUrl
                                    });
                                }}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                                placeholder="https://test.globalhr.com.mm/"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-slate-400">Customer Code</label>
                            <input
                                type="text"
                                value={environment.customerId || ''}
                                onChange={(e) => {
                                    const customerId = e.target.value;
                                    const baseUrl = environment.baseUrl;
                                    onEnvironmentChange({ 
                                        ...environment, 
                                        customerId,
                                        fullUrl: customerId ? `${baseUrl}${baseUrl.endsWith('/') ? '' : '/'}${customerId}#/login` : baseUrl
                                    });
                                }}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                                placeholder="ook"
                            />
                        </div>
                    </div>
                </div>

                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-400 flex justify-between">
                        Full Navigation URL
                        <span className="text-[10px] text-slate-500">Auto-generated</span>
                    </label>
                    <div className="flex items-center gap-2 p-2 bg-slate-950/50 border border-slate-800 rounded-lg font-mono text-xs text-blue-400 break-all">
                        <Globe size={12} className="flex-shrink-0" />
                        {environment.fullUrl || environment.baseUrl}
                    </div>
                </div>

                <div className="pt-2 border-t border-slate-700/50">
                    <h5 className="text-xs font-semibold text-slate-300 mb-3 flex items-center gap-2">
                        <User size={14} className="text-amber-400" />
                        Credentials
                    </h5>
                    <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-slate-500">ID Number</label>
                            <input
                                type="text"
                                value={environment.idNumber || ''}
                                onChange={(e) => onEnvironmentChange({ ...environment, idNumber: e.target.value })}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                                placeholder="testook_HR 1"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-slate-500">Username</label>
                            <input
                                type="text"
                                value={environment.username}
                                onChange={(e) => onEnvironmentChange({ ...environment, username: e.target.value })}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                                placeholder="testook_HR 1"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-slate-500">Password</label>
                            <input
                                type="password"
                                value={environment.password}
                                onChange={(e) => onEnvironmentChange({ ...environment, password: e.target.value })}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                                placeholder="••••••••"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Execution Options Group */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 space-y-6">
                <div>
                    <h4 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                        <Zap size={16} className="text-amber-400" />
                        Execution Options
                    </h4>
                    
                    <div className="grid grid-cols-2 gap-6">
                        {/* Browser Selection */}
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-slate-400 flex items-center gap-2">
                                <Monitor size={12} /> Browser Engine
                            </label>
                            <select
                                value={environment.browser || 'chromium'}
                                onChange={(e) => onEnvironmentChange({ ...environment, browser: e.target.value as any })}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 appearance-none cursor-pointer"
                            >
                                <option value="chromium">Chromium (Chrome/Edge)</option>
                                <option value="firefox">Firefox</option>
                                <option value="webkit">Webkit (Safari)</option>
                            </select>
                        </div>

                        {/* Timeout Setting */}
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-slate-400 flex items-center gap-2">
                                <Clock size={12} /> Step Timeout (min)
                            </label>
                            <input
                                type="number"
                                value={environment.timeout || 5}
                                onChange={(e) => onEnvironmentChange({ ...environment, timeout: parseInt(e.target.value) })}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                                min="1"
                                max="30"
                            />
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    {/* Headless Toggle */}
                    <label className="flex items-center justify-between p-3 bg-slate-900/50 border border-slate-700/50 rounded-lg cursor-pointer hover:bg-slate-900 transition-colors">
                        <div className="flex flex-col">
                            <span className="text-sm font-medium text-white">Headless Mode</span>
                            <span className="text-[10px] text-slate-500">Run without browser UI</span>
                        </div>
                        <input
                            type="checkbox"
                            checked={environment.headless ?? true}
                            onChange={(e) => onEnvironmentChange({ ...environment, headless: e.target.checked })}
                            className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-900"
                        />
                    </label>

                    {/* Auto-Heal Toggle */}
                    <label className="flex items-center justify-between p-3 bg-slate-900/50 border border-slate-700/50 rounded-lg cursor-pointer hover:bg-slate-900 transition-colors">
                        <div className="flex flex-col">
                            <span className="text-sm font-medium text-white">AI Auto-Healing</span>
                            <span className="text-[10px] text-slate-500">Self-fix broken selectors</span>
                        </div>
                        <input
                            type="checkbox"
                            checked={environment.autoHeal ?? true}
                            onChange={(e) => onEnvironmentChange({ ...environment, autoHeal: e.target.checked })}
                            className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-900"
                        />
                    </label>
                </div>
            </div>

            {/* Stage Warning for Live */}
            {environment.stage === 'live' && (
                <div className="bg-red-900/20 border border-red-700 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                        <Shield size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <div className="text-sm font-medium text-red-400 mb-1">
                                ⚠️ Production Environment
                            </div>
                            <p className="text-xs text-slate-400">
                                Tests will run on the live production system. Ensure all test data is safe for production use.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
