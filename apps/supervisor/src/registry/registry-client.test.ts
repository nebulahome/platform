import { describe, expect, it } from 'vitest';

import { parseImageReference } from '../domain/image-ref.js';

import { registryArchitecture, RegistryClient } from './registry-client.js';

/**
 * A registry that wants a token, then answers from a table.
 *
 * @param routes - The answer for each path.
 * @returns A fetch, and the URLs it was asked for.
 */
function fakeRegistry(
  routes: Record<string, { body: unknown; headers?: Record<string, string> }>,
): {
  fetch: typeof fetch;
  asked: string[];
} {
  const asked: string[] = [];

  /**
   * Answers one request.
   *
   * @param input - The URL.
   * @param init - The request's options.
   * @returns The answer.
   */
  const fetchFake = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);

    asked.push(url.href);

    if (url.hostname === 'auth.docker.io') {
      return Promise.resolve(Response.json({ token: 'anonymous' }));
    }

    const headers = new Headers(init?.headers);

    if (headers.get('authorization') !== 'Bearer anonymous') {
      return Promise.resolve(
        new Response(null, {
          status: 401,
          headers: {
            'www-authenticate':
              'Bearer realm="https://auth.docker.io/token",service="registry.docker.io"',
          },
        }),
      );
    }

    const route = routes[url.pathname];

    return Promise.resolve(
      route === undefined
        ? new Response(null, { status: 404 })
        : Response.json(route.body, { headers: route.headers ?? {} }),
    );
  };

  return { fetch: fetchFake, asked };
}

describe('RegistryClient', () => {
  it('reads the tags of an image on Docker Hub with an anonymous token', async () => {
    const registry = fakeRegistry({
      '/v2/koenkk/zigbee2mqtt/tags/list': { body: { tags: ['2.14.0', '2.14.1', 'latest'] } },
    });
    const client = new RegistryClient({
      timeoutMs: 1000,
      architecture: 'amd64',
      fetch: registry.fetch,
    });

    await expect(client.tags(parseImageReference('koenkk/zigbee2mqtt'))).resolves.toEqual([
      '2.14.0',
      '2.14.1',
      'latest',
    ]);
    expect(registry.asked[1]).toContain('scope=repository%3Akoenkk%2Fzigbee2mqtt%3Apull');
  });

  it("follows a tag to this machine's image and reads the version it says it is", async () => {
    const registry = fakeRegistry({
      '/v2/library/nginx/manifests/latest': {
        body: {
          manifests: [
            { digest: 'sha256:arm', platform: { os: 'linux', architecture: 'arm64' } },
            { digest: 'sha256:x86', platform: { os: 'linux', architecture: 'amd64' } },
          ],
        },
        headers: { 'docker-content-digest': 'sha256:list' },
      },
      '/v2/library/nginx/manifests/sha256:x86': { body: { config: { digest: 'sha256:cfg' } } },
      '/v2/library/nginx/blobs/sha256:cfg': {
        body: { config: { Labels: { 'org.opencontainers.image.version': '1.27.4' } } },
      },
    });
    const client = new RegistryClient({
      timeoutMs: 1000,
      architecture: 'amd64',
      fetch: registry.fetch,
    });

    await expect(client.remote(parseImageReference('nginx'))).resolves.toEqual({
      digest: 'sha256:list',
      version: '1.27.4',
    });
  });
});

describe('registryArchitecture', () => {
  it("names Node's architectures the way a registry does", () => {
    expect(registryArchitecture('x64')).toBe('amd64');
    expect(registryArchitecture('arm64')).toBe('arm64');
  });
});
