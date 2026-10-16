/**
 * The Community Hub's public API, as far as the packet-manager needs it: a search of its packages
 * and integrations, what it says of one of them, their logos (the Hub's API.md §8), and the
 * house's registration and install reports (§10). The indexes the Hub serves beside them are read
 * by the index clients.
 *
 * What the Hub answers is another service's word. Each item of a page is read with a schema of
 * its own, and one that does not hold is left out rather than the page; a colour that is not
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
  type HubItemKind,
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

/** An id as the Hub's paths take it: a package's or a vendor's. */
const SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/u;

/** One item of a Hub list, as far as it is read (the Hub's contracts `itemSummarySchema`). */
const hubItemSchema = z.looseObject({
  kind: z.enum(['package', 'integration']),
  slug: z.string().regex(SLUG),
  name: z.string().min(1).max(128),
  description: z.string().max(4096),
  category: z.string().max(64).nullable(),
  official: z.boolean(),
  color: z.string().max(64).nullable(),
  logoUrl: z.string().max(2048).nullable(),
  latestVersion: z.string().max(128).nullable(),
  publishedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  downloads: z.int().min(0),
  stars: z.int().min(0),
});

/** A Hub list page: the items are read one by one. */
const hubPageSchema = z.looseObject({
  items: z.array(z.unknown()).max(200),
  nextCursor: z.string().min(1).max(512).nullable().optional(),
});

/** One item, as the Hub's `GET /v1/<kind>s/:slug` says it (its `itemDetailSchema`). */
const hubItemDetailSchema = z.looseObject({
  repository: z.string().max(201).nullable().optional(),
  homepageUrl: z.string().max(1024).nullable().optional(),
  models: z.array(z.string().max(256)).max(4096).optional(),
  internetRequired: z.boolean().nullable().optional(),
  latestVersion: z.string().max(128).nullable().optional(),
  publishedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  latest: z
    .looseObject({
      version: z.string().max(128),
      publishedAt: z.iso.datetime({ offset: true }).optional(),
      bundleKind: z.enum(['declarative', 'code']).nullable().optional(),
    })
    .nullable()
    .optional(),
});

/** One release, as `GET /v1/<kind>s/:slug/versions/:version` says it: its drivers. */
const hubVersionDetailSchema = z.looseObject({
  drivers: z
    .array(z.looseObject({ transport: z.string().max(64) }))
    .max(512)
    .default([]),
});

/** `POST /v1/installation-challenges`. */
const hubChallengeSchema = z.looseObject({
  challenge: z.string().min(1).max(512),
  difficultyBits: z.int().min(0).max(64),
});

/** `POST /v1/installations`: the token is shown once. */
const hubRegistrationSchema = z.looseObject({
  id: z.uuid(),
  token: z.string().min(1).max(512),
});

/** A Hub error body: `{ error: { code, message } }`. */
const hubErrorSchema = z.looseObject({
  error: z.looseObject({ message: z.string().max(1024) }),
});

/** One package or integration the Hub lists. */
export type HubItem = {
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

  /** When its newest release was published, as the Hub says it. */
  readonly publishedAt: Date | null;

  readonly downloads: number;
  readonly stars: number;
};

/** One page of a search. */
export type HubSearchPage = {
  readonly items: readonly HubItem[];
  readonly nextCursor: string | null;
};

/** What the Hub says of one item beyond its search row. */
export type HubItemDetail = {
  /** Its repository's owner on GitHub. */
  readonly owner: string | null;
  readonly homepageUrl: string | null;
  readonly models: readonly string[];
  readonly internetRequired: boolean | null;
  readonly version: string | null;
  readonly publishedAt: Date | null;

  /** What the newest release's drivers speak, each once. */
  readonly transports: readonly string[];
  readonly bundleKind: 'declarative' | 'code' | null;
};

/** One install a house reports. */
export type HubInstallEvent = {
  readonly kind: HubItemKind;
  readonly slug: string;
  readonly version: string;
  readonly action: 'install' | 'update';
};

/** What reporting installs came to: sent, or a token the Hub no longer takes. */
export type HubReportOutcome = 'sent' | 'token-refused';

/** What the client needs. */
export type HubClientOptions = {
  /** The Hub's public API, without a trailing slash; undefined when none is set. */
  readonly url: string | undefined;
  readonly logger: PlatformLogger;
  readonly fetch?: typeof fetch;
};

/** How one call is made. */
type CallOptions = {
  readonly method?: 'GET' | 'POST';
  readonly accept: string;
  readonly body?: unknown;
  readonly token?: string;
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

/**
 * A date the Hub wrote, or null.
 *
 * @param value - An ISO date-time, or nothing.
 * @returns The date.
 */
function dateOf(value: string | null | undefined): Date | null {
  return value === null || value === undefined ? null : new Date(value);
}

/**
 * The Hub's path segment for a kind: `/v1/packages`, `/v1/integrations`.
 *
 * @param kind - The kind.
 * @returns The segment.
 */
function segmentOf(kind: HubItemKind): string {
  return kind === 'package' ? 'packages' : 'integrations';
}

/** The Hub no longer takes the house's token: revoked, or of another Hub's database. */
class TokenRefusedError extends UpstreamError {}

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
   * The Hub's address.
   *
   * @returns It, without a trailing slash; undefined when none is set.
   */
  public get url(): string | undefined {
    return this.#options.url;
  }

  /**
   * Searches the Hub's packages or integrations.
   *
   * @param kind - Which the Hub lists.
   * @param query - What to look for, from which page, how many.
   * @param query.q - Words of a name, a description or a device model; the most installed first
   *   when not said.
   * @param query.cursor - The page, from the reply before.
   * @param query.limit - How many on a page.
   * @returns The page.
   * @throws {UpstreamError} When no Hub is set, or it cannot be reached or refuses, with why.
   */
  public async search(
    kind: HubItemKind,
    query: {
      readonly q?: string | undefined;
      readonly cursor?: string | undefined;
      readonly limit: number;
    },
  ): Promise<HubSearchPage> {
    const params = new URLSearchParams({ limit: String(query.limit) });

    if (query.q !== undefined) {
      params.set('q', query.q);
    }

    if (query.cursor !== undefined) {
      params.set('cursor', query.cursor);
    }

    const response = await this.#call(`/v1/${segmentOf(kind)}?${params.toString()}`, {
      accept: 'application/json',
    });
    const page = hubPageSchema.safeParse(await response.json().catch(() => null));

    if (!page.success) {
      throw new UpstreamError('The Community Hub answered a search with something else');
    }

    const items: HubItem[] = [];

    for (const raw of page.data.items) {
      const item = hubItemSchema.safeParse(raw);

      if (!item.success || item.data.kind !== kind) {
        this.#options.logger.warn(
          { issues: item.error?.issues ?? [], kind },
          'A Hub item was left out',
        );
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
        publishedAt: dateOf(item.data.publishedAt),
        downloads: item.data.downloads,
        stars: item.data.stars,
      });
    }

    return { items, nextCursor: page.data.nextCursor ?? null };
  }

  /**
   * What the Hub says of one item beyond its search row: whose it is, what it works with, and -
   * for an integration - what its newest release's drivers speak.
   *
   * @param kind - Which the Hub lists.
   * @param slug - The item.
   * @returns What it says.
   * @throws {NotFoundError} When the Hub does not list it.
   * @throws {UpstreamError} When no Hub is set, or it cannot be reached or refuses.
   */
  public async detail(kind: HubItemKind, slug: string): Promise<HubItemDetail> {
    if (!SLUG.test(slug)) {
      throw new NotFoundError('The Community Hub has no such thing');
    }

    const response = await this.#call(`/v1/${segmentOf(kind)}/${slug}`, {
      accept: 'application/json',
    });
    const parsed = hubItemDetailSchema.safeParse(await response.json().catch(() => null));

    if (!parsed.success) {
      throw new UpstreamError('The Community Hub described an item with something else');
    }

    const item = parsed.data;
    const version = item.latest?.version ?? item.latestVersion ?? null;
    const transports =
      kind === 'integration' && version !== null ? await this.#transportsOf(slug, version) : [];

    return {
      owner: item.repository?.split('/')[0] ?? null,
      homepageUrl: item.homepageUrl ?? null,
      models: (item.models ?? []).slice(0, 256),
      internetRequired: item.internetRequired ?? null,
      version,
      publishedAt: dateOf(item.latest?.publishedAt ?? item.publishedAt),
      transports,
      bundleKind: item.latest?.bundleKind ?? null,
    };
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

    const response = await this.#call(`/v1/assets/${sha256}`, {
      accept: 'image/svg+xml, image/png',
    });
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
   * Asks the Hub for a registration challenge.
   *
   * @returns The challenge, and the zero bits its solution's digest must start with.
   * @throws {UpstreamError} When no Hub is set, or it cannot be reached or refuses.
   */
  public async challenge(): Promise<{ challenge: string; difficultyBits: number }> {
    const response = await this.#call('/v1/installation-challenges', {
      method: 'POST',
      accept: 'application/json',
      body: {},
    });
    const parsed = hubChallengeSchema.safeParse(await response.json().catch(() => null));

    if (!parsed.success) {
      throw new UpstreamError('The Community Hub answered a challenge with something else');
    }

    return { challenge: parsed.data.challenge, difficultyBits: parsed.data.difficultyBits };
  }

  /**
   * Registers the house, with a solved challenge.
   *
   * @param registration - The challenge, its solution, the platform's release.
   * @param registration.challenge - The challenge.
   * @param registration.solution - Its solution.
   * @param registration.platformVersion - This platform's release.
   * @returns The installation the Hub made, and its token, which it shows this once.
   * @throws {UpstreamError} When the Hub refuses, or cannot be reached.
   */
  public async register(registration: {
    readonly challenge: string;
    readonly solution: string;
    readonly platformVersion: string;
  }): Promise<{ id: string; token: string }> {
    const response = await this.#call('/v1/installations', {
      method: 'POST',
      accept: 'application/json',
      body: registration,
    });
    const parsed = hubRegistrationSchema.safeParse(await response.json().catch(() => null));

    if (!parsed.success) {
      throw new UpstreamError('The Community Hub answered a registration with something else');
    }

    return { id: parsed.data.id, token: parsed.data.token };
  }

  /**
   * Reports installs, with the house's token.
   *
   * @param token - The token the Hub gave at registration.
   * @param events - What was installed or updated, at most a hundred.
   * @returns Sent, or the Hub no longer takes the token.
   * @throws {UpstreamError} When the Hub cannot be reached, or refuses for another reason.
   */
  public async reportInstalls(
    token: string,
    events: readonly HubInstallEvent[],
  ): Promise<HubReportOutcome> {
    try {
      await this.#call('/v1/installations/me/installs', {
        method: 'POST',
        accept: 'application/json',
        body: { events },
        token,
      });
    } catch (error: unknown) {
      if (error instanceof TokenRefusedError) {
        return 'token-refused';
      }

      throw error;
    }

    return 'sent';
  }

  /**
   * The transports one release's drivers speak; none when the Hub cannot say.
   *
   * @param slug - The integration.
   * @param version - The release.
   * @returns Each transport once.
   */
  async #transportsOf(slug: string, version: string): Promise<string[]> {
    try {
      const response = await this.#call(
        `/v1/integrations/${slug}/versions/${encodeURIComponent(version)}`,
        { accept: 'application/json' },
      );
      const parsed = hubVersionDetailSchema.safeParse(await response.json().catch(() => null));

      return parsed.success
        ? [...new Set(parsed.data.drivers.map((driver) => driver.transport))].slice(0, 32)
        : [];
    } catch (error: unknown) {
      this.#options.logger.debug({ err: error, slug, version }, 'No drivers read for a release');

      return [];
    }
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
   * @param options - The method, what it should answer, a body, the house's token.
   * @returns The response, when it is a success.
   * @throws {NotFoundError} When the Hub answers 404.
   * @throws {UpstreamError} When no Hub is set, or it cannot be reached or refuses, with why.
   */
  async #call(path: string, options: CallOptions): Promise<Response> {
    const { url } = this.#options;

    if (url === undefined) {
      throw new UpstreamError('No Community Hub is set: COMMUNITY_HUB_URL');
    }

    const headers: Record<string, string> = { accept: options.accept };

    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    if (options.token !== undefined) {
      headers['authorization'] = `Bearer ${options.token}`;
    }

    let response: Response;

    try {
      response = await (this.#options.fetch ?? globalThis.fetch)(`${url}${path}`, {
        method: options.method ?? 'GET',
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
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

    if (options.token !== undefined && response.status === 401) {
      throw new TokenRefusedError(`The Community Hub refused the house's token${said}`);
    }

    if (response.status === 404) {
      throw new NotFoundError(`The Community Hub has no such thing${said}`);
    }

    throw new UpstreamError(`The Community Hub answered HTTP ${String(response.status)}${said}`);
  }
}
