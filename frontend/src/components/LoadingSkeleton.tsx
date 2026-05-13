/**
 * LoadingSkeleton Component
 * 
 * Reusable loading skeleton for consistent loading states across the application.
 * Replaces ad-hoc loading indicators with a polished, accessible component.
 * 
 * @author Cline AI Assistant
 * @date April 6, 2026
 */

import React from 'react';

interface LoadingSkeletonProps {
    lines?: number;
    width?: string;
    height?: string;
    className?: string;
    variant?: 'text' | 'card' | 'table' | 'list';
    pulse?: boolean;
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({
    lines = 3,
    width = '100%',
    height = '16px',
    className = '',
    variant = 'text',
    pulse = true
}) => {
    const animationStyle = pulse ? {
        animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        background: 'linear-gradient(90deg, rgba(255,255,255,0.05) 25%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.05) 75%)',
        backgroundSize: '200% 100%'
    } : {
        background: 'rgba(255,255,255,0.05)'
    };

    if (variant === 'card') {
        return (
            <div className={`loading-skeleton loading-skeleton--card ${className}`} style={{ 
                padding: '20px', 
                borderRadius: '12px', 
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.05)'
            }}>
                {/* Header */}
                <div style={{ 
                    height: '24px', 
                    width: '60%', 
                    marginBottom: '16px',
                    borderRadius: '6px',
                    ...animationStyle 
                }} />
                {/* Body lines */}
                {[...Array(lines)].map((_, i) => (
                    <div key={i} style={{ 
                        height, 
                        width: i === lines - 1 ? '80%' : width, 
                        marginBottom: '12px',
                        borderRadius: '4px',
                        ...animationStyle 
                    }} />
                ))}
            </div>
        );
    }

    if (variant === 'table') {
        return (
            <div className={`loading-skeleton loading-skeleton--table ${className}`}>
                {/* Table headers */}
                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    {[...Array(4)].map((_, i) => (
                        <div key={i} style={{ 
                            height: '14px', 
                            width: i === 0 ? '20%' : i === 1 ? '40%' : '20%',
                            borderRadius: '4px',
                            ...animationStyle 
                        }} />
                    ))}
                </div>
                {/* Table rows */}
                {[...Array(lines)].map((_, rowIdx) => (
                    <div key={rowIdx} style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                        {[...Array(4)].map((_, colIdx) => (
                            <div key={colIdx} style={{ 
                                height: '16px', 
                                width: colIdx === 0 ? '20%' : colIdx === 1 ? '40%' : '20%',
                                borderRadius: '4px',
                                ...animationStyle 
                            }} />
                        ))}
                    </div>
                ))}
            </div>
        );
    }

    if (variant === 'list') {
        return (
            <div className={`loading-skeleton loading-skeleton--list ${className}`} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {[...Array(lines)].map((_, i) => (
                    <div key={i} style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '12px',
                        padding: '12px',
                        borderRadius: '8px',
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.05)'
                    }}>
                        <div style={{ 
                            width: '40px', 
                            height: '40px', 
                            borderRadius: '8px',
                            ...animationStyle 
                        }} />
                        <div style={{ flex: 1 }}>
                            <div style={{ 
                                height: '16px', 
                                width: '60%', 
                                marginBottom: '8px',
                                borderRadius: '4px',
                                ...animationStyle 
                            }} />
                            <div style={{ 
                                height: '12px', 
                                width: '40%', 
                                borderRadius: '4px',
                                ...animationStyle 
                            }} />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    // Default text variant
    return (
        <div className={`loading-skeleton loading-skeleton--text ${className}`} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {[...Array(lines)].map((_, i) => (
                <div key={i} style={{ 
                    height, 
                    width: i === lines - 1 ? '80%' : width,
                    borderRadius: '4px',
                    ...animationStyle 
                }} />
            ))}
        </div>
    );
};

export default LoadingSkeleton;