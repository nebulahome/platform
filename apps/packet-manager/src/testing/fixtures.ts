/**
 * What the packet-manager's tests are made of: package folders, their archives, an index serving
 * them, a runner that stands in for the SDK's, and a store in memory.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { create } from 'tar';

import { jsonObjectSchema, type JsonObject, type PackageManifest } from '@nebulahome/contracts';

import type { PackageRow, PackageStore } from '../persistence/packages.js';

/**
 * A folder of its own for a test.
 *
 * @returns Its path.
 */
export async function scratch(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'packet-manager-'));
}

/**
 * A manifest, with what a test does not care about filled in.
 *
 * @param fields - What differs.
 * @returns The manifest, as it is written to disk.
 */
export function manifest(fields: Partial<PackageManifest> & { id: string }): JsonObject {
  const written: Record<string, unknown> = {
    version: '1.0.0',
    platform: '^1.0.0',
    sdk: '^1.0.0',
    name: fields.id.toUpperCase(),
    description: `The ${fields.id} package.`,
    category: 'other',
    runtime: 'none',
    ui: { entry: './ui/index.js' },
    ...fields,
  };

  return jsonObjectSchema.parse(written);
}

/**
 * Writes a package's folder.
 *
 * @param root - Where.
 * @param written - Its manifest.
 * @param setup - Its `setup.json`, when it has settings.
 * @returns The folder.
 */
export async function writePackage(
  root: string,
  written: JsonObject,
  setup?: JsonObject,
): Promise<string> {
  await mkdir(path.join(root, 'ui'), { recursive: true });
  await mkdir(path.join(root, 'server'), { recursive: true });
  await writeFile(path.join(root, 'nebula.package.json'), JSON.stringify(written));

  if (setup !== undefined) {
    await writeFile(path.join(root, 'setup.json'), JSON.stringify(setup));
  }

  await writeFile(path.join(root, 'ui', 'index.js'), 'export default {};\n');
  await writeFile(path.join(root, 'server', 'index.js'), 'export default { start() {} };\n');

  return root;
}

/**
 * An archive of a package's folder, as a release carries it.
 *
 * @param folder - The folder.
 * @param file - Where the archive goes.
 * @returns Its bytes, size and SHA-256.
 */
export async function archiveOf(
  folder: string,
  file: string,
): Promise<{ bytes: Buffer; size: number; sha256: string }> {
  await create({ gzip: true, file, cwd: folder }, ['.']);

  const bytes = await readFile(file);

  return { bytes, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/**
 * A runner that stands in for the SDK's: says it started, writes a line to stderr, then either
 * keeps running until SIGTERM or exits at once with the code given.
 *
 * @param folder - Where to write it.
 * @param exitCode - The code it exits with at once; it keeps running when not given.
 * @returns Its path.
 */
export async function fakeRunner(folder: string, exitCode?: number): Promise<string> {
  const file = path.join(
    folder,
    exitCode === undefined ? 'runner.mjs' : `runner-${String(exitCode)}.mjs`,
  );

  await writeFile(
    file,
    [
      "console.log(`started ${process.env.NEBULA_PACKAGE_ID} ${process.argv[2] ?? ''}`);",
      "console.error('something went wrong');",
      'console.log(`settings ${process.env.NEBULA_PACKAGE_SETTINGS}`);',
      ...(exitCode === undefined ? [] : [`process.exit(${String(exitCode)});`]),
      'const keep = setInterval(() => {}, 1000);',
      "process.on('SIGTERM', () => { clearInterval(keep); process.exit(0); });",
      '',
    ].join('\n'),
  );

  return file;
}

/**
 * `system.packages`, in memory.
 *
 * @returns The store, and its rows.
 */
export function memoryStore(): PackageStore & { readonly rows: Map<string, PackageRow> } {
  const rows = new Map<string, PackageRow>();

  return {
    rows,

    /**
     * Every row.
     *
     * @returns Copies.
     */
    list: async () => Promise.resolve([...rows.values()].map((row) => ({ ...row }))),

    /**
     * Writes a row.
     *
     * @param row - What it holds.
     * @returns Once written.
     */
    insert: async (row) => {
      const now = new Date();

      rows.set(row.id, {
        id: row.id,
        version: row.manifest.version,
        runtime: row.manifest.runtime,
        state: row.state,
        source: row.source,
        manifest: row.manifest as unknown as JsonObject,
        config: {},
        previousVersion: null,
        artifactSha256: row.artifactSha256,
        lastStartedAt: null,
        lastError: null,
        installedAt: now,
        updatedAt: now,
      });

      return Promise.resolve();
    },

    /**
     * Changes a row.
     *
     * @param id - Which.
     * @param fields - What.
     * @returns Once changed.
     */
    update: async (id, fields) => {
      const row = rows.get(id);

      if (row !== undefined) {
        rows.set(id, {
          ...row,
          ...fields,
          manifest: (fields.manifest as unknown as JsonObject | undefined) ?? row.manifest,
          updatedAt: new Date(),
        });
      }

      return Promise.resolve();
    },

    /**
     * Deletes a row.
     *
     * @param id - Which.
     * @returns Once deleted.
     */
    remove: async (id) => {
      rows.delete(id);

      return Promise.resolve();
    },
  };
}
