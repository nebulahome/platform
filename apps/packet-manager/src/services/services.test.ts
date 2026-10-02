/**
 * The installer against archives made here, the index client against a fake of its server, and a
 * package's process against a runner that stands in for the SDK's.
 */
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from '@nebulahome/logging';

import { RestartPolicy } from '../domain/restart-policy.js';
import { archiveOf, fakeRunner, manifest, scratch, writePackage } from '../testing/fixtures.js';

import { PackageIndexClient } from './index-client.js';
import { installRelease } from './installer.js';
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
    const url = 'https://github.com/nebula-home/pkg-nvr/releases/download/v1.4.0/nvr-1.4.0.tgz';
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
