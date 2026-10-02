/**
 * `buildPackage`: a package's release, staged (PACKAGES_DOCS.md 3.4) - what
 * `nebulahome-package build` runs.
 *
 * It checks the declaration first, so a mistake costs no build; then builds the interface and the
 * server through the package's own `vite.config.ts` - whose `nebula()` plugin knows which half it
 * builds - and writes what is left: the manifest, `setup.json`, the files the declaration names,
 * and the `package.json` that tells Node the server is an ES module.
 */
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { build, resolveConfig, type LogLevel } from 'vite';

import { isRecord } from '../build/fields.js';
import { generatePackage, RELEASE_PATHS, type GeneratedPackage } from '../build/manifest.js';
import { PackageConfigError } from '../build/problems.js';
import { SDK_VERSION } from '../version.js';

import { loadPackage } from './load.js';
import { PLUGIN_NAME, type NebulaOptions } from './plugin.js';

/** What building takes. */
export type BuildOptions = {
  /** The package's folder: the working directory when not said. */
  readonly root?: string;

  /** How much Vite says. */
  readonly logLevel?: LogLevel;
};

/** A package, checked: its declaration and what it generates, before anything is built. */
export type CheckedPackage = {
  readonly root: string;
  readonly configPath: string;
  readonly outDir: string;
  readonly definition: unknown;
  readonly packageJson: Readonly<Record<string, unknown>>;
  readonly generated: GeneratedPackage;
};

/** The largest compose file a release carries. */
const COMPOSE_LIMIT = 64 * 1024;

/**
 * Says whether a file is there.
 *
 * @param file - The file.
 * @returns True when it is.
 */
async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);

    return true;
  } catch {
    return false;
  }
}

/**
 * The options the package's `vite.config.ts` gave `nebula()`.
 *
 * @param root - The package's folder.
 * @param logLevel - How much Vite says.
 * @returns Them.
 * @throws {PackageConfigError} When the config has no `nebula()`.
 */
async function pluginOptions(root: string, logLevel: LogLevel): Promise<NebulaOptions> {
  const resolved = await resolveConfig({ root, logLevel }, 'build', 'production');
  const plugin = resolved.plugins.find((each) => each.name === PLUGIN_NAME);
  const api: unknown = plugin?.api;

  if (plugin === undefined || !isRecord(api) || !isRecord(api['options'])) {
    throw new PackageConfigError([
      'vite.config.ts has no nebula() among its plugins: plugins: [react(), tailwindcss(), nebula()]',
    ]);
  }

  const { config, outDir } = api['options'];

  return {
    ...(typeof config === 'string' ? { config } : {}),
    ...(typeof outDir === 'string' ? { outDir } : {}),
  };
}

/**
 * Checks a package without building it: its declaration against the platform's schemas, and the
 * files it names.
 *
 * @param options - Where the package is.
 * @returns The package, checked.
 * @throws {PackageConfigError} With every problem, when it does not hold together.
 */
export async function checkPackage(options: BuildOptions = {}): Promise<CheckedPackage> {
  const root = path.resolve(options.root ?? '.');
  const plugin = await pluginOptions(root, options.logLevel ?? 'warn');
  const { definition, configPath } = await loadPackage(root, plugin.config ?? 'nebula.config.ts');
  const packageJson: unknown = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

  if (!isRecord(packageJson)) {
    throw new PackageConfigError(['package.json is not an object']);
  }

  const generated = generatePackage(definition, {
    packageJson,
    sdkVersion: SDK_VERSION,
    hasStyles: false,
  });
  const base = path.dirname(configPath);
  const missing: string[] = [];

  for (const file of [
    ...generated.copies.map((copy) => copy.from),
    ...(generated.server === null ? [] : [generated.server]),
  ]) {
    // eslint-disable-next-line no-await-in-loop -- a handful of files, checked once
    if (!(await exists(path.resolve(base, file)))) {
      missing.push(`${file}: the declaration names it, and it is not there`);
    }
  }

  const compose = generated.copies.find((copy) => copy.to === RELEASE_PATHS.compose);

  if (compose !== undefined && (await exists(path.resolve(base, compose.from)))) {
    const { size } = await stat(path.resolve(base, compose.from));

    if (size > COMPOSE_LIMIT) {
      missing.push(`${compose.from}: a compose file is at most 64 KB`);
    }
  }

  if (missing.length > 0) {
    throw new PackageConfigError(missing);
  }

  return {
    root,
    configPath,
    outDir: path.resolve(root, plugin.outDir ?? 'dist'),
    definition,
    packageJson,
    generated,
  };
}

/**
 * Writes what a release holds besides its two builds.
 *
 * @param checked - The package.
 * @param generated - Its manifest, settings and copies, as built.
 */
async function writeRelease(checked: CheckedPackage, generated: GeneratedPackage): Promise<void> {
  const { outDir, configPath } = checked;

  /**
   * A value as a JSON file holds it.
   *
   * @param value - The value.
   * @returns Its text, indented, with a final newline.
   */
  const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, RELEASE_PATHS.manifest), json(generated.manifest));

  if (generated.setup !== null) {
    await writeFile(path.join(outDir, RELEASE_PATHS.setup), json(generated.setup));
  }

  for (const copy of generated.copies) {
    // eslint-disable-next-line no-await-in-loop -- the logo and a compose file at most
    await copyFile(path.resolve(path.dirname(configPath), copy.from), path.join(outDir, copy.to));
  }

  if (generated.server !== null) {
    await writeFile(
      path.join(outDir, path.dirname(RELEASE_PATHS.server), 'package.json'),
      json({ type: 'module' }),
    );
  }
}

/**
 * Builds a package's release into its `outDir`: checked, both halves built, the manifest written.
 *
 * @param options - Where the package is, and how much Vite says.
 * @returns The package, as released.
 * @throws {PackageConfigError} With every problem, when it does not hold together.
 */
export async function buildPackage(options: BuildOptions = {}): Promise<CheckedPackage> {
  const checked = await checkPackage(options);
  const { root, outDir, definition, packageJson } = checked;
  const logLevel = options.logLevel ?? 'warn';

  await rm(outDir, { recursive: true, force: true });

  if (checked.generated.hasUi) {
    await build({ root, logLevel, mode: 'production' });
  }

  if (checked.generated.server !== null) {
    await build({ root, logLevel, mode: 'production', build: { ssr: true } });
  }

  const generated = generatePackage(definition, {
    packageJson,
    sdkVersion: SDK_VERSION,
    hasStyles: await exists(path.join(outDir, RELEASE_PATHS.styles)),
  });

  await writeRelease(checked, generated);

  return { ...checked, generated };
}
