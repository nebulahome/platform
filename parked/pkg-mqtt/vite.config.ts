/**
 * The broker's interface, built by the package UI preset into `ui/index.js` and `ui/index.css`.
 *
 * Tailwind builds the package's own utilities against the design system's tokens, which
 * `src/ui/styles.css` references rather than imports: the interface already carries the tokens,
 * the reset and the design system's own classes, and the package's stylesheet adds only what its
 * components use.
 */
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { nebulaPackageUi } from '@nebula-home/package-ui/vite';

export default defineConfig({ plugins: [react(), tailwindcss(), nebulaPackageUi()] });
