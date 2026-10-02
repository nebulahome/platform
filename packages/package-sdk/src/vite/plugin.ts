/**
 * `nebula()`: the Vite plugin that builds a package's two halves (PACKAGES_DOCS.md 8.1).
 *
 * - **The interface** (`vite build`): one entry generated from the components bound in
 *   `nebula.config.ts`, one chunk per component, React read from the interface, the stylesheet
 *   scoped to the package's own elements; into `<outDir>/ui/`.
 * - **The server** (`vite build --ssr`): the config's `server` module with every dependency inside
 *   it, for Node 22, into one `<outDir>/server/index.js`. The config's loaders are emptied there,
 *   and an import of `/ui` or `/components` refused: the interface is never part of the server.
 *
 * The manifest and the rest of a release are `buildPackage`'s, which runs both builds.
 */
import path from 'node:path';

import type { Plugin } from 'vite';

import { isRecord } from '../build/fields.js';
import { SDK_VERSION } from '../version.js';

import { loadPackage } from './load.js';
import { scopeCss } from './scope-css.js';
import { isSharedModule, SHARED_PREFIX, sharedModuleCode } from './shared-modules.js';

/** What `nebula()` takes. */
export type NebulaOptions = {
  /** The package's declaration, relative to the root: `nebula.config.ts` when not said. */
  readonly config?: string;

  /** Where the release is staged: `dist` when not said. */
  readonly outDir?: string;
};

/** The plugin's name, by which `buildPackage` finds it among a config's plugins. */
export const PLUGIN_NAME = 'nebulahome:package';

/** The interface's generated entry. */
const UI_ENTRY = 'virtual:nebulahome/ui';

/** An import of a module, as the config's loaders are written: `import('./card.js')`. */
const DYNAMIC_IMPORT = /\bimport\(\s*(['"`])[^'"`]+\1\s*\)/g;

/** The SDK's entry points that belong to the interface. */
const INTERFACE_ENTRIES = ['@nebulahome/package-sdk/ui', '@nebulahome/package-sdk/components'];

/** What the plugin knows once it has read the package. */
type State = {
  readonly side: 'ui' | 'server';
  readonly configPath: string;
  readonly packageId: string;
};

/**
 * The code of the interface's entry: the components the config binds, as the interface reads
 * them.
 *
 * @param configPath - The config's path.
 * @returns The module.
 */
function uiEntryCode(configPath: string): string {
  return [
    `import definition from ${JSON.stringify(configPath.replaceAll('\\', '/'))};`,
    'const ui = definition.ui ?? {};',
    'export default {',
    "  kind: 'nebula.ui',",
    `  sdk: ${JSON.stringify(SDK_VERSION)},`,
    '  page: ui.page?.component,',
    '  cards: ui.cards ?? {},',
    '  entityViews: ui.entityViews ?? {},',
    '};',
  ].join('\n');
}

/**
 * The plugin that builds a package's interface and server.
 *
 * @param options - Where its config is, and where the release goes.
 * @returns The plugin.
 */
export function nebula(options: NebulaOptions = {}): Plugin {
  let state: State | undefined;

  return {
    name: PLUGIN_NAME,
    apply: 'build',
    api: { options },

    /**
     * Reads the package, and sets up the build of the half asked for.
     *
     * @param config - The config as written.
     * @param env - Which build.
     * @returns What the build needs.
     */
    async config(config, env) {
      const root = path.resolve(config.root ?? '.');
      const outDir = path.resolve(root, options.outDir ?? 'dist');
      const { definition, configPath } = await loadPackage(
        root,
        options.config ?? 'nebula.config.ts',
      );
      const packageId =
        isRecord(definition) && typeof definition['id'] === 'string' ? definition['id'] : 'package';

      if (env.isSsrBuild === true) {
        const server =
          isRecord(definition) && typeof definition['server'] === 'string'
            ? path.resolve(root, definition['server'])
            : undefined;

        if (server === undefined) {
          throw new Error('The package declares no server, so there is no server to build');
        }

        state = { side: 'server', configPath, packageId };

        return {
          build: {
            outDir: path.join(outDir, 'server'),
            emptyOutDir: true,
            target: 'node22',
            ssr: server,
            minify: false,
            sourcemap: false,
            rolldownOptions: {
              input: server,
              output: { entryFileNames: 'index.js', format: 'esm', codeSplitting: false },
            },
          },
          ssr: { noExternal: true, target: 'node' },
        };
      }

      state = { side: 'ui', configPath, packageId };

      return {
        base: './',
        define: { 'process.env.NODE_ENV': JSON.stringify('production') },
        build: {
          outDir: path.join(outDir, 'ui'),
          emptyOutDir: true,
          cssCodeSplit: false,
          modulePreload: false,
          sourcemap: false,
          rolldownOptions: {
            input: { index: UI_ENTRY },
            preserveEntrySignatures: 'strict',
            output: {
              entryFileNames: 'index.js',
              chunkFileNames: 'chunks/[name]-[hash].js',

              /**
               * Names the stylesheet as the manifest does, and any other asset by its hash.
               *
               * @param asset - The asset.
               * @returns Its file name.
               */
              assetFileNames: (asset) =>
                asset.names.some((name) => name.endsWith('.css'))
                  ? 'index.css'
                  : 'assets/[name]-[hash][extname]',
            },
          },
        },
      };
    },

    /**
     * Resolves the interface's entry and the shared modules, and refuses the interface in the
     * server.
     *
     * @param source - What is imported.
     * @param importer - What imports it.
     * @returns The resolved id, or null for the bundler to resolve.
     */
    resolveId(source, importer) {
      if (state?.side === 'server') {
        if (INTERFACE_ENTRIES.includes(source)) {
          this.error(
            `${importer ?? 'The server'} imports ${source}: the interface is never part of the server`,
          );
        }

        return null;
      }

      if (source === UI_ENTRY) {
        return `\0${UI_ENTRY}`;
      }

      return isSharedModule(source) ? `${SHARED_PREFIX}${source}` : null;
    },

    /**
     * Loads the interface's entry and the shared modules.
     *
     * @param id - The module.
     * @returns Its code, or null for the bundler to load.
     */
    load(id) {
      if (state === undefined) {
        return null;
      }

      if (id === `\0${UI_ENTRY}`) {
        return uiEntryCode(state.configPath);
      }

      return id.startsWith(SHARED_PREFIX) ? sharedModuleCode(id.slice(SHARED_PREFIX.length)) : null;
    },

    /**
     * Empties the config's loaders in the server: they load components the server never draws.
     *
     * @param code - The module's code.
     * @param id - The module.
     * @returns The code without them, or null to leave it.
     */
    transform(code, id) {
      if (state?.side !== 'server' || path.resolve(id) !== state.configPath) {
        return null;
      }

      return { code: code.replace(DYNAMIC_IMPORT, 'Promise.resolve(undefined)'), map: null };
    },

    generateBundle: {
      order: 'post',

      /**
       * Scopes the interface's stylesheet to the package's own elements, once Vite has written it.
       *
       * @param options - The output's options.
       * @param bundle - What the build wrote.
       */
      handler(options, bundle) {
        if (state?.side !== 'ui' || options.format !== 'es') {
          return;
        }

        for (const file of Object.values(bundle)) {
          if (file.type === 'asset' && file.fileName.endsWith('.css')) {
            file.source = scopeCss(
              typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source),
              state.packageId,
            );
          }
        }
      },
    },
  };
}
