import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { findRoute } from '../site.config';
import AssistantLauncher from './components/AssistantLauncher';
import Footer from './components/Footer';
import Navbar from './components/Navbar';
import { RouterProvider, normalize, usePath } from './router';
import { applyHead } from './seo';

type Loader = () => Promise<{ default: ComponentType }>;

/** One dynamic import per page: each page is its own chunk, so the first load only ships what it renders. */
export const LOADERS: Record<string, Loader> = {
  '/': () => import('./pages/Home'),
  '/playground/': () => import('./pages/Playground'),
  '/architecture/': () => import('./pages/Architecture'),
  '/benchmarks/': () => import('./pages/Benchmarks'),
  '/security/': () => import('./pages/Security'),
  '/about/': () => import('./pages/About'),
  '404': () => import('./pages/NotFound'),
};
export const keyFor = (path: string) => (findRoute(path) ? normalize(path) : '404');

interface Shown {
  key: string;
  Page: ComponentType;
}

function Shell({ initial }: { initial: Shown }) {
  const path = usePath();
  const [shown, setShown] = useState<Shown>(initial);
  const first = useRef(true);
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    const key = keyFor(path);
    if (key === shown.key) return;
    let live = true;
    void LOADERS[key]().then((m) => live && setShown({ key, Page: m.default }));
    return () => { live = false; };
  }, [path, shown.key]);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    applyHead(path);
    main.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.key]);

  const Page = shown.Page;
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:text-white">Skip to content</a>
      <Navbar />
      <main id="main" ref={main} tabIndex={-1} className="outline-none">
        <Page />
      </main>
      <Footer />
      <AssistantLauncher />
    </>
  );
}

export default function App({ path, initial }: { path: string; initial: Shown }) {
  return (
    <RouterProvider initialPath={path}>
      <Shell initial={initial} />
    </RouterProvider>
  );
}
