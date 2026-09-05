/**
 * The shapes every HTTP endpoint shares: the error envelope, paging, and version discovery.
 *
 * RULES.md 8.3 fixes one error body for the whole API, and RULES.md 14 fixes keyset paging for
 * every collection. Both live here rather than in `api` because the browser client is the other
 * side of the boundary and has to read the same definition.
 */
import { z } from 'zod';

import { ERROR_CODES } from './errors.js';

/** Default number of items in a page when the caller does not say. */
export const DEFAULT_PAGE_LIMIT = 50;

/** The largest page a caller may ask for. */
export const MAX_PAGE_LIMIT = 500;

/** The header carrying the trace id on every response. */
export const TRACE_ID_HEADER = 'x-trace-id';

/** The header a caller sends to make a device command safe to retry. */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/** How long an idempotency key is remembered, in seconds. Twenty-four hours (RULES.md 14). */
export const IDEMPOTENCY_TTL_SECONDS = 86_400;

/**
 * The body of every non-2xx response.
 *
 * Exactly this shape, always - a client that has to guess whether a failure is this envelope or
 * a framework's own default ends up parsing both, and then neither reliably.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    /** The stable code to branch on. */
    code: z.enum(Object.values(ERROR_CODES)),

    /** English, for a developer reading a log. The interface translates from the code. */
    message: z.string(),

    /** Structured context. Never carries secrets or personal data (RULES.md 10.1). */
    details: z.record(z.string(), z.unknown()).default({}),

    /** The same value as the `X-Trace-Id` response header, so a screenshot is enough to find it. */
    traceId: z.string(),
  }),
});

/** The body of every non-2xx response. */
export type ApiError = z.output<typeof apiErrorSchema>;

/**
 * What every paginated collection accepts.
 *
 * Keyset, not offset: history and logs grow while a client is reading them, and an offset into
 * a growing table silently skips or repeats rows (RULES.md 14).
 */
export const pageQuerySchema = z.object({
  /** How many items to return. */
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),

  /** An opaque cursor from a previous response's `nextCursor`. */
  cursor: z.string().min(1).max(512).optional(),
});

/** What every paginated collection accepts. */
export type PageQuery = z.output<typeof pageQuerySchema>;

/**
 * Wraps an item schema in the page envelope.
 *
 * A function rather than a generic type so that the OpenAPI generator sees a real schema for
 * each collection instead of one `items: unknown` shared by all of them.
 *
 * @param itemSchema - What one item looks like.
 * @returns The schema of a page of those items.
 */
export function pageSchema<TItem extends z.ZodType>(
  itemSchema: TItem,
): z.ZodObject<{ items: z.ZodArray<TItem>; nextCursor: z.ZodOptional<z.ZodString> }> {
  return z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().optional(),
  });
}

/** One page of results. */
export type Page<TItem> = {
  /** The items, in the order the endpoint documents. */
  readonly items: readonly TItem[];

  /** Pass this back as `cursor` for the next page. Absent on the last page. */
  readonly nextCursor?: string;
};

/** Whether a version is the one to build against or one being retired. */
export const API_VERSION_STATUSES = ['current', 'deprecated'] as const;

/** Whether a version is the one to build against or one being retired. */
export type ApiVersionStatus = (typeof API_VERSION_STATUSES)[number];

/** One served version of the HTTP API. */
export const apiVersionSchema = z.object({
  /** The path segment, e.g. `v1`. */
  version: z.string().regex(/^v[0-9]+$/),

  /** Where requests for it go. */
  basePath: z.string().startsWith('/api/'),

  /** Whether it is current or on its way out. */
  status: z.enum(API_VERSION_STATUSES),

  /**
   * When a deprecated version stops being served.
   *
   * Null while a version is current. Once set it is at least six months out
   * (ARCHITECTURE.md 11.1) and is echoed in the `Sunset` header of every response that version
   * serves, so a client learns it is on borrowed time without having to poll this endpoint.
   */
  sunsetAt: z.iso.datetime({ offset: true }).nullable(),
});

/** One served version of the HTTP API. */
export type ApiVersion = z.output<typeof apiVersionSchema>;

/** What `GET /api/versions` answers. */
export const apiVersionsResponseSchema = z.object({
  /** Every version currently served, oldest first. */
  versions: z.array(apiVersionSchema),

  /** The one a new client should build against. */
  current: z.string(),
});

/** What `GET /api/versions` answers. */
export type ApiVersionsResponse = z.output<typeof apiVersionsResponseSchema>;

/**
 * Every version this build serves.
 *
 * The single source of truth for version discovery, for the route prefixes the server mounts,
 * and for the `Deprecation`/`Sunset` headers. Adding `v2` here is what makes it appear in all
 * three, which is the point: a version that exists in one of those places and not the others is
 * how a deprecation window quietly fails to be honoured.
 */
export const API_VERSIONS: readonly ApiVersion[] = [
  { version: 'v1', basePath: '/api/v1', status: 'current', sunsetAt: null },
];

/** The version a new client should build against. */
export const CURRENT_API_VERSION = 'v1';

/** What `GET /healthz` and `GET /readyz` answer. */
export const healthResponseSchema = z.object({
  /** `ok` when the service can serve, `degraded` when a dependency is missing. */
  status: z.enum(['ok', 'degraded']),

  /** The service name, so a shared load balancer's logs say which process answered. */
  service: z.string(),

  /** The build version. */
  version: z.string(),

  /** How long this process has been up, in seconds. */
  uptimeSeconds: z.number().min(0),

  /** One entry per dependency this service needs, `true` when it is reachable. */
  dependencies: z.record(z.string(), z.boolean()),
});

/** What `GET /healthz` and `GET /readyz` answer. */
export type HealthResponse = z.output<typeof healthResponseSchema>;
