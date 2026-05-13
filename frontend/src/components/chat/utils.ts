import {
    Zap,
    Shield,
    HelpCircle,
    Layout,
    Activity,
} from 'lucide-react';

/** Simple markdown-ish render (XSS-safe) */
export function md(text: string) {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    let h = esc(text)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code style="background:rgba(138,180,248,0.1);padding:1px 5px;border-radius:4px;font-size:0.88em;font-family:JetBrains Mono,monospace;color:#8ab4f8">$1</code>')
        .replace(/\n/g, '<br/>');
    return h;
}

export const TYPE_ICONS: Record<string, any> = {
    positive: Zap,
    negative: Shield,
    edge_case: HelpCircle,
    ui_validation: Layout,
    workflow: Activity,
    regression: Shield,
    smoke: Zap,
};

export const TYPE_COLORS: Record<string, string> = {
    positive: '#10b981',
    negative: '#ef4444',
    edge_case: '#f59e0b',
    ui_validation: '#3b82f6',
    workflow: '#8b5cf6',
    regression: '#6366f1',
    smoke: '#10b981',
};

export const formatTime = (ts: string) => {
    try { const d = new Date(ts); return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
};

export const formatDate = (ts: number) => {
    try {
        const d = new Date(ts);
        if (isNaN(d.getTime())) return '';
        const now = new Date();
        if (d.toDateString() === now.toDateString()) return 'Today';
        const y = new Date(now); y.setDate(now.getDate() - 1);
        if (d.toDateString() === y.toDateString()) return 'Yesterday';
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return ''; }
};
