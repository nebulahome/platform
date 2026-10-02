/**
 * Loads `nebula.config.ts` in Node, the way Vite loads its own config: transformed on demand, so
 * the components' loaders - `() => import('./card.js')` - are never run, and the interface is
 * never evaluated outside a browser.
 *
 * Vite's `runnerImport` is marked experimental; it is wrapped here so a change to it stays here.
 */
import path from 'node:path';

import { runnerImport } from 'vite';

/** A package's declaration, loaded. */
export type LoadedPackage = {
  /** `nebula.config.ts`'s default export. */
  readonly definition: unknown;

  /** The config's absolute path. */
  readonly configPath: string;

  /** The files it imports, for a watcher. */
  readonly dependencies: readonly string[];
};

/**
 * Loads a package's declaration.
 *
 * @param root - The package's folder.
 * @param config - The config, relative to it.
 * @returns Its default export, its path and what it imports.
 */
export async function loadPackage(root: string, config: string): Promise<LoadedPackage> {
  const configPath = path.resolve(root, config);
  const { module, dependencies } = await runnerImport<Readonly<Record<string, unknown>>>(
    configPath,
    { configFile: false, root, logLevel: 'silent' },
  );

  return { definition: module['default'], configPath, dependencies };
}
