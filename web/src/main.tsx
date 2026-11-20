import { hydrateRoot } from 'react-dom/client';
import App, { LOADERS, keyFor } from './App';

const path = window.location.pathname;
const key = keyFor(path);

// Load the current page's chunk first so the hydrated tree matches the prerendered HTML exactly.
void LOADERS[key]().then((m) => {
  hydrateRoot(document.getElementById('root') as HTMLElement, <App path={path} initial={{ key, Page: m.default }} />);
});
