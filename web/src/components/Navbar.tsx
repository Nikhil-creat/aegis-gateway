import { useEffect, useState } from 'react';
import { SITE } from '../../site.config';
import { ArrowRight, Close, Menu } from '../icons';
import { Link, usePath } from '../router';
import Logo from './Logo';

const LINKS: Array<[string, string]> = [
  ['Playground', '/playground/'],
  ['Architecture', '/architecture/'],
  ['Benchmarks', '/benchmarks/'],
  ['Security', '/security/'],
  ['About', '/about/'],
];

export default function Navbar() {
  const path = usePath();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);

  const solid = scrolled || open || path !== '/';
  return (
    <header className={`fixed top-0 left-0 right-0 z-50 transition-colors duration-200 border-b ${solid ? 'bg-white/85 backdrop-blur-md border-gray-200' : 'border-transparent'}`}>
      <nav className="flex items-center justify-between px-6 sm:px-10 md:px-14 py-4 sm:py-5" aria-label="Primary">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Aegis AI Gateway, home">
          <Logo className="w-6 h-6 text-ink" />
          <span className="font-semibold text-base tracking-tight text-ink">Aegis</span>
        </Link>

        <ul className="hidden md:flex items-center gap-8">
          {LINKS.map(([label, href]) => (
            <li key={href}>
              <Link href={href} aria-current={path === href ? 'page' : undefined} className={`text-sm transition-colors duration-200 hover:text-ink ${path === href ? 'text-ink font-medium' : 'text-ink/70'}`}>
                {label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3">
          <Link href={SITE.repo} className="hidden sm:inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-white text-sm font-medium rounded-lg hover:bg-ink/90 transition-colors duration-200">
            View on GitHub <ArrowRight className="w-4 h-4" />
          </Link>
          <button type="button" className="md:hidden p-2 -mr-2 text-ink" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((o) => !o)}>
            {open ? <Close className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </nav>

      {open && (
        <div id="mobile-menu" className="md:hidden px-6 pb-6 pt-2 border-t border-gray-200 bg-white">
          <ul>
            {LINKS.map(([label, href]) => (
              <li key={href} className="border-b border-gray-100">
                <Link href={href} className="flex items-center justify-between py-4 text-base text-ink">
                  {label} <ArrowRight className="w-4 h-4 text-gray-400" />
                </Link>
              </li>
            ))}
          </ul>
          <Link href={SITE.repo} className="mt-5 inline-flex w-full justify-center px-5 py-3 bg-ink text-white text-sm font-medium rounded-lg">
            View on GitHub
          </Link>
        </div>
      )}
    </header>
  );
}
