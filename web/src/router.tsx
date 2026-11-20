import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';

interface Nav {
  path: string;
  navigate: (to: string) => void;
}
const Ctx = createContext<Nav>({ path: '/', navigate: () => undefined });

export const normalize = (p: string): string => {
  const clean = p.split('#')[0].split('?')[0] || '/';
  return clean.endsWith('/') ? clean : `${clean}/`;
};

export function RouterProvider({ initialPath, children }: { initialPath: string; children: ReactNode }) {
  const [path, setPath] = useState(normalize(initialPath));

  useEffect(() => {
    const onPop = () => setPath(normalize(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string) => {
    window.history.pushState(null, '', to);
    setPath(normalize(to));
    const hash = to.split('#')[1];
    // Wait one frame so the new page has rendered before scrolling.
    requestAnimationFrame(() => {
      const el = hash ? document.getElementById(hash) : null;
      if (el) el.scrollIntoView();
      else window.scrollTo(0, 0);
    });
  }, []);

  return <Ctx.Provider value={{ path, navigate }}>{children}</Ctx.Provider>;
}

export const usePath = () => useContext(Ctx).path;
export const useNavigate = () => useContext(Ctx).navigate;

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string };

/** Internal links navigate client-side; external links open safely in a new tab; #anchors stay native. */
export function Link({ href, onClick, children, ...rest }: LinkProps) {
  const navigate = useNavigate();
  const external = /^(https?:)?\/\//.test(href) || href.startsWith('mailto:');
  if (external) {
    const web = !href.startsWith('mailto:');
    return (
      <a href={href} {...(web ? { target: '_blank', rel: 'noopener noreferrer' } : {})} onClick={onClick} {...rest}>
        {children}
      </a>
    );
  }
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || href.startsWith('#') || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(href);
  };
  return (
    <a href={href} onClick={handle} {...rest}>
      {children}
    </a>
  );
}
