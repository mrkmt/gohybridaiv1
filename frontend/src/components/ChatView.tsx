import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  Bot, 
  User, 
  Sparkles, 
  Maximize2, 
  Minimize2, 
  CheckCircle2, 
  AlertCircle, 
  Info,
  Database,
  Plus
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'error' | 'success';
  content: string;
  timestamp: Date;
}

interface ChatViewProps {
  currentTicket?: any;
  isExecuting?: boolean;
}

export const ChatView: React.FC<ChatViewProps> = ({
  currentTicket,
  isExecuting
}) => {
    const [messages, setMessages] = useState<Message[]>([
        { 
            id: '1', 
            role: 'assistant', 
            content: currentTicket 
                ? `I see you're working on **${currentTicket.ticketId}**: ${currentTicket.summary}. I'm ready to assist with discovery or script generation for this module.`
                : "Hello! I'm the GoHybrid AI Intelligence Engine. I can help you generate Playwright tests, verify Jira tickets, and explore your application's domain knowledge. What would you like to build today?", 
            timestamp: new Date() 
        }
    ]);
    const [input, setInput] = useState('');
    const [isWideMode, setIsWideMode] = useState(false);
    const [isTyping, setIsTyping] = useState(isExecuting || false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isTyping]);

    const handleSend = () => {
        if (!input.trim()) return;
        
        const userMsg: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: input.trim(),
            timestamp: new Date()
        };
        
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsTyping(true);
        
        // Mocking AI response for now
        setTimeout(() => {
            setIsTyping(false);
            const aiMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: "I'm analyzing your request. I've detected a reference to **Jira ATT-7**. Would you like me to start the reproduction flow?",
                timestamp: new Date()
            };
            setMessages(prev => [...prev, aiMsg]);
        }, 1500);
    };

    const getMessageIcon = (role: Message['role']) => {
        switch (role) {
            case 'assistant': return <Bot className="h-4 w-4 text-blue-400" />;
            case 'user': return <User className="h-4 w-4 text-slate-300" />;
            case 'system': return <Database className="h-4 w-4 text-amber-400" />;
            case 'error': return <AlertCircle className="h-4 w-4 text-red-500" />;
            case 'success': return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
            default: return <Info className="h-4 w-4" />;
        }
    };

    return (
        <div className="flex h-full flex-col relative">
            {/* Chat Toolbar */}
            <div className="absolute top-4 right-8 z-20 flex items-center gap-2">
                <button
                    onClick={() => setIsWideMode(!isWideMode)}
                    className="flex h-9 items-center gap-2 px-3 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 text-xs font-medium text-slate-400 hover:text-white transition-all backdrop-blur-sm shadow-lg"
                >
                    {isWideMode ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                    <span>{isWideMode ? 'Compact View' : 'Wide View'}</span>
                </button>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto px-6 py-8 custom-scrollbar">
                <div className={cn(
                    "mx-auto space-y-8 transition-all duration-500",
                    isWideMode ? "max-w-[1600px]" : "max-w-4xl"
                )}>
                    {messages.map((msg) => (
                        <div key={msg.id} className={cn(
                            "group flex gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500",
                            msg.role === 'user' ? "flex-row-reverse" : "flex-row"
                        )}>
                            {/* Avatar */}
                            <div className={cn(
                                "flex h-10 w-10 shrink-0 select-none items-center justify-center rounded-xl border shadow-sm transition-transform group-hover:scale-105",
                                msg.role === 'user' 
                                    ? "bg-slate-800 border-slate-700" 
                                    : msg.role === 'error'
                                    ? "bg-red-500/10 border-red-500/30"
                                    : "bg-blue-600/10 border-blue-500/30 shadow-blue-500/10"
                            )}>
                                {getMessageIcon(msg.role)}
                            </div>

                            {/* Bubble */}
                            <div className={cn(
                                "flex min-w-0 flex-col gap-1",
                                msg.role === 'user' ? "items-end" : "items-start"
                            )}>
                                <div className={cn(
                                    "max-w-full rounded-2xl px-5 py-4 text-sm leading-relaxed shadow-sm ring-1",
                                    msg.role === 'user'
                                        ? "bg-blue-600/10 ring-blue-500/20 text-blue-100"
                                        : msg.role === 'error'
                                        ? "bg-red-500/5 ring-red-500/20 text-red-200"
                                        : "bg-slate-800/40 backdrop-blur-sm ring-slate-700/30 text-slate-100"
                                )}>
                                    <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap">
                                        {msg.content}
                                    </div>
                                    
                                    {/* Action Chips (Example) */}
                                    {msg.role === 'assistant' && msg.id === '1' && (
                                        <div className="mt-4 flex flex-wrap gap-2">
                                            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-xs font-semibold text-blue-400 hover:bg-blue-500/20 transition-all">
                                                <Sparkles className="h-3 w-3" />
                                                Generate ATT-7 Test
                                            </button>
                                            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-700/30 border border-slate-600/50 text-xs font-semibold text-slate-300 hover:bg-slate-700/50 transition-all">
                                                <Database className="h-3 w-3" />
                                                View Knowledge Base
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <span className="text-[10px] font-medium text-slate-500 uppercase tracking-widest px-1">
                                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                        </div>
                    ))}

                    {isTyping && (
                        <div className="flex gap-4 animate-pulse">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/10 border border-blue-500/30">
                                <Bot className="h-4 w-4 text-blue-400" />
                            </div>
                            <div className="flex bg-slate-800/40 rounded-2xl px-5 py-4 gap-1.5 items-center ring-1 ring-slate-700/30">
                                <div className="h-1.5 w-1.5 rounded-full bg-blue-400/60 animate-bounce" />
                                <div className="h-1.5 w-1.5 rounded-full bg-blue-400/60 animate-bounce [animation-delay:0.2s]" />
                                <div className="h-1.5 w-1.5 rounded-full bg-blue-400/60 animate-bounce [animation-delay:0.4s]" />
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
            </div>

            {/* Input Area */}
            <div className="p-6">
                <div className={cn(
                    "mx-auto transition-all duration-500",
                    isWideMode ? "max-w-[1600px]" : "max-w-4xl"
                )}>
                    <div className="relative group">
                        <div className="absolute -inset-1 rounded-[2.2rem] bg-gradient-to-r from-blue-600 to-indigo-600 opacity-20 blur transition duration-500 group-focus-within:opacity-40" />
                        <div className="relative flex items-end gap-3 rounded-[2rem] bg-slate-900 border border-slate-800 p-3 shadow-2xl transition-all focus-within:border-blue-500/50">
                            <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-all">
                                <Plus className="h-5 w-5" />
                            </button>
                            <textarea
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSend();
                                    }
                                }}
                                placeholder="Message GoHybrid Engine..."
                                className="flex-1 max-h-48 min-h-[44px] bg-transparent border-none focus:ring-0 text-slate-100 placeholder:text-slate-500 py-3 resize-none custom-scrollbar text-sm"
                                rows={1}
                            />
                            <button 
                                onClick={handleSend}
                                disabled={!input.trim() || isTyping}
                                className={cn(
                                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all",
                                    input.trim() && !isTyping
                                        ? "bg-blue-600 text-white shadow-lg shadow-blue-900/40 hover:scale-105 active:scale-95"
                                        : "bg-slate-800 text-slate-600"
                                )}
                            >
                                <Send className="h-5 w-5" />
                            </button>
                        </div>
                    </div>
                    <div className="mt-3 flex justify-center items-center gap-4 text-[11px] font-medium text-slate-600 tracking-wider">
                        <div className="flex items-center gap-1.5">
                            <span className="h-1 w-1 rounded-full bg-slate-700" />
                            GPT-4o / Qwen 2.5
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="h-1 w-1 rounded-full bg-slate-700" />
                            System Ver: 1.1.0
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
