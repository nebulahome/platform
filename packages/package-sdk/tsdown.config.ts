/**
 * The published build: one ES module and one bundled declaration per entry point, in `dist/`.
 *
 * What is private to the platform - `@nebulahome/contracts` and the zod it is written in - is a
 * development dependency, so it is bundled where it is used (the Vite plugin and the command,
 * which check a manifest against the platform's own schemas) and never imported by what is
 * published. React and Vite are the author's: peer dependencies, never bundled.
 */
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    server: 'src/server/index.ts',
  },
  format: 'esm',
  platform: 'neutral',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  dts: { sourcemap: false },
  sourcemap: false,
  hash: false,
  fixedExtension: false,
  outputOptions: { chunkFileNames: 'chunks/[name].js' },
  deps: {
    neverBundle: [/^node:/, 'react', 'react-dom', /^react\//, 'vite', /^vite\//],
  },
});
