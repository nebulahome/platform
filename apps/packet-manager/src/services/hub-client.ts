/**
 * The Community Hub's public API, as far as the packet-manager needs it: a search of its packages
 * and their logos (the Hub's API.md §8). The package index the Hub serves beside them is read by
 * the index client.
 *
 * What the Hub answers is another service's word. Each package of a page is read with a schema
 * of its own, and one that does not hold is left out rather than the page; a colour that is not
 * `#rrggbb` is dropped before it can reach a style. A logo is fetched only by a digest a search
 * handed out - the interface cannot have the packet-manager fetch anything else - from the Hub's
 * own address, and its bytes must hash to that digest.
 */
import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  NotFoundError,
  PACKAGE_HUB_LOGO_MAXIMUM_BYTES,
  UpstreamError,
  type PackageHubLogoReply,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

/** How long one call to the Hub may take: the owner is waiting on a search. */
const HUB_TIMEOUT_MS = 8000;

/** How many logo digests a client remembers handing out. */
const KNOWN_LOGOS_LIMIT = 1024;

/** How many logos it keeps the bytes of. */
const CACHED_LOGOS_LIMIT = 64;

/** A logo's address on the Hub: `…/v1/assets/<sha256>`. */
const ASSET_URL = /\/v1\/assets\/([0-9a-f]{64})$/u;

/** One package of a Hub list, as far as it is read (the Hub's contracts `itemSummarySchema`). */
const hubItemSchema = z.looseObject({
  kind: z.literal('package'),
  slug: z.string().min(1).max(64),
  name: z.string().min(1).max(128),
  description: z.string().max(4096),
  category: z.string().max(64).nullable(),
  official: z.boolean(),
  color: z.string().max(64).nullable(),
  logoUrl: z.string().max(2048).nullable(),
  latestVersion: z.string().max(128).nullable(),
  downloads: z.int().min(0),
  stars: z.int().min(0),
});

/** A Hub list page: the items are read one by one. */
const hubPageSchema = z.looseObject({
  items: z.array(z.unknown()).max(200),
  nextCursor: z.string().min(1).max(512).nullable().optional(),
});

/** A Hub error body: `{ error: { code, message } }`. */
const hubErrorSchema = z.looseObject({
  error: z.looseObject({ message: z.string().max(1024) }),
});

/** One package the Hub lists. */
export type HubPackage = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string | null;
  readonly isOfficial: boolean;

  /** `#rrggbb`, or null when the Hub has none or something else. */
  readonly color: string | null;

  /** The logo's SHA-256, or null when it has none. */
  readonly logo: string | null;

  readonly latestVersion: string | null;
  readonly downloads: number;
  readonly stars: number;
};

/** One page of a search. */
export type HubSearchPage = {
  readonly items: readonly HubPackage[];
  readonly nextCursor: string | null;
};

/** What the client needs. */
export type HubClientOptions = {
  /** The Hub's public API, without a trailing slash; undefined when none is set. */
  readonly url: string | undefined;
  readonly logger: PlatformLogger;
  readonly fetch?: typeof fetch;
};

/**
 * Cuts a text to a length, for a message that quotes another service.
 *
 * @param text - The text.
 * @param length - The most characters kept.
 * @returns It, cut.
 */
function clip(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

/** The Community Hub, as the packet-manager asks it. */
export class CommunityHubClient {
  readonly #options: HubClientOptions;

  /** Digests handed out by a search: the only logos it fetches. Oldest first. */
  readonly #knownLogos = new Set<string>();

  /** Logos fetched, by digest, oldest first. */
  readonly #logos = new Map<string, PackageHubLogoReply>();

  /**
   * Makes a client that has asked nothing yet.
   *
   * @param options - The Hub's address, the logger.
   */
  public constructor(options: HubClientOptions) {
    this.#options = options;
  }

  /**
   * Searches the Hub's packages.
   *
   * @param query - What to look for, from which page, how many.
   * @param query.q - Words of a name or description; the most installed first when not said.
   * @param query.cursor - The page, from the reply before.
   * @param query.limit - How many on a page.
   * @returns The page.
   * @throws {UpstreamError} When no Hub is set, or it cannot be reached or refuses, with why.
   */
  public async search(query: {
    readonly q?: string | undefined;
    readonly cursor?: string | undefined;
    readonly limit: number;
  }): Promise<HubSearchPage> {
    const params = new URLSearchParams({ limit: String(query.limit) });

    if (query.q !== undefined) {
      params.set('q', query.q);
    }

    if (query.cursor !== undefined) {
      params.set('cursor', query.cursor);
    }

    const response = await this.#get(`/v1/packages?${params.toString()}`, 'application/json');
    const page = hubPageSchema.safeParse(await response.json().catch(() => null));

    if (!page.success) {
      throw new UpstreamError('The Community Hub answered a search with something else');
    }

    const items: HubPackage[] = [];

    for (const raw of page.data.items) {
      const item = hubItemSchema.safeParse(raw);

      if (!item.success) {
        this.#options.logger.warn({ issues: item.error.issues }, 'A Hub package was left out');
        continue;
      }

      const logo = ASSET_URL.exec(item.data.logoUrl ?? '')?.[1] ?? null;

      if (logo !== null) {
        this.#remember(logo);
      }

      items.push({
        id: item.data.slug,
        name: item.data.name,
        description: item.data.description,
        category: item.data.category,
        isOfficial: item.data.official,
        color: /^#[0-9a-fA-F]{6}$/u.test(item.data.color ?? '') ? item.data.color : null,
        logo,
        latestVersion: item.data.latestVersion,
        downloads: item.data.downloads,
        stars: item.data.stars,
      });
    }

    return { items, nextCursor: page.data.nextCursor ?? null };
  }

  /**
   * A logo a search handed out, by its digest.
   *
   * @param sha256 - Its digest.
   * @returns Its bytes in base64, and their type.
   * @throws {NotFoundError} When no search handed it out, or the Hub has it no more.
   * @throws {UpstreamError} When the Hub cannot be reached, or the bytes are not the logo.
   */
  public async logo(sha256: string): Promise<PackageHubLogoReply> {
    const cached = this.#logos.get(sha256);

    if (cached !== undefined) {
      return cached;
    }

    if (!this.#knownLogos.has(sha256)) {
      throw new NotFoundError('No search showed this logo');
    }

    const response = await this.#get(`/v1/assets/${sha256}`, 'image/svg+xml, image/png');
    const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim();
    const bytes = Buffer.from(await response.arrayBuffer());

    if (type !== 'image/svg+xml' && type !== 'image/png') {
      throw new UpstreamError('The Community Hub answered a logo that is not an image');
    }

    if (
      bytes.length > PACKAGE_HUB_LOGO_MAXIMUM_BYTES ||
      createHash('sha256').update(bytes).digest('hex') !== sha256
    ) {
      throw new UpstreamError('The Community Hub answered a logo that is not the one asked for');
    }

    const logo = { contentType: type, data: bytes.toString('base64') } as const;

    this.#logos.set(sha256, logo);

    if (this.#logos.size > CACHED_LOGOS_LIMIT) {
      this.#logos.delete(this.#logos.keys().next().value ?? '');
    }

    return logo;
  }

  /**
   * Remembers a digest a search handed out.
   *
   * @param sha256 - The digest.
   */
  #remember(sha256: string): void {
    this.#knownLogos.delete(sha256);
    this.#knownLogos.add(sha256);

    if (this.#knownLogos.size > KNOWN_LOGOS_LIMIT) {
      this.#knownLogos.delete(this.#knownLogos.values().next().value ?? '');
    }
  }

  /**
   * Asks the Hub.
   *
   * @param path - From the Hub's address on.
   * @param accept - What it should answer.
   * @returns The response, when it is a success.
   * @throws {NotFoundError} When the Hub answers 404.
   * @throws {UpstreamError} When no Hub is set, or it cannot be reached or refuses, with why.
   */
  async #get(path: string, accept: string): Promise<Response> {
    const { url } = this.#options;

    if (url === undefined) {
      throw new UpstreamError('No Community Hub is set: COMMUNITY_HUB_URL');
    }

    let response: Response;

    try {
      response = await (this.#options.fetch ?? globalThis.fetch)(`${url}${path}`, {
        headers: { accept },
        signal: AbortSignal.timeout(HUB_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      const why = error instanceof Error ? error.message : String(error);

      throw new UpstreamError(
        `The Community Hub could not be reached at ${url}: ${clip(why, 200)}`,
        { cause: error },
      );
    }

    if (response.ok) {
      return response;
    }

    const body = hubErrorSchema.safeParse(await response.json().catch(() => null));
    const said = body.success ? `: ${clip(body.data.error.message, 300)}` : '';

    if (response.status === 404) {
      throw new NotFoundError(`The Community Hub has no such thing${said}`);
    }

    throw new UpstreamError(`The Community Hub answered HTTP ${String(response.status)}${said}`);
  }
}
