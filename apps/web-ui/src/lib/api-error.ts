/**
 * What a failed request becomes on this side of the wire.
 *
 * The API answers every failure with one envelope (RULES.md 8.3), so the client has exactly one
 * shape to parse and exactly one error class to catch. A network failure - the request never
 * reached anyone - is the same class with a code of its own, because from a component's side
 * "the server said no" and "there was no server" are both just "this did not work", and both
 * have to be renderable.
 */
import { apiErrorSchema, type ErrorCode } from '@nebula-home/contracts';

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
    message: `The server answered ${String(response.status)} with an unreadable body`,
  });
}
