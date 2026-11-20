/** Head tags and structured data. Used at build time (static HTML) and at runtime (client-side navigation). */
import { NOT_FOUND, ROUTES, SITE, findRoute } from '../site.config';
import type { RouteMeta } from '../site.config';

export const slugFor = (r: RouteMeta) => (r.path === '/' ? 'home' : r.label.toLowerCase());
export const absolute = (path: string) => `${SITE.url}${path}`;
export const ogImage = (r?: RouteMeta) => absolute(`/og/${r ? slugFor(r) : 'home'}.png`);

const BUILD_DATE = process.env.BUILD_DATE || new Date().toISOString().slice(0, 10);

const person = {
  '@type': 'Person',
  '@id': absolute('/about/#person'),
  name: SITE.author.name,
  url: absolute('/about/'),
  email: `mailto:${SITE.author.email}`,
  sameAs: [SITE.author.github, SITE.author.linkedin],
  jobTitle: 'Computer Science student and AI engineer',
  alumniOf: { '@type': 'CollegeOrUniversity', name: 'Vaagdevi College of Engineering' },
  address: { '@type': 'PostalAddress', addressLocality: SITE.author.locality, addressRegion: SITE.author.region, addressCountry: SITE.author.country },
  knowsAbout: ['LLMOps', 'Retrieval-augmented generation', 'Agent evaluation', 'FastAPI', 'Python', 'React'],
};

const breadcrumb = (r: RouteMeta) => ({
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: absolute('/') },
    { '@type': 'ListItem', position: 2, name: r.label, item: absolute(r.path) },
  ],
});

const software = {
  '@type': 'SoftwareSourceCode',
  '@id': absolute('/#software'),
  name: SITE.name,
  description: 'FastAPI gateway that auto-routes LLM requests, fails over across providers, logs cost and latency, and scores agents with a fixed evaluation suite.',
  codeRepository: SITE.repo,
  programmingLanguage: ['Python', 'TypeScript'],
  runtimePlatform: 'Python 3.11+',
  license: 'https://opensource.org/license/mit',
  author: { '@id': person['@id'] },
  url: absolute('/'),
};

/** One @graph per page. Home carries site-level entities; inner pages add a breadcrumb and a page entity. */
export function jsonLd(r: RouteMeta | undefined): Record<string, unknown> {
  if (!r) return { '@context': 'https://schema.org', '@graph': [] };
  const url = absolute(r.path);
  const graph: Record<string, unknown>[] = [];
  if (r.path === '/') {
    graph.push(
      { '@type': 'WebSite', '@id': absolute('/#website'), url: absolute('/'), name: SITE.name, description: r.description, inLanguage: 'en', publisher: { '@id': person['@id'] } },
      software,
      { ...person },
    );
  } else {
    graph.push(breadcrumb(r));
    if (r.type === 'WebApplication') {
      graph.push({
        '@type': 'WebApplication', name: 'Aegis gateway playground', url, description: r.description,
        applicationCategory: 'DeveloperApplication', operatingSystem: 'Any', isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, author: { '@id': person['@id'] },
      });
    } else if (r.type === 'TechArticle') {
      graph.push({
        '@type': 'TechArticle', headline: r.h1, description: r.description, url, mainEntityOfPage: url, inLanguage: 'en',
        image: ogImage(r), datePublished: SITE.published, dateModified: BUILD_DATE,
        author: { '@id': person['@id'] }, publisher: { '@id': person['@id'] }, about: { '@id': absolute('/#software') },
      });
    } else if (r.type === 'ProfilePage') {
      graph.push(
        { '@type': 'ProfilePage', url, name: r.title, description: r.description, mainEntity: { '@id': person['@id'] }, dateModified: BUILD_DATE },
        { ...person },
        {
          '@type': 'ProfessionalService',
          '@id': absolute('/about/#service'),
          name: `${SITE.author.name}: AI and backend engineering`,
          description: 'Independent AI infrastructure and backend engineering projects: LLM gateways, retrieval and evaluation.',
          url, image: ogImage(r), email: SITE.author.email,
          address: { '@type': 'PostalAddress', addressLocality: SITE.author.locality, addressRegion: SITE.author.region, addressCountry: SITE.author.country },
          areaServed: { '@type': 'Country', name: 'India' },
          founder: { '@id': person['@id'] },
          sameAs: [SITE.author.github, SITE.author.linkedin],
        },
      );
    } else {
      graph.push({ '@type': 'WebPage', name: r.title, description: r.description, url, isPartOf: { '@id': absolute('/#website') } });
    }
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Full <head> contents for a known route, or the noindex 404 head. */
export function headHtml(r: RouteMeta | undefined): string {
  const m = r ?? { ...NOT_FOUND, path: '/404/' };
  const canonical = r ? absolute(r.path) : '';
  const img = ogImage(r);
  const tags = [
    `<title>${esc(m.title)}</title>`,
    `<meta name="description" content="${esc(m.description)}" />`,
    `<meta name="robots" content="${r ? 'index,follow,max-image-preview:large' : 'noindex,follow'}" />`,
    r ? `<link rel="canonical" href="${canonical}" />` : '',
    `<meta property="og:site_name" content="${esc(SITE.name)}" />`,
    `<meta property="og:locale" content="${SITE.locale}" />`,
    `<meta property="og:type" content="${r?.path === '/' ? 'website' : r?.type === 'ProfilePage' ? 'profile' : 'article'}" />`,
    `<meta property="og:title" content="${esc(m.title)}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    r ? `<meta property="og:url" content="${canonical}" />` : '',
    `<meta property="og:image" content="${img}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(`${m.h1}: ${SITE.name}`)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(m.title)}" />`,
    `<meta name="twitter:description" content="${esc(m.description)}" />`,
    `<meta name="twitter:image" content="${img}" />`,
    `<meta name="twitter:image:alt" content="${esc(`${m.h1}: ${SITE.name}`)}" />`,
    `<script type="application/ld+json" id="ld">${JSON.stringify(jsonLd(r)).replace(/</g, '\\u003c')}</script>`,
  ];
  return tags.filter(Boolean).join('\n    ');
}

/** Client-side navigation: update the tags that headHtml() wrote. */
export function applyHead(pathname: string): void {
  const r = findRoute(pathname);
  const m = r ?? { ...NOT_FOUND, path: '/404/' };
  const set = (sel: string, attr: string, value: string) => document.head.querySelector(sel)?.setAttribute(attr, value);
  document.title = m.title;
  set('meta[name="description"]', 'content', m.description);
  set('meta[name="robots"]', 'content', r ? 'index,follow,max-image-preview:large' : 'noindex,follow');
  const canon = document.head.querySelector('link[rel="canonical"]');
  if (r) {
    if (canon) canon.setAttribute('href', absolute(r.path));
    else {
      const l = document.createElement('link');
      l.rel = 'canonical';
      l.href = absolute(r.path);
      document.head.appendChild(l);
    }
  } else canon?.remove();
  for (const key of ['og:title', 'twitter:title']) set(`meta[property="${key}"],meta[name="${key}"]`, 'content', m.title);
  for (const key of ['og:description', 'twitter:description']) set(`meta[property="${key}"],meta[name="${key}"]`, 'content', m.description);
  set('meta[property="og:url"]', 'content', r ? absolute(r.path) : window.location.href);
  for (const sel of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) set(sel, 'content', ogImage(r));
  const ld = document.getElementById('ld');
  if (ld) ld.textContent = JSON.stringify(jsonLd(r)).replace(/</g, '\\u003c');
}

export { ROUTES };
