/**
 * `nebulahome-integration build`: the sources, checked, built into `dist/<vendor>/` - the vendor
 * directory as `hub` loads it (INTEGRATIONS_DOCS.md 8.3).
 *
 * 1. `validate`'s checks: nothing is written for sources that would not load.
 * 2. Every file that is not code is copied: the JSON with its `$schema` dropped - an editor's,
 *    not the bundle's - and the manifest with the release's version and runtime range written in.
 * 3. Every module the bundle names - its transports, streams, account, discovery modules, code
 *    drivers - is built in one go, each where the bundle names it (`./lan/transport.js`), what
 *    they share in `_chunks/`, what they import bundled in: an installed bundle has no
 *    `node_modules`. Node's own modules stay imports. zod is refused: a module validates with
 *    `sdk.z`, the hub's own, never a copy of its own.
 * 4. The build is loaded back the way `hub` loads it, its code handed a fake SDK.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { rolldown, type Plugin } from 'rolldown';

import {
  instantiateVendor,
  readVendorDirectory,
  type VendorDeclaration,
} from '@nebulahome/package-runtime';

import { checkIntegration } from './check.js';
import { IntegrationError, runtimeVersion, type IntegrationProject } from './project.js';
import { createFakeSdk } from './testing/fake-sdk.js';

/** The extensions of code: built from the modules the bundle names, never copied. */
const CODE_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.jsx']);

/** Where what the modules share is written, inside the vendor: no driver can be called so. */
export const CHUNKS_DIRECTORY = '_chunks';

/** What building wrote. */
export type BuildResult = {
  readonly project: IntegrationProject;

  /** `dist/<vendor>/`. */
  readonly outputDirectory: string;

  /** How many files were copied, and how many modules were built. */
  readonly files: number;
  readonly modules: number;
};

/**
 * Every module the bundle names, by its source.
 *
 * @param declaration - What the sources declare.
 * @returns The sources' paths, each once.
 */
function modulesOf(declaration: VendorDeclaration): string[] {
  return [
    ...new Set([
      ...declaration.transports.map((module) => module.path),
      ...declaration.streams.map((module) => module.path),
      ...(declaration.account === undefined ? [] : [declaration.account.module]),
      ...(declaration.discovery === undefined ? [] : declaration.discovery.modules.values()),
      ...declaration.drivers.flatMap((driver) =>
        driver.entry === undefined ? [] : [driver.entry],
      ),
    ]),
  ];
}

/**
 * A module's name in the build: its path under `src/` without the extension, `lan/transport`,
 * which the build writes as `lan/transport.js` - where the bundle names it.
 *
 * @param project - The project.
 * @param file - The module's source.
 * @returns The name.
 */
function entryNameOf(project: IntegrationProject, file: string): string {
  const relative = path.relative(project.sourceDirectory, file);

  return relative
    .slice(0, relative.length - path.extname(relative).length)
    .split(path.sep)
    .join('/');
}

/**
 * Whether an import is one of Node's own modules, which the hub's Node provides.
 *
 * @param id - What is imported.
 * @returns True when it is.
 */
function isNodeBuiltin(id: string): boolean {
  return (
    id.startsWith('node:') ||
    builtinModules.includes(id) ||
    builtinModules.includes(id.split('/')[0] ?? '')
  );
}

/**
 * Refuses what an integration's code must not import.
 *
 * @returns The plugin.
 */
function refusedImports(): Plugin {
  return {
    name: 'nebulahome:integration-imports',

    /**
     * Refuses zod, and the SDK's testing.
     *
     * @param source - What is imported.
     * @param importer - Who imports it.
     * @returns Nothing: what is not refused is resolved as usual.
     * @throws {Error} When it is refused.
     */
    resolveId(source: string, importer: string | undefined): null {
      const by = importer === undefined ? '' : ` (in ${importer})`;

      if (source === 'zod' || source.startsWith('zod/')) {
        throw new Error(
          `An integration's code builds its schemas with sdk.z, the hub's zod, and does not import zod${by}`,
        );
      }

      if (source.startsWith('@nebulahome/integration-sdk/testing')) {
        throw new Error(`@nebulahome/integration-sdk/testing is for tests, not for a module${by}`);
      }

      return null;
    },
  };
}

/**
 * Copies every file of the sources that is not code: the JSON without its `$schema`, the manifest
 * with the release's version and runtime range.
 *
 * @param project - The project.
 * @returns How many files were copied.
 */
async function copyFiles(project: IntegrationProject): Promise<number> {
  const entries = await readdir(project.sourceDirectory, { recursive: true, withFileTypes: true });
  let copied = 0;

  await Promise.all(
    entries.map(async (entry) => {
      const source = path.join(entry.parentPath, entry.name);
      const relative = path.relative(project.sourceDirectory, source);

      if (
        !entry.isFile() ||
        entry.name.startsWith('.') ||
        CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        return;
      }

      const target = path.join(project.outputDirectory, relative);

      await mkdir(path.dirname(target), { recursive: true });
      copied += 1;

      if (path.extname(entry.name).toLowerCase() !== '.json') {
        await writeFile(target, await readFile(source));

        return;
      }

      const parsed = JSON.parse(await readFile(source, 'utf8')) as unknown;
      let written: unknown = parsed;

      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const { id, ...rest }: Record<string, unknown> = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).filter(([key]) => key !== '$schema'),
        );

        // The manifest: the id first, then what the build writes, then the rest as written.
        written =
          relative === 'manifest.json'
            ? { id, version: project.stamp.version, sdk: project.stamp.sdk, ...rest }
            : { ...(id === undefined ? {} : { id }), ...rest };
      }

      await writeFile(target, `${JSON.stringify(written, null, 2)}\n`);
    }),
  );

  return copied;
}

/**
 * Builds every module the bundle names into the vendor directory.
 *
 * @param project - The project.
 * @param modules - The modules' sources.
 * @returns Once they are written.
 * @throws {IntegrationError} When the code does not build, or imports what it must not.
 */
async function buildModules(
  project: IntegrationProject,
  modules: readonly string[],
): Promise<void> {
  if (modules.length === 0) {
    return;
  }

  try {
    const bundle = await rolldown({
      input: Object.fromEntries(modules.map((file) => [entryNameOf(project, file), file])),
      cwd: project.root,
      platform: 'node',
      // A TypeScript module imports a sibling by the name it is built to: `./packet.js`.
      resolve: { extensionAlias: { '.js': ['.ts', '.js'], '.mjs': ['.mts', '.mjs'] } },
      external: isNodeBuiltin,
      plugins: [refusedImports()],
      logLevel: 'warn',
    });

    try {
      await bundle.write({
        dir: project.outputDirectory,
        format: 'esm',
        entryFileNames: '[name].js',
        chunkFileNames: `${CHUNKS_DIRECTORY}/[name]-[hash].js`,
        sourcemap: false,
      });
    } finally {
      await bundle.close();
    }
  } catch (error: unknown) {
    throw new IntegrationError([
      `The code does not build: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
}

/**
 * Loads the build back the way `hub` loads it, its code handed a fake SDK.
 *
 * @param project - The project.
 * @returns Once it loaded.
 * @throws {IntegrationError} When it does not, every driver included.
 */
async function loadBack(project: IntegrationProject): Promise<void> {
  const fake = createFakeSdk();

  try {
    const declaration = await readVendorDirectory(project.outputDirectory, {
      expectedId: project.vendorId,
      runtimeVersion: runtimeVersion(),
    });
    const { vendor, failures } = await instantiateVendor(declaration, {
      sdk: fake.sdk,
      release: fake.release,

      /**
       * Imports a module of the build.
       *
       * @param file - The module.
       * @returns The module.
       */
      importModule: async (file: string): Promise<unknown> => import(pathToFileURL(file).href),
    });

    await vendor?.release();

    if (vendor === null || failures.length > 0) {
      throw new IntegrationError(failures.map((failure) => `dist: ${failure.message}`));
    }
  } catch (error: unknown) {
    if (error instanceof IntegrationError) {
      throw error;
    }

    throw new IntegrationError([
      `The build does not load: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
}

/**
 * Checks the sources and builds them into `dist/<vendor>/`.
 *
 * @param options - Where the repository is.
 * @param options.root - Its folder.
 * @returns What was written.
 * @throws {IntegrationError} With every problem found.
 */
export async function buildIntegration(options: { readonly root: string }): Promise<BuildResult> {
  const { project, declaration } = await checkIntegration(options);
  const modules = modulesOf(declaration);

  await rm(project.outputRoot, { recursive: true, force: true });

  const files = await copyFiles(project);

  await buildModules(project, modules);
  await loadBack(project);

  return { project, outputDirectory: project.outputDirectory, files, modules: modules.length };
}
