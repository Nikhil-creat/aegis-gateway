/** Single source of truth for site-wide facts. Change SITE_URL (or set the SITE_URL env var at build time). */
export const SITE = {
  url: (process.env.SITE_URL || 'https://aegis-gateway.vercel.app').replace(/\/+$/, ''),
  name: 'Aegis AI Gateway',
  tagline: 'Auto-routing, LLMOps and agent evals in one gateway',
  locale: 'en_IN',
  repo: 'https://github.com/Nikhil-creat/aegis-gateway',
  author: {
    name: 'Nikhil Chary Sriramoju',
    github: 'https://github.com/Nikhil-creat',
    linkedin: 'https://in.linkedin.com/in/nikhil-chary-sriramoju-95041b38a',
    email: 'sriramojunikhil66@gmail.com',
    locality: 'Warangal',
    region: 'Telangana',
    country: 'IN',
  },
  published: '2026-11-19',
};

export interface RouteMeta {
  path: string;
  /** <title>, kept under ~60 characters */
  title: string;
  /** meta description, 120-160 characters */
  description: string;
  /** the one visible <h1> on the page (for reference and tests) */
  h1: string;
  /** short label used in breadcrumbs, navigation and the sitemap */
  label: string;
  type: 'WebPage' | 'TechArticle' | 'WebApplication' | 'ProfilePage';
  priority: number;
}

export const ROUTES: RouteMeta[] = [
  {
    path: '/',
    title: 'Aegis AI Gateway: Auto-Routing, LLMOps & Agent Evals',
    description: 'Open-source AI gateway that routes each request to the right model, fails over when a provider breaks, logs cost and latency, and proves it with a 30-task eval.',
    h1: 'Route every request to the right model.',
    label: 'Home',
    type: 'WebPage',
    priority: 1,
  },
  {
    path: '/playground/',
    title: 'Live Gateway Playground | Aegis AI Gateway',
    description: 'Send prompts through the Aegis gateway and watch routing, security checks, retrieval, tool calls, failover and cost as they happen. Works offline with a mock provider.',
    h1: 'Live gateway playground',
    label: 'Playground',
    type: 'WebApplication',
    priority: 0.9,
  },
  {
    path: '/architecture/',
    title: 'Architecture and Design Decisions | Aegis AI Gateway',
    description: 'How Aegis scores prompts, picks a model, fails over across Groq and Gemini, caches, logs every request and runs a bounded agent, and why each choice was made.',
    h1: 'How the gateway decides',
    label: 'Architecture',
    type: 'TechArticle',
    priority: 0.8,
  },
  {
    path: '/benchmarks/',
    title: 'Benchmarks: Cost vs Pass Rate | Aegis AI Gateway',
    description: 'A fixed 30-task agent exam under always-cheap, always-strong and smart-router, scored on correctness, tool trajectory and compliance, with a CI regression gate.',
    h1: 'Does auto-routing actually save money?',
    label: 'Benchmarks',
    type: 'TechArticle',
    priority: 0.8,
  },
  {
    path: '/security/',
    title: 'Security Model and Limitations | Aegis AI Gateway',
    description: 'Threat model and honest limits: injection firewall, PII redaction, rate limits, spend breaker, free-tier quotas, SQLite and in-memory state, and what to harden next.',
    h1: 'Security model and honest limits',
    label: 'Security',
    type: 'TechArticle',
    priority: 0.7,
  },
  {
    path: '/about/',
    title: 'About the Author | Nikhil Chary Sriramoju',
    description: 'Nikhil Chary Sriramoju is a final-year CSE student in Warangal building AI infrastructure. See credentials, internships and how to get in touch.',
    h1: 'Built by Nikhil Chary Sriramoju',
    label: 'About',
    type: 'ProfilePage',
    priority: 0.6,
  },
];

export const NOT_FOUND: Pick<RouteMeta, 'title' | 'description' | 'h1'> = {
  title: 'Page not found | Aegis AI Gateway',
  description: 'This page does not exist. Try the live playground, the architecture write-up or the benchmark results.',
  h1: "This page doesn't exist",
};

export const findRoute = (pathname: string): RouteMeta | undefined => {
  const p = pathname.endsWith('/') ? pathname : pathname + '/';
  return ROUTES.find((r) => r.path === (p === '//' ? '/' : p));
};
