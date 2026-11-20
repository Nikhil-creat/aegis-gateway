import { findRoute } from '../../site.config';
import { Link, usePath } from '../router';

/** Visible breadcrumb trail (the matching BreadcrumbList JSON-LD is emitted by seo.ts). */
export default function Breadcrumbs() {
  const route = findRoute(usePath());
  if (!route || route.path === '/') return null;
  return (
    <nav aria-label="Breadcrumb" className="text-xs text-ink/55">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <li><Link href="/" className="hover:text-ink hover:underline underline-offset-4">Home</Link></li>
        <li aria-hidden="true" className="text-ink/30">/</li>
        <li aria-current="page" className="text-ink/80">{route.label}</li>
      </ol>
    </nav>
  );
}
