'use client';

import { useEffect, useRef, useState } from 'react';
import { API_BASE_URL, getAccessToken, getSessionClientId } from '../../lib/api-client';

type MessageRole = 'user' | 'assistant';

type ChatMessage = {
  id: string;
  role: MessageRole;
  text: string;
};

type ChatState = 'idle' | 'streaming' | 'error';

const SUGGESTED_QUESTIONS = [
  'How are sales today?',
  'Which items are low in stock?',
  'Show me this month\'s sales summary',
  'List customers with outstanding balance',
  'What are the recent stock transfers?'
];

function makeId(): string {
  return Math.random().toString(36).slice(2);
}

export function ChatWidget(): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [state, setState] = useState<ChatState>('idle');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || state === 'streaming') return;

    const userMsg: ChatMessage = { id: makeId(), role: 'user', text: trimmed };
    const assistantId = makeId();
    const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', text: '' };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setState('streaming');

    const token = getAccessToken();
    const clientId = getSessionClientId();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch(`${API_BASE_URL}/chat/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token ?? ''}`,
          'X-Client-Id': clientId
        },
        body: JSON.stringify({ message: trimmed }),
        signal: ctrl.signal
      });

      if (!res.ok || !res.body) {
        throw new Error(`API error (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') break;
          if (payload.startsWith('[ERROR]')) {
            throw new Error(payload.slice(8));
          }
          const chunk = payload.replace(/\\n/g, '\n');
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + chunk } : m))
          );
        }
      }

      setState('idle');
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        setState('idle');
        return;
      }
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, text: `Error: ${msg}` } : m))
      );
      setState('error');
    } finally {
      abortRef.current = null;
    }
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    void sendMessage(input);
  }

  function handleStop(): void {
    abortRef.current?.abort();
    setState('idle');
  }

  function handleClear(): void {
    if (state === 'streaming') return;
    setMessages([]);
    setState('idle');
  }

  const isEmpty = messages.length === 0;

  return (
    <>
      {/* Floating trigger button */}
      <button
        aria-label={open ? 'Close AI assistant' : 'Open AI assistant'}
        className="fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-all hover:bg-blue-700 active:scale-95 dark:bg-blue-500 dark:hover:bg-blue-600"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        {open ? (
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-20 right-5 z-50 flex w-[360px] max-w-[calc(100vw-2.5rem)] flex-col rounded-2xl border border-slate-200/80 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          {/* Header */}
          <div className="flex items-center gap-2.5 rounded-t-2xl border-b border-slate-200/70 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-white">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path
                  d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Business Assistant
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Answers from your live data only
              </p>
            </div>
            {messages.length > 0 && state !== 'streaming' && (
              <button
                className="rounded px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                onClick={handleClear}
                type="button"
              >
                Clear
              </button>
            )}
          </div>

          {/* Messages */}
          <div className="flex h-[360px] flex-col gap-3 overflow-y-auto px-4 py-3">
            {isEmpty && (
              <div className="mt-2 flex flex-col gap-2">
                <p className="text-xs text-slate-400 dark:text-slate-500">Try asking:</p>
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-blue-600 dark:hover:bg-blue-950 dark:hover:text-blue-300"
                    key={q}
                    onClick={() => void sendMessage(q)}
                    type="button"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {messages.map((msg) => (
              <div
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                key={msg.id}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white dark:bg-blue-500'
                      : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
                  }`}
                >
                  {msg.text === '' && msg.role === 'assistant' ? (
                    <span className="inline-flex gap-0.5">
                      <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
                      <span className="animate-bounce" style={{ animationDelay: '120ms' }}>.</span>
                      <span className="animate-bounce" style={{ animationDelay: '240ms' }}>.</span>
                    </span>
                  ) : (
                    <span style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</span>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="rounded-b-2xl border-t border-slate-200/70 px-3 py-3 dark:border-slate-700">
            <form className="flex items-center gap-2" onSubmit={handleSubmit}>
              <input
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-blue-500 dark:focus:ring-blue-950"
                disabled={state === 'streaming'}
                maxLength={500}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about your business data…"
                ref={inputRef}
                type="text"
                value={input}
              />
              {state === 'streaming' ? (
                <button
                  className="flex h-8 w-8 items-center justify-center rounded-xl bg-red-100 text-red-600 transition-colors hover:bg-red-200 dark:bg-red-900/40 dark:text-red-400 dark:hover:bg-red-900/70"
                  onClick={handleStop}
                  title="Stop"
                  type="button"
                >
                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <rect height="12" rx="2" width="12" x="6" y="6" />
                  </svg>
                </button>
              ) : (
                <button
                  className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-blue-500 dark:hover:bg-blue-600"
                  disabled={!input.trim()}
                  type="submit"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
