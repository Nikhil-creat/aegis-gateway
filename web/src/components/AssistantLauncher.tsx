import { useState } from 'react';
import type { ComponentType } from 'react';

type Panel = ComponentType<{ onClose: () => void }>;

/** Floating launcher. The panel (and the engine behind it) is only downloaded the first time it is opened. */
export default function AssistantLauncher() {
  const [open, setOpen] = useState(false);
  const [Panel, setPanel] = useState<Panel | null>(null);

  const toggle = () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (!Panel) void import('./Assistant').then((m) => setPanel(() => m.default));
  };

  return (
    <>
      {open && Panel && <Panel onClose={() => setOpen(false)} />}
      <button type="button" onClick={toggle} aria-expanded={open} aria-label={open ? 'Close the Ask Aegis assistant' : 'Open the Ask Aegis assistant'} className="fixed bottom-5 right-4 z-50 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3.5 text-sm font-medium text-white shadow-xl hover:bg-ink/90 transition-colors duration-200 sm:right-5">
        <span className="pulse-dot h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
        {open ? 'Close' : 'Ask Aegis'}
      </button>
    </>
  );
}
