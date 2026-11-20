import { ROUTES } from '../../site.config';
import { ArrowRight } from '../icons';
import { Link } from '../router';
import { Section } from '../components/ui';

export default function NotFound() {
  return (
    <>
      <header className="border-b border-gray-200 bg-grid">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 md:px-10 pt-36 pb-16">
          <p className="font-mono text-sm text-ink/50">404</p>
          <h1 className="mt-4 font-serif text-5xl md:text-6xl tracking-tighter font-normal">This page doesn't exist</h1>
          <p className="mt-5 max-w-xl text-sm md:text-base leading-relaxed text-ink/70">The address may have a typo or the page may have moved. These pages do exist:</p>
        </div>
      </header>
      <Section>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ROUTES.map((r) => (
            <li key={r.path}>
              <Link href={r.path} className="group block h-full border border-gray-200 bg-white p-6 hover:border-ink transition-colors duration-200">
                <p className="font-serif text-2xl tracking-tight">{r.label}</p>
                <p className="mt-2 text-sm leading-relaxed text-ink/65">{r.description}</p>
                <span className="mt-4 inline-flex items-center gap-2 text-sm font-medium">Go <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" /></span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
