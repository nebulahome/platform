/**
 * Browser entry point: mounts the React tree into the document.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/i18n/instance';

import { App } from '@/app';
import '@/styles/globals.css';

const container = document.querySelector('#root');

if (!container) {
  throw new Error('Root container #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
