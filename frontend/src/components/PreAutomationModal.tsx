/**
 * PreAutomationModal Component
 * 
 * Configuration modal for test execution settings
 * Allows user to set browser, URL, user role, and credentials before execution
 * 
 * @author Qwen AI Assistant
 * @date March 29, 2026
 */

import React, { useState } from 'react';

export interface ExecutionConfig {
    browser: 'chromium' | 'firefox' | 'webkit';
    baseUrl: string;
    headless: boolean;
    role: 'admin' | 'staff' | 'guest';
    username: string;
    password: string;
    idNumber?: string;
}

interface PreAutomationModalProps {
    isOpen: boolean;
    onConfirm: (config: ExecutionConfig) => void;
    onCancel: () => void;
    defaultConfig?: Partial<ExecutionConfig>;
}

export const PreAutomationModal: React.FC<PreAutomationModalProps> = ({
    isOpen,
    onConfirm,
    onCancel,
    defaultConfig
}) => {
    const [config, setConfig] = useState<ExecutionConfig>({
        browser: defaultConfig?.browser || 'chromium',
        baseUrl: defaultConfig?.baseUrl || 'https://test.globalhr.com.mm/ook',
        headless: defaultConfig?.headless ?? false,
        role: defaultConfig?.role || 'admin',
        username: defaultConfig?.username || '',
        password: defaultConfig?.password || '',
        idNumber: defaultConfig?.idNumber || ''
    });

    const [showPassword, setShowPassword] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onConfirm(config);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
            <div 
                className="bg-slate-900 rounded-2xl w-full max-w-lg mx-4 shadow-2xl border border-slate-700"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-700">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <span>⚙️</span>
                        Test Configuration
                    </h2>
                    <p className="text-slate-400 text-sm mt-1">
                        Configure execution settings before starting tests
                    </p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    {/* Browser Selection */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-300 mb-2">
                            🌐 Browser
                        </label>
                        <div className="grid grid-cols-3 gap-3">
                            {(['chromium', 'firefox', 'webkit'] as const).map((browser) => (
                                <button
                                    key={browser}
                                    type="button"
                                    onClick={() => setConfig({ ...config, browser })}
                                    className={`
                                        px-4 py-3 rounded-xl font-semibold text-sm transition-all
                                        ${config.browser === browser
                                            ? 'bg-blue-600 text-white ring-2 ring-blue-400'
                                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                        }
                                    `}
                                >
                                    {browser === 'chromium' && '🌑 '}
                                    {browser === 'firefox' && '🦊 '}
                                    {browser === 'webkit' && '🧭 '}
                                    {browser.charAt(0).toUpperCase() + browser.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Base URL */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-300 mb-2">
                            🔗 Base URL
                        </label>
                        <input
                            type="url"
                            value={config.baseUrl}
                            onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                            className="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl 
                                     text-white placeholder-slate-500 focus:outline-none focus:ring-2 
                                     focus:ring-blue-500 focus:border-transparent transition-all"
                            placeholder="https://test.globalhr.com.mm/ook"
                            required
                        />
                    </div>

                    {/* Headless Mode */}
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-semibold text-slate-300">
                            👻 Headless Mode (no browser UI)
                        </label>
                        <button
                            type="button"
                            onClick={() => setConfig({ ...config, headless: !config.headless })}
                            className={`
                                relative w-14 h-7 rounded-full transition-colors
                                ${config.headless ? 'bg-blue-600' : 'bg-slate-700'}
                            `}
                        >
                            <span
                                className={`
                                    absolute top-1 w-5 h-5 bg-white rounded-full transition-transform
                                    ${config.headless ? 'left-8' : 'left-1'}
                                `}
                            />
                        </button>
                    </div>

                    {/* User Role */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-300 mb-2">
                            👤 User Role
                        </label>
                        <div className="grid grid-cols-3 gap-3">
                            {(['admin', 'staff', 'guest'] as const).map((role) => (
                                <button
                                    key={role}
                                    type="button"
                                    onClick={() => setConfig({ ...config, role })}
                                    className={`
                                        px-4 py-3 rounded-xl font-semibold text-sm transition-all
                                        ${config.role === role
                                            ? 'bg-emerald-600 text-white ring-2 ring-emerald-400'
                                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                        }
                                    `}
                                >
                                    {role === 'admin' && '👑 '}
                                    {role === 'staff' && '👤 '}
                                    {role === 'guest' && '👻 '}
                                    {role.charAt(0).toUpperCase() + role.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Credentials */}
                    <div className="space-y-4 pt-4 border-t border-slate-700">
                        <h3 className="text-sm font-semibold text-slate-300">
                            🔐 Login Credentials
                        </h3>

                        {/* ID Number (optional) */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-400 mb-2">
                                ID Number <span className="text-slate-600">(Optional)</span>
                            </label>
                            <input
                                type="text"
                                value={config.idNumber || ''}
                                onChange={(e) => setConfig({ ...config, idNumber: e.target.value })}
                                className="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl 
                                         text-white placeholder-slate-500 focus:outline-none focus:ring-2 
                                         focus:ring-blue-500 focus:border-transparent transition-all"
                                placeholder="e.g., 123456"
                            />
                        </div>

                        {/* Username */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-400 mb-2">
                                Username <span className="text-rose-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={config.username}
                                onChange={(e) => setConfig({ ...config, username: e.target.value })}
                                className="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl 
                                         text-white placeholder-slate-500 focus:outline-none focus:ring-2 
                                         focus:ring-blue-500 focus:border-transparent transition-all"
                                placeholder="Enter username"
                                required
                            />
                        </div>

                        {/* Password */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-400 mb-2">
                                Password <span className="text-rose-500">*</span>
                            </label>
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={config.password}
                                    onChange={(e) => setConfig({ ...config, password: e.target.value })}
                                    className="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl 
                                             text-white placeholder-slate-500 focus:outline-none focus:ring-2 
                                             focus:ring-blue-500 focus:border-transparent transition-all pr-12"
                                    placeholder="Enter password"
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 
                                             hover:text-slate-300 transition-colors"
                                >
                                    {showPassword ? '🙈' : '👁️'}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-3 pt-4 border-t border-slate-700">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="flex-1 px-6 py-3 bg-slate-800 text-slate-300 rounded-xl 
                                     font-semibold hover:bg-slate-700 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 
                                     text-white rounded-xl font-semibold hover:from-blue-700 hover:to-blue-800 
                                     transition-all shadow-lg shadow-blue-600/30"
                        >
                            🚀 Start Test Execution
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default PreAutomationModal;
