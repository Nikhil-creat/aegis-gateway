import { useState } from 'react';
import type { FormEvent } from 'react';
import { SITE } from '../../site.config';
import { Check, Loader } from '../icons';

type State = 'idle' | 'sending' | 'sent' | 'mailto' | 'error';

export default function Contact() {
  const [state, setState] = useState<State>('idle');
  const [msg, setMsg] = useState('');

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { name: String(f.get('name') ?? ''), email: String(f.get('email') ?? ''), message: String(f.get('message') ?? ''), website: String(f.get('website') ?? '') };
    setState('sending');
    try {
      const r = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      const ct = r.headers.get('content-type') ?? '';
      if (!ct.includes('json')) throw new Error('no api');
      const j = await r.json();
      if (r.status === 422) { setMsg('Please enter your name, a valid email and a message of at least 10 characters.'); setState('error'); return; }
      if (r.status === 429) { setMsg('Too many messages from this network. Try again in a few minutes, or email directly.'); setState('error'); return; }
      if (r.ok && j.delivered) { setState('sent'); return; }
      throw new Error('not delivered');
    } catch {
      // No mail backend configured (or unreachable): hand the message to the visitor's mail app instead of losing it.
      const url = `mailto:${SITE.author.email}?subject=${encodeURIComponent(`Message from ${body.name} via the Aegis site`)}&body=${encodeURIComponent(`${body.message}\n\n${body.name} <${body.email}>`)}`;
      window.location.href = url;
      setState('mailto');
    }
  };

  if (state === 'sent' || state === 'mailto') {
    return (
      <div role="status" className="border border-gray-200 bg-white p-6">
        <p className="flex items-center gap-2 font-medium"><Check className="w-5 h-5 text-emerald-600" /> {state === 'sent' ? 'Message sent.' : 'Your mail app should open with the message ready to send.'}</p>
        <p className="mt-2 text-sm text-ink/65">{state === 'sent' ? 'You will get a reply by email.' : <>If nothing opened, write to <a className="underline underline-offset-4" href={`mailto:${SITE.author.email}`}>{SITE.author.email}</a>.</>}</p>
      </div>
    );
  }
  const field = 'mt-2 w-full border border-gray-200 bg-white px-3 py-3 text-sm focus:border-ink focus:outline-none';
  return (
    <form onSubmit={submit} className="border border-gray-200 bg-white p-5 sm:p-6" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-[11px] uppercase tracking-[0.16em] text-ink/50">Name
          <input name="name" required minLength={2} maxLength={100} autoComplete="name" className={field} />
        </label>
        <label className="block text-[11px] uppercase tracking-[0.16em] text-ink/50">Email
          <input name="email" type="email" required maxLength={200} autoComplete="email" className={field} />
        </label>
      </div>
      <label className="mt-4 block text-[11px] uppercase tracking-[0.16em] text-ink/50">Message
        <textarea name="message" required minLength={10} maxLength={4000} rows={5} className={field} />
      </label>
      <div aria-hidden="true" className="absolute -left-[9999px]"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <button type="submit" disabled={state === 'sending'} className="mt-5 inline-flex items-center gap-2 bg-ink px-6 py-3.5 text-sm font-medium text-white rounded-lg hover:bg-ink/90 disabled:opacity-60 transition-colors duration-200">
        {state === 'sending' && <Loader className="w-4 h-4 animate-spin" />} Send message
      </button>
      {state === 'error' && <p role="alert" className="mt-3 text-sm text-red-700">{msg}</p>}
    </form>
  );
}
