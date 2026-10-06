/**
 * Installing integrations against a bus in memory standing in for `hub`, the local integrations
 * folder and a Hub faked over fetch: a local bundle listed and installed, a build `hub` does not
 * load taken away with the copy before left running, a rebuild reinstalled in place of the build
 * before, a release of the index installed and reported, and a removal.
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { create } from 'tar';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BusClient } from '@nebulahome/bus';
import { FakeTransport } from '@nebulahome/bus/testing';
import {
  busSubjects,
  HUB_CATALOGUE_METHOD,
  HUB_SERVICE,
  HUB_VENDOR_LOAD_METHOD,
  vendorLoadRequestSchema,
  type VendorLoadReply,
  type VendorLoadRequest,
} from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';
import { INSTALL_MARKER_FILE } from '@nebulahome/package-runtime';

import type { HubInstallEvent } from '../services/hub-client.js';
import { CommunityHubClient } from '../services/hub-client.js';
import { IntegrationIndexClient } from '../services/index-client.js';
import { LocalIntegrationReleases } from '../services/local-releases.js';
import { scratch } from '../testing/fixtures.js';

import { IntegrationManager } from './integration-manager.js';

const logger = createLogger({ service: 'packet-manager', version: '0.0.0', level: 'fatal' });
const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.map(async (folder) => rm(folder, { recursive: true, force: true })));
  folders.length = 0;
});

/**
 * Writes a vendor's bundle and packs it as `nebulahome-integration pack` does: under a
 * `<vendor>/` folder.
 *
 * @param work - A scratch folder.
 * @param file - Where the archive goes.
 * @param manifest - What its manifest says.
 * @param manifest.id - The vendor.
 * @param manifest.version - The release.
 * @param note - Something that makes two archives of one version differ.
 * @returns Its bytes, size and SHA-256.
 */
async function packVendor(
  work: string,
  file: string,
  manifest: { id: string; version: string },
  note = 'first',
): Promise<{ bytes: Buffer; size: number; sha256: string }> {
  const staging = path.join(work, `staging-${note}`);
  const root = path.join(staging, manifest.id);

  await mkdir(path.join(root, 'plug'), { recursive: true });
  await writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify({ ...manifest, sdk: '^1.0.0', name: 'Acme', description: 'Plugs.' }),
  );
  await writeFile(path.join(root, 'plug', 'driver.json'), JSON.stringify({ note }));
  await mkdir(path.dirname(file), { recursive: true });
  await create({ gzip: true, file, cwd: staging }, [manifest.id]);

  const bytes = await readFile(file);

  return { bytes, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/**
 * A manager over a local folder, a bus standing in for `hub`, and optionally a Hub.
 *
 * @param options - How `hub` answers, and whether a Hub is set.
 * @param options.load - What `hub` answers a load; it loads whatever is asked when not said.
 * @param options.hubFetch - The Hub, faked; none set when not said.
 * @returns The manager and what it was handed.
 */
async function setUp(
  options: {
    load?: (request: VendorLoadRequest) => VendorLoadReply;
    hubFetch?: typeof fetch;
  } = {},
): Promise<{
  manager: IntegrationManager;
  work: string;
  integrationsDir: string;
  localDir: string;
  loads: VendorLoadRequest[];
  reported: HubInstallEvent[];
}> {
  const work = await scratch();

  folders.push(work);

  const integrationsDir = path.join(work, 'data', 'hub', 'integrations');
  const localDir = path.join(work, 'local');
  const transport = new FakeTransport();
  const hub = new BusClient({ transport, source: 'hub', logger });
  const loads: VendorLoadRequest[] = [];
  const reported: HubInstallEvent[] = [];

  hub.serve(
    busSubjects.service(HUB_SERVICE, HUB_VENDOR_LOAD_METHOD),
    vendorLoadRequestSchema,
    (request) => {
      loads.push(request);

      return (
        options.load?.(request) ?? {
          isLoaded: request.install !== undefined,
          version: request.install?.version ?? null,
          origin: request.install === undefined ? null : 'installed',
          failures: [],
          isRestartNeeded: false,
        }
      );
    },
  );
  hub.serve(busSubjects.service(HUB_SERVICE, HUB_CATALOGUE_METHOD), z.unknown(), () => ({
    vendors: [],
  }));

  const local = new LocalIntegrationReleases(localDir, logger);
  const hubUrl = options.hubFetch === undefined ? undefined : 'https://hub.example';
  const manager = new IntegrationManager({
    index: new IntegrationIndexClient({
      url: hubUrl === undefined ? undefined : `${hubUrl}/v1/index/integrations.json`,
      ttlMs: 60_000,
      logger,
      ...(options.hubFetch === undefined ? {} : { fetch: options.hubFetch }),

      /**
       * The local folder's releases.
       *
       * @returns Them.
       */
      local: async () => local.entries(),
    }),
    hub: new CommunityHubClient({
      url: hubUrl,
      logger,
      ...(options.hubFetch === undefined ? {} : { fetch: options.hubFetch }),
    }),
    client: new BusClient({ transport, source: 'packet-manager', logger, requestTimeoutMs: 500 }),
    logger,
    integrationsDir,
    cacheDir: path.join(work, 'data', 'cache', 'integrations'),
    runtimeVersion: '1.6.0',
    downloadTimeoutMs: 10_000,
    reporter: { report: (event) => reported.push(event) },
    ...(options.hubFetch === undefined ? {} : { fetch: options.hubFetch }),
  });

  return { manager, work, integrationsDir, localDir, loads, reported };
}

/**
 * The build folders of a vendor.
 *
 * @param integrationsDir - The data directory's `hub/integrations/`.
 * @param vendorId - The vendor.
 * @returns Their names.
 */
async function buildsOf(integrationsDir: string, vendorId: string): Promise<string[]> {
  const entries = await readdir(path.join(integrationsDir, vendorId), { withFileTypes: true });

  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

describe('installing integrations', () => {
  it('lists a bundle of the local folder, installs it, and names its build current', async () => {
    const { manager, work, integrationsDir, localDir, loads, reported } = await setUp();

    await packVendor(work, path.join(localDir, 'acme-1.0.0.tgz'), { id: 'acme', version: '1.0.0' });

    const found = await manager.search({});

    expect(found.hubError).toBe('No Community Hub is set: COMMUNITY_HUB_URL');
    expect(found.items).toMatchObject([
      {
        id: 'acme',
        name: 'Acme',
        origin: 'local',
        installedVersion: null,
        latest: { version: '1.0.0', source: 'local', bundleKind: 'declarative' },
        unavailableReason: null,
      },
    ]);

    const installed = await manager.install(
      'acme',
      undefined,
      '0192a6f0-0000-7000-8000-00000000000a',
    );
    const marker = JSON.parse(
      await readFile(path.join(integrationsDir, 'acme', INSTALL_MARKER_FILE), 'utf8'),
    ) as Record<string, unknown>;

    expect(installed).toMatchObject({ vendorId: 'acme', action: 'installed', warnings: [] });
    expect(marker).toMatchObject({
      build: installed.install.build,
      version: '1.0.0',
      source: 'local',
      installedBy: '0192a6f0-0000-7000-8000-00000000000a',
    });
    expect(loads).toEqual([{ vendorId: 'acme', install: installed.install }]);
    expect(
      (
        await stat(path.join(integrationsDir, 'acme', installed.install.build, 'manifest.json'))
      ).isFile(),
    ).toBe(true);
    // A file of the local folder is not the Hub's to count.
    expect(reported).toEqual([]);
    expect((await manager.search({ q: 'acme' })).items[0]?.installedVersion).toBe('1.0.0');
  });

  it('takes away a build hub did not load, and leaves the one before current', async () => {
    let isBroken = false;
    const { manager, work, integrationsDir, localDir } = await setUp({
      load: (request) =>
        isBroken
          ? {
              isLoaded: true,
              version: '1.0.0',
              origin: 'installed',
              failures: ['acme/plug: driver.json is not a driver'],
              isRestartNeeded: false,
            }
          : {
              isLoaded: true,
              version: request.install?.version ?? null,
              origin: 'installed',
              failures: [],
              isRestartNeeded: false,
            },
    });

    await packVendor(work, path.join(localDir, 'acme-1.0.0.tgz'), { id: 'acme', version: '1.0.0' });

    const first = await manager.install('acme');

    await packVendor(work, path.join(localDir, 'acme-1.1.0.tgz'), { id: 'acme', version: '1.1.0' });
    isBroken = true;

    await expect(manager.install('acme')).rejects.toThrow(
      'Acme 1.1.0 did not load: acme/plug: driver.json is not a driver',
    );
    expect(await buildsOf(integrationsDir, 'acme')).toEqual([first.install.build]);
    expect((await manager.available()).items).toMatchObject([
      { vendorId: 'acme', installedVersion: '1.0.0', latestVersion: '1.1.0', hasUpdate: true },
    ]);
  });

  it('reinstalls a rebuild of the version installed, in place of the build before', async () => {
    const { manager, work, integrationsDir, localDir } = await setUp();
    const file = path.join(localDir, 'acme-1.0.0.tgz');

    await packVendor(work, file, { id: 'acme', version: '1.0.0' });

    const first = await manager.install('acme');

    await packVendor(work, file, { id: 'acme', version: '1.0.0' }, 'second');

    expect((await manager.available()).items[0]?.hasNewBuild).toBe(true);

    const again = await manager.install('acme');

    expect(again.action).toBe('reinstalled');
    expect(again.install.build).not.toBe(first.install.build);
    expect(await buildsOf(integrationsDir, 'acme')).toEqual([again.install.build]);
    expect((await manager.available()).items[0]?.hasNewBuild).toBe(false);
  });

  it('removes what it installed, and nothing it did not', async () => {
    const { manager, work, integrationsDir, localDir, loads } = await setUp();

    await packVendor(work, path.join(localDir, 'acme-1.0.0.tgz'), { id: 'acme', version: '1.0.0' });
    await manager.install('acme');

    expect(await manager.remove('acme')).toEqual({ isRestartNeeded: false });
    expect(loads.at(-1)).toEqual({ vendorId: 'acme' });
    await expect(stat(path.join(integrationsDir, 'acme'))).rejects.toThrow();
    await expect(manager.remove('acme')).rejects.toThrow('acme was not installed by the platform');
  });

  it('installs a release of the index, checked against its digest, and reports it', async () => {
    const served: { archive?: { bytes: Buffer; size: number; sha256: string } } = {};
    const artifactUrl =
      'https://github.com/nebulahome/integration-acme/releases/download/v2.0.0/acme-2.0.0.tgz';

    /**
     * The Hub and GitHub.
     *
     * @param input - What is asked.
     * @returns Their answer.
     */
    const hubFetch: typeof fetch = async (input) => {
      const url = String(input instanceof Request ? input.url : input);

      if (url === 'https://hub.example/v1/index/integrations.json') {
        return Promise.resolve(
          Response.json({
            formatVersion: 1,
            generatedAt: '2026-10-06T08:00:00Z',
            integrations: [
              {
                id: 'acme',
                name: 'Acme',
                repository: 'nebulahome/integration-acme',
                internetRequired: false,
                models: ['AP-100'],
                versions: [
                  {
                    version: '2.0.0',
                    sdk: '^1.0.0',
                    requires: { packages: {}, services: [] },
                    bundleKind: 'declarative',
                    artifact: {
                      url: artifactUrl,
                      size: served.archive?.size,
                      sha256: served.archive?.sha256,
                    },
                    publishedAt: '2026-10-01T08:00:00Z',
                  },
                  {
                    version: '3.0.0',
                    sdk: '^2.0.0',
                    requires: { packages: {}, services: [] },
                    bundleKind: 'code',
                    artifact: { url: artifactUrl, size: 1, sha256: 'f'.repeat(64) },
                    publishedAt: '2026-10-05T08:00:00Z',
                  },
                ],
              },
              { id: 'Not A Vendor', versions: [] },
            ],
          }),
        );
      }

      if (url.startsWith('https://hub.example/v1/integrations?')) {
        return Promise.resolve(
          Response.json({
            items: [
              {
                kind: 'integration',
                slug: 'acme',
                name: 'Acme',
                description: 'Plugs and bulbs.',
                category: null,
                official: true,
                color: '#112233',
                logoUrl: null,
                latestVersion: '3.0.0',
                publishedAt: '2026-10-05T08:00:00Z',
                downloads: 41,
                stars: 3,
              },
            ],
            nextCursor: null,
          }),
        );
      }

      return Promise.resolve(
        url === artifactUrl && served.archive !== undefined
          ? new Response(new Uint8Array(served.archive.bytes))
          : new Response('not found', { status: 404 }),
      );
    };
    const { manager, work, reported } = await setUp({ hubFetch });

    served.archive = await packVendor(work, path.join(work, 'acme-2.0.0.tgz'), {
      id: 'acme',
      version: '2.0.0',
    });

    const found = await manager.search({ q: 'plug' });

    expect(found.hubError).toBeNull();
    expect(found.items).toMatchObject([
      {
        id: 'acme',
        origin: 'hub',
        isOfficial: true,
        downloads: 41,
        stars: 3,
        internetRequired: false,
        newestVersion: '3.0.0',
        // 3.0.0 is built for an SDK this platform's hub does not implement.
        latest: { version: '2.0.0', source: 'index' },
      },
    ]);

    const installed = await manager.install('acme');

    expect(installed.install).toMatchObject({ version: '2.0.0', source: 'index' });
    expect(reported).toEqual([
      { kind: 'integration', slug: 'acme', version: '2.0.0', action: 'install' },
    ]);
    await expect(manager.install('acme', '3.0.0')).rejects.toThrow(
      'Its newest release, 3.0.0, is built for the integration SDK ^2.0.0; this NebulaHome has 1.6.0',
    );
  });
});
