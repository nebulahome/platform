/**
 * A registry, asked what it has: the tags of an image, and what one of them points at.
 *
 * The distribution API every registry speaks - Docker Hub, GitHub's, Quay - read anonymously: a
 * request is answered 401 with a `WWW-Authenticate` header naming where a token is handed out,
 * the token is asked for with no credentials, and the request is made again with it. An image
 * that needs an account is not checked, and says so.
 *
 * The one call that costs anything is reading a manifest: Docker Hub counts them against an
 * anonymous limit per address, a hundred every six hours. It is made only for an image that
 * follows a tag, once per check, and a check runs every few hours.
 */
import { z } from 'zod';

import { UpstreamError } from '@nebula-home/contracts';

import { DOCKER_HUB, type ImageReference } from '../domain/image-ref.js';
import { VERSION_LABEL } from '../domain/versions.js';

/** Where Docker Hub's registry API is, which is not the name references use. */
const DOCKER_HUB_API = 'registry-1.docker.io';

/** The manifests asked for, lists first: a list names one manifest per platform. */
const MANIFEST_TYPES = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

/** How many pages of tags are read at most: a busy image has thousands of nightly tags. */
const MAXIMUM_TAG_PAGES = 10;

/** `GET /v2/<name>/tags/list`. */
const tagListSchema = z.looseObject({ tags: z.array(z.string()).nullish() });

/** A token answer: registries disagree on the field's name. */
const tokenSchema = z.looseObject({
  token: z.string().optional(),
  access_token: z.string().optional(),
});

/** A manifest list or a manifest, the fields read. */
const manifestSchema = z.looseObject({
  manifests: z
    .array(
      z.looseObject({
        digest: z.string(),
        platform: z.looseObject({ architecture: z.string(), os: z.string() }).optional(),
      }),
    )
    .optional(),
  config: z.looseObject({ digest: z.string() }).optional(),
});

/** An image's configuration blob, the field read. */
const imageConfigSchema = z.looseObject({
  config: z.looseObject({ Labels: z.record(z.string(), z.string()).nullish() }).nullish(),
});

/** What a tag points at now. */
export type RemoteImage = {
  /** The digest a pull of the tag would get: the list's when there is one. */
  readonly digest: string;

  /** The version the image says it is, from its label; null when it has none. */
  readonly version: string | null;
};

/** What asking a registry takes. */
export type RegistryClientOptions = {
  readonly timeoutMs: number;

  /** The machine's architecture in the registry's words: `amd64`, `arm64`. */
  readonly architecture: string;

  /** Replaced by a test. */
  readonly fetch?: typeof fetch;
};

/**
 * The architecture a registry names Node's by.
 *
 * @param arch - `process.arch`.
 * @returns The registry's word for it.
 */
export function registryArchitecture(arch: string): string {
  return arch === 'x64' ? 'amd64' : arch === 'ia32' ? '386' : arch;
}

/**
 * Reads one parameter out of a `WWW-Authenticate: Bearer realm="…",service="…"` header.
 *
 * @param header - The header.
 * @param name - The parameter.
 * @returns Its value, or undefined.
 */
function challengeParameter(header: string, name: string): string | undefined {
  return new RegExp(`${name}="([^"]*)"`).exec(header)?.[1];
}

/** A registry, asked anonymously. */
export class RegistryClient {
  readonly #options: RegistryClientOptions;
  readonly #fetch: typeof fetch;
  readonly #tokens = new Map<string, { token: string; until: number }>();

  /**
   * Creates a client.
   *
   * @param options - The timeout, the architecture, and a fetch to use instead of the global one.
   */
  public constructor(options: RegistryClientOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  /**
   * Every tag of an image.
   *
   * @param image - The image.
   * @returns The tags, in the registry's order.
   */
  public async tags(image: ImageReference): Promise<string[]> {
    const tags: string[] = [];
    let path: string | null = `/v2/${image.repository}/tags/list?n=1000`;

    // One page after another: each page's address is in the answer to the one before.
    for (let page = 0; page < MAXIMUM_TAG_PAGES && path !== null; page += 1) {
      // eslint-disable-next-line no-await-in-loop -- see above
      const response = await this.#get(image, path, 'application/json');
      // eslint-disable-next-line no-await-in-loop -- see above
      const body = tagListSchema.parse(await response.json());

      tags.push(...(body.tags ?? []));

      // The next page, when there is one: `<…/tags/list?last=x&n=1000>; rel="next"`.
      const link = response.headers.get('link');

      path = link === null ? null : (/<([^>]+)>;\s*rel="next"/.exec(link)?.[1] ?? null);
    }

    return tags;
  }

  /**
   * What a tag points at now, and the version that image says it is.
   *
   * @param image - The image, with the tag.
   * @returns The digest and the version.
   */
  public async remote(image: ImageReference): Promise<RemoteImage> {
    const response = await this.#get(
      image,
      `/v2/${image.repository}/manifests/${image.tag}`,
      MANIFEST_TYPES,
    );
    const digest = response.headers.get('docker-content-digest');

    if (digest === null) {
      throw new UpstreamError(`${image.registry} did not say what ${image.tag} points at`, {
        details: { registry: image.registry, repository: image.repository },
      });
    }

    let manifest = manifestSchema.parse(await response.json());

    // A list: the manifest of this machine's platform holds the configuration.
    if (manifest.manifests !== undefined) {
      const mine =
        manifest.manifests.find(
          (entry) =>
            entry.platform?.os === 'linux' &&
            entry.platform.architecture === this.#options.architecture,
        ) ?? manifest.manifests[0];

      if (mine === undefined) {
        return { digest, version: null };
      }

      const single = await this.#get(
        image,
        `/v2/${image.repository}/manifests/${mine.digest}`,
        MANIFEST_TYPES,
      );

      manifest = manifestSchema.parse(await single.json());
    }

    if (manifest.config === undefined) {
      return { digest, version: null };
    }

    const blob = await this.#get(
      image,
      `/v2/${image.repository}/blobs/${manifest.config.digest}`,
      '*/*',
    );
    const labels = imageConfigSchema.parse(await blob.json()).config?.Labels ?? {};

    return { digest, version: labels[VERSION_LABEL] ?? null };
  }

  /**
   * One request, with the token the registry asks for.
   *
   * @param image - Which image: its registry, and its repository for the token's scope.
   * @param path - The path, or a whole URL from a `Link` header.
   * @param accept - What to accept.
   * @returns The answer, once it succeeded.
   * @throws {UpstreamError} When the registry refuses, or wants an account.
   */
  async #get(image: ImageReference, path: string, accept: string): Promise<Response> {
    const host = image.registry === DOCKER_HUB ? DOCKER_HUB_API : image.registry;
    const url = path.startsWith('http') ? path : `https://${host}${path}`;
    const cached = this.#tokens.get(`${host}/${image.repository}`);
    const headers: Record<string, string> = { accept };

    if (cached !== undefined && cached.until > Date.now()) {
      headers['authorization'] = `Bearer ${cached.token}`;
    }

    let response = await this.#fetch(url, {
      headers,
      signal: AbortSignal.timeout(this.#options.timeoutMs),
    });

    if (response.status === 401) {
      const token = await this.#token(image, host, response.headers.get('www-authenticate'));

      response = await this.#fetch(url, {
        headers: { accept, authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(this.#options.timeoutMs),
      });
    }

    if (!response.ok) {
      throw new UpstreamError(
        `${image.registry} answered ${String(response.status)} for ${image.repository}`,
        { details: { registry: image.registry, status: response.status } },
      );
    }

    return response;
  }

  /**
   * Asks for an anonymous token where the challenge says.
   *
   * @param image - The image, whose repository the token is scoped to.
   * @param host - The registry's API host, which keys the cache.
   * @param challenge - The `WWW-Authenticate` header.
   * @returns The token.
   */
  async #token(image: ImageReference, host: string, challenge: string | null): Promise<string> {
    const realm = challenge === null ? undefined : challengeParameter(challenge, 'realm');

    if (challenge === null || realm === undefined || !/^bearer /i.test(challenge)) {
      throw new UpstreamError(`${image.registry} wants an account to read ${image.repository}`, {
        details: { registry: image.registry },
      });
    }

    const url = new URL(realm);
    const service = challengeParameter(challenge, 'service');

    if (service !== undefined) {
      url.searchParams.set('service', service);
    }

    url.searchParams.set('scope', `repository:${image.repository}:pull`);

    const response = await this.#fetch(url, {
      signal: AbortSignal.timeout(this.#options.timeoutMs),
    });

    if (!response.ok) {
      throw new UpstreamError(`${image.registry} gave no token for ${image.repository}`, {
        details: { registry: image.registry, status: response.status },
      });
    }

    const answer = tokenSchema.parse(await response.json());
    const token = answer.token ?? answer.access_token;

    if (token === undefined) {
      throw new UpstreamError(`${image.registry} gave an empty token`, {
        details: { registry: image.registry },
      });
    }

    // Anonymous tokens last five minutes on Docker Hub; four is safe everywhere seen.
    this.#tokens.set(`${host}/${image.repository}`, { token, until: Date.now() + 240_000 });

    return token;
  }
}
