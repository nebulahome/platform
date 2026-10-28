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
import type { Plugin } from 'rolldown';
import { defineConfig, type UserConfig } from 'tsdown';

/**
 * Fails the build of the entry an integration's code imports when its JavaScript imports zod or
 * one of Node's modules: an integration's build bundles that entry into every module and refuses
 * zod, so one runtime export of something that validates would break every integration's build.
 *
 * @returns The plugin.
 */
function importsNothing(): Plugin {
  return {
    name: 'nebulahome:imports-nothing',

    /**
     * Checks what each chunk of JavaScript imports.
     *
     * @param outputOptions - The output's options.
     * @param bundle - What was written.
     */
    generateBundle(outputOptions, bundle) {
      for (const chunk of Object.values(bundle)) {
        const refused =
          chunk.type === 'chunk' && chunk.fileName.endsWith('.js')
            ? chunk.imports.filter((id) => /^(?:zod|node:)/u.test(id))
            : [];

        if (refused.length > 0) {
          this.error(
            `${chunk.fileName} imports ${refused.join(', ')}: an integration could not build`,
          );
        }
      }
    },
  };
}

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
    // here may read a file or import zod - it is bundled into the integration's modules.
    entry: { index: 'src/index.ts' },
    platform: 'neutral',
    plugins: [importsNothing()],
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
