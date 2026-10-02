/**
 * The Vite preset a package's interface is built with (PACKAGES.md 5).
 *
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from 'vite';
 * import react from '@vitejs/plugin-react';
 * import { nebulaPackageUi } from '@nebulahome/package-ui/vite';
 *
 * export default defineConfig({ plugins: [react(), nebulaPackageUi()] });
 * ```
 *
 * It builds `src/ui/index.tsx` into one ES module, `ui/index.js`, and its styles into `ui/index.css`
 * - the files the manifest points at, beside it in the release archive.
 * What the interface shares - React, its DOM renderer, the JSX runtime, the design system and this
 * SDK - is not bundled: each import of one becomes a read of `globalThis.__nebula.modules`, where
 * the interface put its own copy before loading the package. So the package uses the interface's
 * React - one React, whose hooks and context work across the two - and needs no import map, which
 * the page's Content Security Policy would refuse.
 */
import type { Plugin, UserConfig } from 'vite';

import { SHARED_MODULES } from './shared.js';

export { SHARED_MODULES } from './shared.js';

/** The prefix of a shared module's id inside the build. */
const SHARED_PREFIX = '\0nebula-shared:';

/** What the preset is told. */
export type NebulaPackageUiOptions = {
  /** The interface's entry, relative to the package's root: `src/ui/index.tsx` when not said. */
  readonly entry?: string;

  /** Where the build goes: `ui` when not said, where the manifest's `./ui/index.js` points. */
  readonly outDir?: string;
};

/**
 * The preset.
 *
 * @param options - Where the entry is and where the build goes.
 * @returns The plugin.
 */
export function nebulaPackageUi(options: NebulaPackageUiOptions = {}): Plugin {
  const shared = new Set<string>(SHARED_MODULES);

  return {
    name: 'nebula-package-ui',
    enforce: 'pre',

    /**
     * Builds one ES module and its stylesheet.
     *
     * @returns The configuration to merge.
     */
    config(): UserConfig {
      return {
        build: {
          outDir: options.outDir ?? 'ui',
          emptyOutDir: true,
          cssCodeSplit: false,
          lib: {
            entry: options.entry ?? 'src/ui/index.tsx',
            formats: ['es'],
            /**
             * The one name, whatever the package's module type.
             *
             * @returns It.
             */
            fileName: (): string => 'index.js',
            cssFileName: 'index',
          },
        },
      };
    },

    /**
     * Takes a shared module out of the build.
     *
     * @param id - What is imported.
     * @returns The shared module's id inside the build, or nothing for any other.
     */
    resolveId(id): string | undefined {
      return shared.has(id) ? `${SHARED_PREFIX}${id}` : undefined;
    },

    /**
     * Makes a shared module a read of the interface's copy. It is written as CommonJS so that the
     * bundler lets any named import through as a property read, as it does for any CommonJS module:
     * which names the interface's copy has is known only when the page runs.
     *
     * @param id - The module's id inside the build.
     * @returns Its code, or nothing for any other module.
     */
    load(id): string | undefined {
      if (!id.startsWith(SHARED_PREFIX)) {
        return undefined;
      }

      const name = JSON.stringify(id.slice(SHARED_PREFIX.length));

      return [
        `const shared = globalThis.__nebula?.modules?.[${name}];`,
        `if (shared === undefined) throw new Error('The NebulaHome interface does not share ' + ${name});`,
        'module.exports = shared;',
        '',
      ].join('\n');
    },
  };
}
