import React, { useState } from 'react';
import { ArrowRight, HelpCircle, Loader2, Send, X } from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import type { AppRoute } from '../../types/index.ts';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  suggestedRoute?: AppRoute;
}

const QUICK_PROMPTS = [
  'How do I split a bill item-wise?',
  'Why do I owe this amount?',
  'How do I invite via QR code?',
  'How do I settle my balance?',
];

export const AiHelpAssistant: React.FC<{ onNavigate: (route: AppRoute) => void }> = ({ onNavigate }) => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      text: 'Hi! Ask me anything about creating groups, item-wise splitting (like Tea, Coffee & Samosas), balances, or UPI QR settlements.',
    },
  ]);

  const askQuestion = async (q: string) => {
    const clean = q.trim();
    if (!clean || loading) return;
    setMessages((prev) => [...prev, { role: 'user', text: clean }]);
    setInput('');
    setLoading(true);
    try {
      const res = await apiRequest<{ answer: string; suggestedRoute?: AppRoute }>('/api/assistant', {
        method: 'POST',
        body: JSON.stringify({ question: clean }),
      });
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: res.answer, suggestedRoute: res.suggestedRoute },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: 'I could not reach the help service right now. You can open Help Centre or visit Add Expense / Balances from the sidebar.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-40 no-print">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-full shadow-lg cursor-pointer transition-transform hover:scale-[1.02]"
          aria-label="Open SettleUp AI Help Assistant"
        >
          <HelpCircle className="w-4 h-4 text-emerald-400" />
          <span>SettleUp Help</span>
        </button>
      ) : (
        <div className="w-[340px] sm:w-[380px] bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[520px]">
          <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-emerald-400" />
              <span className="font-display text-sm font-bold">SettleUp Help Assistant</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close help assistant"
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3.5 space-y-3 overflow-y-auto flex-1 bg-[#F8FAFC]">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-xl text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-[#065F46] text-white ml-8'
                    : 'bg-white border border-slate-200 text-slate-700 mr-4'
                }`}
              >
                <p>{m.text}</p>
                {m.suggestedRoute && (
                  <button
                    type="button"
                    onClick={() => {
                      onNavigate(m.suggestedRoute!);
                      setOpen(false);
                    }}
                    className="mt-2 inline-flex items-center gap-1 font-semibold text-[#065F46] hover:underline cursor-pointer"
                  >
                    <span>Open relevant screen</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
            {loading && (
              <div className="p-3 rounded-xl bg-white border border-slate-200 text-xs text-slate-500 mr-8 inline-flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Thinking...</span>
              </div>
            )}
          </div>

          {/* Quick prompts */}
          <div className="px-3 py-2 border-t border-slate-200 bg-white flex gap-1.5 overflow-x-auto no-scrollbar">
            {QUICK_PROMPTS.map((qp) => (
              <button
                key={qp}
                type="button"
                onClick={() => askQuestion(qp)}
                className="px-2.5 py-1 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md whitespace-nowrap cursor-pointer"
              >
                {qp}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              askQuestion(input);
            }}
            className="p-2.5 border-t border-slate-200 bg-white flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask how SettleUp works..."
              className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:border-[#065F46] focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              aria-label="Send question"
              className="p-2 bg-[#065F46] text-white rounded-lg hover:bg-[#047857] disabled:opacity-50 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
