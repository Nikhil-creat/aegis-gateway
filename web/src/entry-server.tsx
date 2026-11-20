import type { ComponentType } from 'react';
import { renderToString } from 'react-dom/server';
import App, { keyFor } from './App';
import About from './pages/About';
import Architecture from './pages/Architecture';
import Benchmarks from './pages/Benchmarks';
import Home from './pages/Home';
import NotFound from './pages/NotFound';
import Playground from './pages/Playground';
import Security from './pages/Security';

const PAGES: Record<string, ComponentType> = {
  '/': Home, '/playground/': Playground, '/architecture/': Architecture,
  '/benchmarks/': Benchmarks, '/security/': Security, '/about/': About, '404': NotFound,
};

export function render(path: string): string {
  const key = keyFor(path);
  return renderToString(<App path={path} initial={{ key, Page: PAGES[key] }} />);
}
