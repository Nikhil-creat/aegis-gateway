import type { ReactNode } from 'react';

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[11px] uppercase tracking-[0.2em] text-ink/50 font-medium">{children}</p>;
}

export function H2({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="mt-3 font-serif text-3xl sm:text-4xl md:text-5xl leading-[1.1] tracking-tight font-normal scroll-mt-24">
      {children}
    </h2>
  );
}

export function Section({ children, grid = false, id, tone = 'white' }: { children: ReactNode; grid?: boolean; id?: string; tone?: 'white' | 'mist' }) {
  return (
    <section id={id} className={`border-t border-gray-200 ${tone === 'mist' ? 'bg-mist/60' : ''} ${grid ? 'bg-grid' : ''}`}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 md:px-10 py-16 md:py-24">{children}</div>
    </section>
  );
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'dark' }) {
  const tones = {
    neutral: 'bg-mist text-ink/70',
    ok: 'bg-emerald-50 text-emerald-800',
    warn: 'bg-amber-50 text-amber-800',
    bad: 'bg-red-50 text-red-800',
    dark: 'bg-ink text-white',
  } as const;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

export function Code({ children, label }: { children: string; label?: string }) {
  return (
    <figure className="bg-[#111] text-white overflow-hidden">
      {label && <figcaption className="px-4 pt-3 text-[10px] uppercase tracking-[0.16em] text-white/40">{label}</figcaption>}
      <pre className="px-4 py-4 overflow-x-auto font-mono text-[13px] leading-relaxed text-white/85">
        <code>{children}</code>
      </pre>
    </figure>
  );
}

export function Table({ head, rows, caption }: { head: string[]; rows: ReactNode[][]; caption: string }) {
  return (
    <div className="overflow-x-auto border border-gray-200 bg-white">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-gray-200 bg-mist/70">
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-3 text-[11px] uppercase tracking-[0.14em] text-ink/55 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-100 last:border-0 align-top">
              {r.map((c, j) => (
                <td key={j} className={`px-4 py-3 leading-relaxed ${j === 0 ? 'font-medium text-ink' : 'text-ink/70'}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Every inner page starts with the same header: breadcrumb slot, the page's single h1, and a lede. */
export function PageHeader({ h1, lede, children }: { h1: string; lede: string; children?: ReactNode }) {
  return (
    <header className="border-b border-gray-200 bg-grid">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 md:px-10 pt-28 sm:pt-32 pb-12 md:pb-16">
        {children}
        <h1 className="mt-5 font-serif text-4xl sm:text-5xl md:text-6xl leading-[1.08] tracking-tighter font-normal max-w-3xl">{h1}</h1>
        <p className="mt-5 max-w-2xl text-sm md:text-base text-ink/70 leading-relaxed">{lede}</p>
      </div>
    </header>
  );
}
