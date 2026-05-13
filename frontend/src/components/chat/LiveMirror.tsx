import React, { useState } from 'react';
import { MousePointer2, Crosshair, ZoomIn, Maximize } from 'lucide-react';

interface LiveMirrorProps {
    screenshot: string | null;
    elements: any[];
    onAction: (action: string, target: any) => void;
}

export function LiveMirror({ screenshot, elements, onAction }: LiveMirrorProps) {
    const [isHovering, setIsHovering] = useState(false);

    if (!screenshot) return null;

    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 1280; // Scale to original browser size
        const y = ((e.clientY - rect.top) / rect.height) * 720;
        
        onAction('CLICK_COORDS', { x, y });
    };

    return (
        <div 
            style={{
                position: 'relative',
                width: '100%',
                borderRadius: '16px',
                overflow: 'hidden',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                background: '#000',
                cursor: 'crosshair',
                boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
            }}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
            onClick={handleClick}
        >
            <img 
                src={screenshot} 
                alt="Live Vision" 
                style={{ width: '100%', display: 'block', opacity: isHovering ? 0.8 : 1, transition: '0.3s' }} 
            />

            {/* AI Detected Elements Overlay */}
            {elements.map((el, i) => (
                <div 
                    key={i}
                    style={{
                        position: 'absolute',
                        left: `${(el.rect.x / 1280) * 100}%`,
                        top: `${(el.rect.y / 720) * 100}%`,
                        width: `${(el.rect.w / 1280) * 100}%`,
                        height: `${(el.rect.h / 720) * 100}%`,
                        border: '1px solid rgba(56, 189, 248, 0.5)',
                        background: 'rgba(56, 189, 248, 0.1)',
                        pointerEvents: 'none'
                    }}
                />
            ))}

            {/* Status Bar */}
            <div style={{
                position: 'absolute',
                top: 12,
                left: 12,
                padding: '6px 12px',
                background: 'rgba(15, 23, 42, 0.8)',
                backdropFilter: 'blur(8px)',
                borderRadius: '8px',
                fontSize: '10px',
                fontWeight: 700,
                color: '#38bdf8',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
            }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#38bdf8', animation: 'pulse 2s infinite' }} />
                Interactive Digital Detective Feed
            </div>

            {isHovering && (
                <div style={{
                    position: 'absolute',
                    bottom: 12,
                    right: 12,
                    padding: '6px 12px',
                    background: '#38bdf8',
                    borderRadius: '8px',
                    fontSize: '10px',
                    fontWeight: 800,
                    color: '#000'
                }}>
                    CLICK TO ASSIST AI
                </div>
            )}
        </div>
    );
}
