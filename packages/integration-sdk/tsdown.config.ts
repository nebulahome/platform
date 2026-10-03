/**
 * The published build: one ES module and one bundled declaration per entry point, in `dist/`.
 *
 * What is private to the platform - `@nebulahome/package-runtime`, the contract an integration is
 * written against and the loader `hub` reads it with, and `@nebulahome/contracts` under it - is a
 * development dependency, bundled where it is used, its types written into the declarations: an
 * integration's author installs this package and nothing of the platform's. zod is a dependency,
 * not bundled: its types are the SDK's (`sdk.z`), and the hub hands its own copy at run time.
 * rolldown, which builds an integration's code, ships a native binary and cannot be bundled.
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
    neverBundle: [/^node:/u, 'zod', /^zod\//u, 'rolldown', /^rolldown\//u],
  },
};

export default defineConfig([
  {
    ...shared,
    // What an integration's own code imports: types, and functions that only type it. Nothing
    // here may read a file - it is bundled into the integration's modules.
    entry: { index: 'src/index.ts' },
    platform: 'neutral',
    clean: true,
    outputOptions: { chunkFileNames: 'chunks/[name].js' },
  },
  {
    ...shared,
    entry: {
      testing: 'src/testing/index.ts',
      cli: 'src/cli/bin.ts',
      schemas: 'src/schemas.ts',
    },
    platform: 'node',
    clean: false,
    outputOptions: { chunkFileNames: 'chunks/node-[name].js' },
  },
]);
