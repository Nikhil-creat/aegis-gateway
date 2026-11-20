import { ROUTES } from '../../site.config';
import { ArrowRight } from '../icons';
import { Link } from '../router';
import { Eyebrow, Section } from './ui';

/** Internal-link block at the foot of each page: links to the other pages, with their descriptions. */
export default function NextCards({ current, show }: { current: string; show: string[] }) {
  const items = ROUTES.filter((r) => r.path !== current && show.includes(r.path));
  return (
    <Section tone="mist">
      <Eyebrow>Keep exploring</Eyebrow>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {items.map((r) => (
          <Link key={r.path} href={r.path} className="group flex flex-col justify-between bg-white border border-gray-200 p-6 hover:border-ink transition-colors duration-200">
            <div>
              <p className="font-serif text-2xl tracking-tight">{r.label}</p>
              <p className="mt-3 text-sm leading-relaxed text-ink/65">{r.description}</p>
            </div>
            <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium">Open <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" /></span>
          </Link>
        ))}
      </div>
    </Section>
  );
}
