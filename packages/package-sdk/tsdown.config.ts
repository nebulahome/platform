/**
 * The published build: one ES module and one bundled declaration per entry point, in `dist/`.
 *
 * What is private to the platform - `@nebulahome/contracts` and the zod it is written in - and the
 * tools the build uses - postcss, yaml, tar - are development dependencies, bundled where they are
 * used: the Vite plugin and the command, which check a manifest against the platform's own
 * schemas. What runs in a package - the definitions, the server's and the interface's entry
 * points - imports none of them. React and Vite are the author's: peer dependencies, never
 * bundled.
 */
import { defineConfig, type UserConfig } from 'tsdown';

/** What both builds share. */
const shared: UserConfig = {
  format: 'esm',
  target: 'node22',
  outDir: 'dist',
  dts: { sourcemap: false },
  sourcemap: false,
  hash: false,
  fixedExtension: false,
  deps: {
    neverBundle: [/^node:/, 'react', 'react-dom', /^react\//, 'vite', /^vite\//],
  },
};

export default defineConfig([
  {
    ...shared,
    entry: {
      index: 'src/index.ts',
      server: 'src/server/index.ts',
      ui: 'src/ui/index.ts',
      components: 'src/components/index.ts',
    },
    platform: 'neutral',
    clean: true,
    outputOptions: { chunkFileNames: 'chunks/[name].js' },
  },
  {
    ...shared,
    entry: {
      vite: 'src/vite/index.ts',
      cli: 'src/cli/bin.ts',
    },
    platform: 'node',
    clean: false,
    outputOptions: { chunkFileNames: 'chunks/node-[name].js' },
  },
]);
