/**
 * The installer against archives made here, the index client against a fake of its server and a
 * local folder, and a package's process against a runner that stands in for the SDK's.
 */
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from '@nebulahome/logging';

import { RestartPolicy } from '../domain/restart-policy.js';
import { archiveOf, fakeRunner, manifest, scratch, writePackage } from '../testing/fixtures.js';

import { PackageIndexClient } from './index-client.js';
import { installRelease } from './installer.js';
import { LocalReleases } from './local-releases.js';
import { PackageProcess, type ProcessState } from './package-process.js';

const logger = createLogger({ service: 'packet-manager', version: '0.0.0', level: 'fatal' });
const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.map(async (folder) => rm(folder, { recursive: true, force: true })));
  folders.length = 0;
});

/**
 * A scratch folder, removed after the test.
 *
 * @returns Its path.
 */
async function folder(): Promise<string> {
  const made = await scratch();

  folders.push(made);

  return made;
}

/**
 * A fetch that answers one address with some bytes.
 *
 * @param url - The address.
 * @param bytes - What it answers.
 * @returns The fetch.
 */
function serving(url: string, bytes: Buffer): typeof fetch {
  return async (input) =>
    Promise.resolve(
      String(input instanceof Request ? input.url : input) === url
        ? new Response(new Uint8Array(bytes))
        : new Response('not found', { status: 404 }),
    );
}

describe('installing a release', () => {
  it('unpacks an archive whose size and digest are the index’s into its folder', async () => {
    const work = await folder();
    const source = await writePackage(
      path.join(work, 'source'),
      manifest({ id: 'nvr', version: '1.4.0' }),
    );
    const archive = await archiveOf(source, path.join(work, 'nvr.tgz'));
    const url = 'https://github.com/nebulahome/pkg-nvr/releases/download/v1.4.0/nvr-1.4.0.tgz';
    const packages = path.join(work, 'packages');

    const files = await installRelease(
      {
        id: 'nvr',
        version: '1.4.0',
        artifact: { url, size: archive.size, sha256: archive.sha256 },
      },
      packages,
      { timeoutMs: 5000, fetch: serving(url, archive.bytes) },
    );

    expect(files.root).toBe(path.join(packages, 'nvr', '1.4.0'));
    expect(files.manifest.name).toBe('NVR');
    expect(existsSync(path.join(files.root, 'ui', 'index.js'))).toBe(true);
    expect(existsSync(path.join(packages, 'nvr', 'nvr-1.4.0.tgz'))).toBe(false);
  });

  it('refuses an archive whose digest is not the index’s, and one of another package', async () => {
    const work = await folder();
    const source = await writePackage(path.join(work, 'source'), manifest({ id: 'nvr' }));
    const archive = await archiveOf(source, path.join(work, 'nvr.tgz'));
    const url = 'https://example.com/nvr.tgz';
    const packages = path.join(work, 'packages');
    const fetch = serving(url, archive.bytes);

    await expect(
      installRelease(
        {
          id: 'nvr',
          version: '1.0.0',
          artifact: { url, size: archive.size, sha256: 'a'.repeat(64) },
        },
        packages,
        { timeoutMs: 5000, fetch },
      ),
    ).rejects.toThrow(/not the one the index names/u);
    await expect(
      installRelease(
        {
          id: 'mqtt',
          version: '1.0.0',
          artifact: { url, size: archive.size, sha256: archive.sha256 },
        },
        packages,
        { timeoutMs: 5000, fetch },
      ),
    ).rejects.toThrow(/is nvr 1\.0\.0, not mqtt 1\.0\.0/u);
    expect(existsSync(path.join(packages, 'nvr', '1.0.0'))).toBe(false);
    expect(existsSync(path.join(packages, 'mqtt', '1.0.0'))).toBe(false);
  });

  it('installs a local file with the same checks', async () => {
    const work = await folder();
    const source = await writePackage(path.join(work, 'source'), manifest({ id: 'nvr' }));
    const file = path.join(work, 'nvr-1.0.0.tgz');
    const archive = await archiveOf(source, file);
    const url = pathToFileURL(file).href;
    const packages = path.join(work, 'packages');

    const files = await installRelease(
      {
        id: 'nvr',
        version: '1.0.0',
        artifact: { url, size: archive.size, sha256: archive.sha256 },
      },
      packages,
      { timeoutMs: 5000 },
    );

    expect(files.manifest.id).toBe('nvr');

    // The file changed after it was read: its bytes are not the ones that were offered.
    const changed = Buffer.from(archive.bytes);

    changed[20] = (changed[20] ?? 0) ^ 0xff;
    await writeFile(file, changed);
    await expect(
      installRelease(
        {
          id: 'nvr',
          version: '1.0.0',
          artifact: { url, size: archive.size, sha256: archive.sha256 },
        },
        packages,
        { timeoutMs: 5000 },
      ),
    ).rejects.toThrow(/not the one the index names/u);
  });
});

describe('the local folder', () => {
  it('offers each archive as a release, read out of the archive, and skips what is not one', async () => {
    const work = await folder();
    const local = path.join(work, 'local');

    await mkdir(local);

    for (const version of ['0.2.0', '0.3.0']) {
      const source = await writePackage(
        path.join(work, `weather-${version}`),
        manifest({ id: 'weather', version, provides: ['forecast'] }),
      );

      await archiveOf(source, path.join(local, `weather-${version}.tgz`));
    }

    await writeFile(path.join(local, 'broken.tgz'), 'not an archive');
    await writeFile(path.join(local, 'notes.txt'), 'not even one');

    const entries = await new LocalReleases(local, logger).entries();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'weather',
      name: 'WEATHER',
      repository: 'local/weather',
      category: 'other',
    });
    expect(entries[0]?.versions.map((release) => release.version)).toEqual(['0.3.0', '0.2.0']);
    expect(entries[0]?.versions[0]).toMatchObject({
      provides: ['forecast'],
      artifact: { url: pathToFileURL(path.join(local, 'weather-0.3.0.tgz')).href },
    });
    expect(await new LocalReleases(path.join(work, 'missing'), logger).entries()).toEqual([]);
    expect(await new LocalReleases(undefined, logger).entries()).toEqual([]);
  });
});

describe('the package index', () => {
  it('reads the index once for a while, and keeps the last good one through a failure', async () => {
    let now = 1_000_000;
    let isBroken = false;
    const fetch = vi.fn(async () =>
      Promise.resolve(
        isBroken
          ? new Response('nope', { status: 500 })
          : Response.json({ generatedAt: '2026-09-29T08:00:00Z', packages: [] }),
      ),
    );
    const client = new PackageIndexClient({
      url: 'https://example.com/index.json',
      ttlMs: 60_000,
      logger,
      fetch,
      now: () => now,
    });

    expect((await client.read()).index?.packages).toEqual([]);
    await client.read();
    expect(fetch).toHaveBeenCalledTimes(1);

    isBroken = true;
    now += 120_000;

    const failed = await client.read();

    expect(failed.error).toMatch(/HTTP 500/u);
    expect(failed.index?.packages).toEqual([]);
  });

  it('says why nothing is offered when no index is set', async () => {
    const client = new PackageIndexClient({ url: undefined, ttlMs: 60_000, logger });

    expect(await client.read()).toMatchObject({
      index: null,
      error: expect.stringMatching(/PACKAGE_INDEX_URL/u) as unknown,
    });
  });

  it('puts the local folder’s releases in, winning over the index’s of the same version', async () => {
    /**
     * A release.
     *
     * @param version - Its version.
     * @param url - Its archive's address.
     * @returns The release.
     */
    const release = (version: string, url: string) => ({
      version,
      platform: '^1.0.0',
      sdk: '^1.0.0',
      requires: { packages: {}, services: [] },
      provides: [],
      artifact: { url, size: 1, sha256: 'a'.repeat(64) },
      publishedAt: new Date('2026-10-02T08:00:00Z'),
    });
    const entry = {
      id: 'weather',
      name: 'Weather',
      description: 'The weather.',
      repository: 'nebulahome/pkg-weather',
      category: 'other' as const,
    };
    const indexed = {
      generatedAt: '2026-09-29T08:00:00Z',
      packages: [
        {
          ...entry,
          versions: [
            { ...release('0.3.0', 'https://example.com/w-0.3.0.tgz'), publishedAt: undefined },
            { ...release('0.2.0', 'https://example.com/w-0.2.0.tgz'), publishedAt: undefined },
          ].map((each) => ({ ...each, publishedAt: '2026-09-28T08:00:00Z' })),
        },
      ],
    };
    const local = async () =>
      Promise.resolve([{ ...entry, versions: [release('0.3.0', 'file:///local/w-0.3.0.tgz')] }]);
    const merged = await new PackageIndexClient({
      url: 'https://example.com/index.json',
      ttlMs: 60_000,
      logger,
      fetch: async () => Promise.resolve(Response.json(indexed)),
      local,
    }).read();

    expect(
      merged.index?.packages[0]?.versions.map((each) => [each.version, each.artifact.url]),
    ).toEqual([
      ['0.3.0', 'file:///local/w-0.3.0.tgz'],
      ['0.2.0', 'https://example.com/w-0.2.0.tgz'],
    ]);

    const alone = await new PackageIndexClient({
      url: undefined,
      ttlMs: 60_000,
      logger,
      local,
    }).read();

    expect(alone.error).toBeNull();
    expect(alone.index?.packages.map((each) => each.id)).toEqual(['weather']);
  });
});

describe("a package's process", () => {
  it('runs until stopped, its output kept as its log', async () => {
    const work = await folder();
    const states: ProcessState[] = [];
    const process = new PackageProcess(
      {
        id: 'mqtt',
        runner: await fakeRunner(work),
        entry: path.join(work, 'server.js'),
        cwd: work,
        env: { NEBULA_PACKAGE_ID: 'mqtt' },
      },
      { logger, onState: (state) => states.push(state) },
    );

    process.start();

    await vi.waitFor(() => {
      expect(process.logs.read(10).lines.map((line) => line.text)).toContain(
        `started mqtt ${path.join(work, 'server.js')}`,
      );
    });

    await process.stop();

    expect(states.map((state) => state.kind)).toEqual(['starting', 'stopped']);
    expect(process.isRunning).toBe(false);
  });

  it('starts one that exits again, and gives up on one that keeps exiting', async () => {
    const work = await folder();
    const states: ProcessState[] = [];
    const process = new PackageProcess(
      { id: 'nvr', runner: await fakeRunner(work, 3), entry: 'server.js', cwd: work, env: {} },
      {
        logger,
        onState: (state) => states.push(state),
        policy: new RestartPolicy({
          baseDelayMs: 10,
          maximumDelayMs: 20,
          maximumExits: 3,
          windowMs: 60_000,
          stableMs: 60_000,
        }),
      },
    );

    process.start();

    await vi.waitFor(
      () => {
        expect(states.at(-1)).toEqual({ kind: 'failed', reason: 'something went wrong' });
      },
      { timeout: 10_000 },
    );

    expect(states.filter((state) => state.kind === 'exited')).toHaveLength(2);
  });
});
