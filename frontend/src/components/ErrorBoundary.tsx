/**
 * ErrorBoundary Component
 * 
 * Catches JavaScript errors in child components and displays a fallback UI.
 * Provides error recovery options and detailed error information for debugging.
 * 
 * @author Cline AI Assistant
 * @date April 6, 2026
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Copy, Home, Bug } from 'lucide-react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
    componentName?: string;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
    copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null,
            copied: false
        };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        this.setState({ errorInfo });
        
        // Log to console in development
        if (import.meta.env.VITE_ENV === 'development') {
            console.error(`[ErrorBoundary:${this.props.componentName || 'unknown'}]`, error, errorInfo);
        }

        // Call optional error handler
        this.props.onError?.(error, errorInfo);

        // Could send to error tracking service (Sentry, etc.)
        // reportError(error, errorInfo);
    }

    handleReset = (): void => {
        this.setState({ hasError: false, error: null, errorInfo: null, copied: false });
    };

    handleCopyError = async (): Promise<void> => {
        const { error, errorInfo } = this.state;
        if (!error) return;

        const errorText = `
Error: ${error.message}
Component: ${this.props.componentName || 'unknown'}
Stack: ${error.stack}
${errorInfo ? `Component Stack: ${errorInfo.componentStack}` : ''}
        `.trim();

        try {
            await navigator.clipboard.writeText(errorText);
            this.setState({ copied: true });
            setTimeout(() => this.setState({ copied: false }), 2000);
        } catch {
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = errorText;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            this.setState({ copied: true });
            setTimeout(() => this.setState({ copied: false }), 2000);
        }
    };

    render(): ReactNode {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            const { error, errorInfo, copied } = this.state;
            const isDevelopment = import.meta.env.VITE_ENV === 'development';

            return (
                <div
                    role="alert"
                    aria-live="assertive"
                    style={{
                        padding: '24px',
                        margin: '16px',
                        borderRadius: '12px',
                        background: 'rgba(239, 68, 68, 0.05)',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        color: '#fecaca',
                        fontFamily: "'Inter', system-ui, sans-serif"
                    }}
                >
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                        <AlertTriangle size={24} color="#ef4444" />
                        <div>
                            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#fee2e2' }}>
                                {this.props.componentName ? `${this.props.componentName} Error` : 'Something went wrong'}
                            </h3>
                            <p style={{ margin: 0, fontSize: '13px', color: '#fca5a5', opacity: 0.8 }}>
                                An unexpected error occurred in this component
                            </p>
                        </div>
                    </div>

                    {/* Error Message */}
                    <div style={{
                        padding: '12px 16px',
                        background: 'rgba(0, 0, 0, 0.2)',
                        borderRadius: '8px',
                        marginBottom: '16px',
                        fontFamily: 'monospace',
                        fontSize: '13px',
                        overflow: 'auto',
                        maxHeight: '120px'
                    }}>
                        {error?.message || 'Unknown error'}
                    </div>

                    {/* Development Details */}
                    {isDevelopment && errorInfo && (
                        <details style={{ marginBottom: '16px' }}>
                            <summary style={{
                                cursor: 'pointer',
                                fontSize: '12px',
                                color: '#f87171',
                                marginBottom: '8px',
                                display: 'inline-block'
                            }}>
                                View Component Stack
                            </summary>
                            <pre style={{
                                padding: '12px 16px',
                                background: 'rgba(0, 0, 0, 0.3)',
                                borderRadius: '8px',
                                fontSize: '11px',
                                overflow: 'auto',
                                maxHeight: '200px',
                                margin: 0,
                                color: '#94a3b8'
                            }}>
                                {errorInfo.componentStack}
                            </pre>
                        </details>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                            onClick={this.handleReset}
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '8px 16px',
                                borderRadius: '8px',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                background: 'rgba(255, 255, 255, 0.05)',
                                color: '#e2e8f0',
                                fontSize: '13px',
                                fontWeight: 500,
                                cursor: 'pointer'
                            }}
                            aria-label="Try again"
                        >
                            <RefreshCw size={14} /> Try Again
                        </button>

                        <button
                            onClick={this.handleCopyError}
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '8px 16px',
                                borderRadius: '8px',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                background: 'rgba(255, 255, 255, 0.05)',
                                color: copied ? '#10b981' : '#e2e8f0',
                                fontSize: '13px',
                                fontWeight: 500,
                                cursor: 'pointer'
                            }}
                            aria-label={copied ? 'Error details copied' : 'Copy error details'}
                        >
                            <Copy size={14} /> {copied ? 'Copied!' : 'Copy Error'}
                        </button>

                        {isDevelopment && (
                            <button
                                onClick={() => window.location.href = '/'}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '8px 16px',
                                    borderRadius: '8px',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    background: 'rgba(255, 255, 255, 0.05)',
                                    color: '#e2e8f0',
                                    fontSize: '13px',
                                    fontWeight: 500,
                                    cursor: 'pointer'
                                }}
                                aria-label="Go to home page"
                            >
                                <Home size={14} /> Home
                            </button>
                        )}
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;