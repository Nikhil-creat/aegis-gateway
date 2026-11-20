import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { SUGGESTED_QUESTIONS } from '../../lib/assistant-kb';
import { Close, Loader, ArrowUp } from '../icons';
import { ApiError, run } from '../lib/client';

interface Msg {
  role: 'user' | 'bot';
  text: string;
  meta?: string;
  cites?: string[];
  refused?: boolean;
}

const usd = (n: number) => (n === 0 ? '$0' : `$${n.toFixed(6)}`);

export default function Assistant({ onClose }: { onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => { field.current?.focus(); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    try {
      const { res, via } = await run({ prompt: text, policy: 'smart-router', mode: 'assistant', chaos: null });
      const refused = res.answer.startsWith('Insufficient grounded context');
      const meta = refused ? 'No model called' : `${res.model} · ${res.tier} · ${res.latency_ms} ms · ${usd(res.cost_usd)} · ${via === 'api' ? 'server' : 'in-browser demo engine'}`;
      setMsgs((m) => [...m, { role: 'bot', text: refused ? 'I only know about Nikhil, his projects and credentials, and how this gateway works, and I could not find that in my notes. Try one of the suggestions, or email Nikhil directly.' : res.answer, meta, cites: res.citations, refused }]);
    } catch (e) {
      const limited = e instanceof ApiError && e.status === 429;
      setMsgs((m) => [...m, { role: 'bot', text: limited ? 'Too many questions in a short time. Wait a few seconds and ask again.' : 'The gateway returned an error. Please try again.', refused: true }]);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => { e.preventDefault(); void ask(input); };

  return (
    <div role="dialog" aria-modal="false" aria-label="Ask Aegis assistant" className="fixed inset-x-3 bottom-20 z-50 flex max-h-[min(36rem,calc(100svh-7rem))] flex-col border border-gray-200 bg-white shadow-2xl sm:inset-x-auto sm:right-5 sm:w-[24rem]">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div>
          <p className="font-serif text-lg tracking-tight">Ask Aegis</p>
          <p className="text-[11px] text-ink/50">Answers from a small knowledge base, with sources</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close assistant" className="p-1.5 text-ink/60 hover:text-ink"><Close className="h-5 w-5" /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" aria-live="polite">
        {msgs.length === 0 && (
          <div>
            <p className="text-sm leading-relaxed text-ink/70">Ask about Nikhil&apos;s projects, credentials and skills, or how this gateway routes and fails over. Out-of-scope questions are refused, not guessed.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => void ask(s)} className="rounded-full border border-gray-200 px-3 py-1.5 text-left text-xs text-ink/75 hover:border-ink hover:text-ink transition-colors duration-200">{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div className={m.role === 'user' ? 'max-w-[85%] bg-ink px-3 py-2 text-sm text-white' : 'max-w-full'}>
              <p className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${m.role === 'bot' ? (m.refused ? 'text-ink/70' : 'text-ink') : ''}`}>{m.text}</p>
              {m.cites && m.cites.length > 0 && <p className="mt-2 font-mono text-[11px] text-emerald-700">sources: {m.cites.join(' ')}</p>}
              {m.meta && <p className="mt-1 font-mono text-[10px] text-ink/40">{m.meta}</p>}
            </div>
          </div>
        ))}
        {busy && <p className="flex items-center gap-2 text-xs text-ink/50"><Loader className="h-3.5 w-3.5 animate-spin" /> Retrieving and routing…</p>}
        <div ref={end} />
      </div>

      <form onSubmit={submit} className="flex items-center gap-2 border-t border-gray-200 p-3">
        <label htmlFor="assistant-input" className="sr-only">Your question</label>
        <input id="assistant-input" ref={field} value={input} onChange={(e) => setInput(e.target.value)} maxLength={300} placeholder="Ask a question…" autoComplete="off" className="min-w-0 flex-1 border border-gray-200 px-3 py-2.5 text-sm focus:border-ink focus:outline-none" />
        <button type="submit" disabled={busy || !input.trim()} aria-label="Send question" className="flex h-10 w-10 items-center justify-center bg-ink text-white disabled:opacity-40 transition-opacity"><ArrowUp className="h-4 w-4" /></button>
      </form>
      <p className="border-t border-gray-100 px-4 py-2 text-[10px] leading-snug text-ink/40">Each question is answered independently (no chat memory). Without provider keys, a deterministic mock model composes the answer.</p>
    </div>
  );
}
