/**
 * Browser entry point: mounts the React tree into the document.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/i18n/instance';

import { App } from '@/app';
import '@/styles/globals.css';

const RELOADED_AT_KEY = 'nebula.chunk-reload-at';

// A page left open across an update asks for a chunk the new build no longer has. Reading the
// page again gets the new build; at most once a minute, so a server that is away cannot loop it.
window.addEventListener('vite:preloadError', () => {
  try {
    const reloadedAt = Number(sessionStorage.getItem(RELOADED_AT_KEY) ?? 0);

    if (Date.now() - reloadedAt < 60_000) {
      return;
    }

    sessionStorage.setItem(RELOADED_AT_KEY, String(Date.now()));
  } catch {
    return;
  }

  window.location.reload();
});

const container = document.querySelector('#root');

if (!container) {
  throw new Error('Root container #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
