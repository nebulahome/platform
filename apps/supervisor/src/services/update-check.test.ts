import { describe, expect, it } from 'vitest';

import { UpstreamError } from '@nebulahome/contracts';

import type { RegistryClient } from '../registry/registry-client.js';

import { checkImage } from './update-check.js';

/**
 * A registry client that answers what it is told.
 *
 * @param remote - What `remote` answers, or throws.
 * @returns The client.
 */
function registryAnswering(
  remote: { digest: string; version: string | null } | Error,
): RegistryClient {
  return {
    remote: async () =>
      remote instanceof Error ? Promise.reject(remote) : Promise.resolve(remote),
  } as unknown as RegistryClient;
}

/**
 * Tags, as a registry would list them.
 *
 * @returns The tags.
 */
async function tags(): Promise<string[]> {
  return Promise.resolve(['1.27.3', '1.27.4', 'latest', '1.28.0-alpine']);
}

describe('checkImage', () => {
  it('offers the newest release of the same shape to an image pinned to one', async () => {
    await expect(
      checkImage(
        { reference: 'nginx:1.27.3', labels: {}, repoDigests: ['nginx@sha256:aaa'] },
        registryAnswering(new Error('not asked')),
        tags,
      ),
    ).resolves.toEqual({
      installedVersion: '1.27.3',
      latestVersion: '1.27.4',
      isAvailable: true,
      targetTag: '1.27.4',
      error: null,
      isUnpublished: false,
    });
  });

  it('offers the image a followed tag points at now, when the machine has another', async () => {
    const finding = await checkImage(
      {
        reference: 'nginx:latest',
        labels: { 'org.opencontainers.image.version': '1.27.3' },
        repoDigests: ['nginx@sha256:old'],
      },
      registryAnswering({ digest: 'sha256:new', version: '1.27.4' }),
      tags,
    );

    expect(finding).toMatchObject({
      isAvailable: true,
      latestVersion: '1.27.4',
      targetTag: 'latest',
    });
  });

  it('names the build when a followed tag points at the same release built again', async () => {
    const finding = await checkImage(
      {
        reference: 'eclipse-mosquitto:2',
        labels: { 'org.opencontainers.image.version': '2.1.2' },
        repoDigests: ['eclipse-mosquitto@sha256:old'],
      },
      registryAnswering({ digest: 'sha256:0123456789abcdef', version: '2.1.2' }),
      tags,
    );

    expect(finding).toMatchObject({ isAvailable: true, latestVersion: '2.1.2+0123456789ab' });
  });

  it('takes an image no registry has for one built here, with nothing wrong', async () => {
    const finding = await checkImage(
      { reference: 'nebulahome:local', labels: {}, repoDigests: ['nebulahome@sha256:local'] },
      registryAnswering(
        new UpstreamError('docker.io answered 401 for library/nebulahome', {
          details: { status: 401 },
        }),
      ),
      tags,
    );

    expect(finding).toMatchObject({ isUnpublished: true, error: null, isAvailable: false });
  });

  it('says it is up to date when the machine has the image the tag points at', async () => {
    const finding = await checkImage(
      { reference: 'nginx', labels: {}, repoDigests: ['nginx@sha256:same'] },
      registryAnswering({ digest: 'sha256:same', version: null }),
      tags,
    );

    expect(finding).toMatchObject({ isAvailable: false, installedVersion: 'same' });
  });

  it('asks no registry about an image built on this machine', async () => {
    const finding = await checkImage(
      { reference: 'nebulahome:local', labels: {}, repoDigests: [] },
      registryAnswering(new Error('not asked')),
      tags,
    );

    expect(finding).toMatchObject({ isAvailable: false, error: null, targetTag: null });
  });

  it('keeps an unreachable registry as the finding, not a failure', async () => {
    const finding = await checkImage(
      { reference: 'nginx:latest', labels: {}, repoDigests: ['nginx@sha256:old'] },
      registryAnswering(new UpstreamError('registry-1.docker.io answered 429 for library/nginx')),
      tags,
    );

    expect(finding.error).toBe('registry-1.docker.io answered 429 for library/nginx');
  });
});
