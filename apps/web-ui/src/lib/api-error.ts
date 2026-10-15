/**
 * What a failed request becomes on this side of the wire.
 *
 * The API answers every failure with one envelope (RULES.md 8.3), so the client has exactly one
 * shape to parse and exactly one error class to catch. A network failure - the request never
 * reached anyone - is the same class with a code of its own, because from a component's side
 * "the server said no" and "there was no server" are both just "this did not work", and both
 * have to be renderable.
 */
import { apiErrorSchema, type ErrorCode } from '@nebulahome/contracts';

import { translate } from '@/i18n/messages';

/** The code used when the request never reached the server at all. */
export const NETWORK_ERROR_CODE = 'NETWORK';

/** Every code a caught {@link ApiError} can carry. */
export type ApiErrorCode = ErrorCode | typeof NETWORK_ERROR_CODE;

/** What an {@link ApiError} is built from. */
export type ApiErrorOptions = {
  /** The code to branch on. */
  readonly code: ApiErrorCode;

  /** The HTTP status, or 0 when the request never got one. */
  readonly status: number;

  /** English, for a developer reading a log. */
  readonly message: string;

  /** Structured context the API attached. */
  readonly details?: Readonly<Record<string, unknown>>;

  /** The trace id, when the response carried one. */
  readonly traceId?: string;

  /** The lower-level failure this one wraps. */
  readonly cause?: unknown;
};

/** A failed request. */
export class ApiError extends Error {
  /** The code to branch on. */
  public readonly code: ApiErrorCode;

  /** The HTTP status, or 0 when the request never got one. */
  public readonly status: number;

  /** Structured context the API attached. */
  public readonly details: Readonly<Record<string, unknown>>;

  /** The trace id, so a person reporting a problem can quote something findable in the logs. */
  public readonly traceId: string;

  /**
   * Creates the error.
   *
   * @param options - See {@link ApiErrorOptions}.
   */
  public constructor(options: ApiErrorOptions) {
    super(options.message, options.cause === undefined ? {} : { cause: options.cause });

    this.name = 'ApiError';
    this.code = options.code;
    this.status = options.status;
    this.details = options.details ?? {};
    this.traceId = options.traceId ?? '';
  }
}

/**
 * Narrows a caught value.
 *
 * @param value - Whatever was caught.
 * @returns True when it came from the API client.
 */
export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/**
 * The statuses a proxy answers with when the service behind it is not there.
 *
 * In development that proxy is Vite, which answers `502` with an empty body the moment `api`
 * refuses the connection; in production it is the `proxy` service, and the same three codes
 * mean the same thing. None of them is the API saying anything - the API was not reached.
 */
const UPSTREAM_GONE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

/**
 * Says whether a failure means the API could not be reached at all.
 *
 * Two shapes, one meaning. `NETWORK` is `fetch` throwing: nothing answered. A `502`, `503` or
 * `504` is something answering *on the API's behalf* to say it is gone - which is what every
 * request gets for the first seconds after `pnpm dev`, when Vite is up and `api` is still
 * starting, and for the length of any restart after that.
 *
 * The distinction matters because the two kinds of failure deserve opposite reactions. An
 * answer from the API - a 401, a 404, a 400 - is final and is acted on. Not reaching the API is
 * a fact about the moment rather than about the request, and the right reaction is usually to
 * try again in a little while, without having concluded anything in between.
 *
 * @param error - Whatever was thrown.
 * @returns True when the API itself never answered.
 */
export function isApiUnreachable(error: unknown): boolean {
  return (
    isApiError(error) &&
    (error.code === NETWORK_ERROR_CODE || UPSTREAM_GONE_STATUSES.has(error.status))
  );
}

/**
 * Reads a failed response body into an error.
 *
 * A response that is not the envelope - a proxy's own 502 page, a truncated body - still has to
 * produce something renderable, so the status carries the meaning when the body cannot.
 *
 * @param response - The failed response.
 * @param body - Its parsed body, if it had one.
 * @returns The error to throw.
 */
export function toApiError(response: Response, body: unknown): ApiError {
  const parsed = apiErrorSchema.safeParse(body);

  if (parsed.success) {
    return new ApiError({
      code: parsed.data.error.code,
      status: response.status,
      message: parsed.data.error.message,
      details: parsed.data.error.details,
      traceId: parsed.data.error.traceId,
    });
  }

  return new ApiError({
    code: 'INTERNAL',
    status: response.status,
    message: translate(
      'errors.unreadable',
      'The server answered {{status}} with an unreadable body',
      { status: response.status },
    ),
  });
}
