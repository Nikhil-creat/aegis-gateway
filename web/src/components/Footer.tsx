import { SITE } from '../../site.config';
import { ArrowUp, Github, Linkedin, Mail } from '../icons';
import { Link } from '../router';
import Logo from './Logo';

const COLS: Array<[string, Array<[string, string]>]> = [
  ['Project', [['Live playground', '/playground/'], ['Architecture', '/architecture/'], ['Benchmarks', '/benchmarks/'], ['Security and limits', '/security/']]],
  ['Resources', [['Source code', SITE.repo], ['Run it yourself', '/benchmarks/#reproduce'], ['Sitemap', '/sitemap.xml'], ['llms.txt', '/llms.txt']]],
  ['Author', [['About', '/about/'], ['Contact', '/about/#contact'], ['GitHub profile', SITE.author.github], ['LinkedIn', SITE.author.linkedin]]],
];

export default function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 md:px-10 pt-14 pb-8">
        <div className="grid gap-10 md:grid-cols-5">
          <div className="md:col-span-2">
            <Link href="/" className="inline-flex items-center gap-2.5" aria-label="Aegis AI Gateway, home">
              <Logo className="w-6 h-6 text-ink" />
              <span className="font-semibold text-base tracking-tight">Aegis AI Gateway</span>
            </Link>
            <p className="mt-4 max-w-sm text-sm text-ink/65 leading-relaxed">{SITE.tagline}. A FastAPI gateway that routes, falls back, logs and evaluates, built and measured end to end.</p>
          </div>
          {COLS.map(([title, links]) => (
            <nav key={title} aria-label={title}>
              <p className="text-[11px] uppercase tracking-[0.2em] text-ink/50 font-medium">{title}</p>
              <ul className="mt-4 space-y-2.5">
                {links.map(([label, href]) => (
                  <li key={label}>
                    {href.endsWith('.xml') || href.endsWith('.txt') ? (
                      <a href={href} className="text-sm text-ink/70 hover:text-ink transition-colors duration-200">{label}</a>
                    ) : (
                      <Link href={href} className="text-sm text-ink/70 hover:text-ink transition-colors duration-200">{label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col-reverse gap-4 border-t border-gray-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink/50">© {new Date().getFullYear()} {SITE.author.name}. Open-source project, MIT licensed.</p>
          <div className="flex items-center gap-4 text-ink/60">
            <a href={SITE.author.github} target="_blank" rel="noopener noreferrer" aria-label="GitHub profile" className="hover:text-ink transition-colors duration-200"><Github className="w-4 h-4" /></a>
            <a href={SITE.author.linkedin} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn profile" className="hover:text-ink transition-colors duration-200"><Linkedin className="w-4 h-4" /></a>
            <a href={`mailto:${SITE.author.email}`} aria-label="Email the author" className="hover:text-ink transition-colors duration-200"><Mail className="w-4 h-4" /></a>
            <a href="#top" className="inline-flex items-center gap-1 text-xs hover:text-ink transition-colors duration-200">Back to top <ArrowUp className="w-3.5 h-3.5" /></a>
          </div>
        </div>
      </div>
    </footer>
  );
}
