import type { SVGProps } from 'react';

/** Tiny hand-rolled icon set (stroke icons, 24px grid). Decorative: always aria-hidden. */
function Icon({ d, ...p }: SVGProps<SVGSVGElement> & { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      <path d={d} />
    </svg>
  );
}
type P = SVGProps<SVGSVGElement>;
export const ArrowRight = (p: P) => <Icon d="M5 12h14M13 6l6 6-6 6" {...p} />;
export const ArrowUpRight = (p: P) => <Icon d="M7 17 17 7M8 7h9v9" {...p} />;
export const ArrowUp = (p: P) => <Icon d="M12 19V5M6 11l6-6 6 6" {...p} />;
export const Menu = (p: P) => <Icon d="M4 7h16M4 12h16M4 17h16" {...p} />;
export const Close = (p: P) => <Icon d="M6 6l12 12M18 6 6 18" {...p} />;
export const Check = (p: P) => <Icon d="M5 12.5 10 17.5 19 7" {...p} />;
export const Copy = (p: P) => <Icon d="M9 9h10v11H9zM5 15V4h10" {...p} />;
export const Zap = (p: P) => <Icon d="M13 3 5 14h6l-1 7 8-11h-6z" {...p} />;
export const Shield = (p: P) => <Icon d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" {...p} />;
export const ShieldAlert = (p: P) => <Icon d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6zM12 9v4M12 16.5v.01" {...p} />;
export const Activity = (p: P) => <Icon d="M3 12h4l3-8 4 16 3-8h4" {...p} />;
export const Mail = (p: P) => <Icon d="M4 6h16v12H4zM4 7l8 6 8-6" {...p} />;
export const MapPin = (p: P) => <Icon d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11zM12 12.5v.01" {...p} />;
export const Loader = (p: P) => <Icon d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" {...p} />;
export const Github = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.9.83.09-.64.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z" />
  </svg>
);
export const Linkedin = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.75h4v11.5H3zM9.5 9.75h3.83v1.57h.06c.53-1 1.84-2.07 3.78-2.07 4.04 0 4.78 2.66 4.78 6.12v5.88h-4v-5.21c0-1.24-.02-2.84-1.73-2.84-1.73 0-2 1.35-2 2.75v5.3h-4z" />
  </svg>
);
