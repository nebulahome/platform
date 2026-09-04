/**
 * The error hierarchy every NebulaHome service throws from.
 *
 * Each error carries a stable, machine-readable {@link ErrorCode} so that the API layer can map
 * a failure onto an HTTP status and the web UI can localise it, neither of them ever parsing an
 * English message. Messages are for humans reading logs; codes are the contract.
 *
 * Defined in RULES.md 8.
 */

/**
 * Every failure code the platform can raise.
 *
 * Codes are part of the public API surface: clients branch on them, so a code is never renamed
 * or given a new meaning once released. Adding a code is backwards compatible; changing one is
 * a breaking change under the rules in ARCHITECTURE.md 11.
 */
export const ERROR_CODES = {
  /** Input failed schema validation at a trust boundary. */
  VALIDATION: 'VALIDATION',
  /** The addressed resource does not exist, or the caller may not know that it does. */
  NOT_FOUND: 'NOT_FOUND',
  /** The request collided with the current state, such as a duplicate unique value. */
  CONFLICT: 'CONFLICT',
  /** Credentials were absent, malformed or rejected. */
  AUTHENTICATION: 'AUTHENTICATION',
  /** The caller is known but lacks the permission this action requires. */
  PERMISSION: 'PERMISSION',
  /** The owning adapter did not acknowledge a command for a device. */
  DEVICE_UNAVAILABLE: 'DEVICE_UNAVAILABLE',
  /** A protocol adapter failed while talking to its transport. */
  ADAPTER: 'ADAPTER',
  /** Installing, starting or configuring a package failed. */
  PACKAGE: 'PACKAGE',
  /** Environment configuration was missing or invalid at startup. */
  CONFIGURATION: 'CONFIGURATION',
  /** The database schema is not the version this build was written against. */
  SCHEMA_VERSION_MISMATCH: 'SCHEMA_VERSION_MISMATCH',
} as const;

/** A stable failure code attached to every {@link NebulaError}. */
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Optional construction arguments shared by every platform error. */
export type NebulaErrorOptions = {
  /** The lower-level error this one wraps. Preserved so the full chain survives to the logs. */
  readonly cause?: unknown;

  /**
   * Structured context for logging and for the API error envelope.
   *
   * This value reaches both the log stream and the client, so it must never carry secrets or
   * personal data - see RULES.md 10.1.
   */
  readonly details?: Readonly<Record<string, unknown>>;
};

/**
 * Base class for every error raised inside the platform.
 *
 * Abstract on purpose: a bare `NebulaError` would have no code, and code-less errors are what
 * force callers back to matching on message text.
 */
export abstract class NebulaError extends Error {
  /** Stable, machine-readable failure code. */
  public abstract readonly code: ErrorCode;

  /** HTTP status the API layer returns when this error escapes to a request handler. */
  public abstract readonly httpStatus: number;

  /** Structured context attached for logging. Never contains secrets or personal data. */
  public readonly details: Readonly<Record<string, unknown>>;

  /**
   * Creates the error and records its construction site.
   *
   * @param message - Human-readable description, in English, for logs and developers.
   * @param options - Optional cause to chain and structured context to attach.
   */
  public constructor(message: string, options: NebulaErrorOptions = {}) {
    super(message, { cause: options.cause });

    // `new.target` is the most-derived constructor, so a subclass reports its own name here
    // without having to restate it.
    this.name = new.target.name;
    this.details = options.details ?? {};
  }
}

/**
 * Narrows an unknown caught value to a platform error.
 *
 * Catch clauses receive `unknown` under `useUnknownInCatchVariables`, and this is the only
 * sanctioned way to find out whether the platform raised the failure or something below it did.
 *
 * @param value - The caught value, of unknown shape.
 * @returns True when the value is a {@link NebulaError}.
 */
export function isNebulaError(value: unknown): value is NebulaError {
  return value instanceof NebulaError;
}

/** Input failed schema validation at a trust boundary. */
export class ValidationError extends NebulaError {
  /** @inheritDoc */
  public readonly code = ERROR_CODES.VALIDATION;

  /** @inheritDoc */
  public readonly httpStatus = 400;
}

/** The addressed resource does not exist. */
export class NotFoundError extends NebulaError {
  /** @inheritDoc */
  public readonly code = ERROR_CODES.NOT_FOUND;

  /** @inheritDoc */
  public readonly httpStatus = 404;
}

/** The request collided with the current state of the resource. */
export class ConflictError extends NebulaError {
  /** @inheritDoc */
  public readonly code = ERROR_CODES.CONFLICT;

  /** @inheritDoc */
  public readonly httpStatus = 409;
}

/** Credentials were absent, malformed or rejected. */
export class AuthenticationError extends NebulaError {
  /** @inheritDoc */
  public readonly code = ERROR_CODES.AUTHENTICATION;

  /** @inheritDoc */
  public readonly httpStatus = 401;
}

/** The caller is authenticated but lacks the required permission. */
export class PermissionError extends NebulaError {
  /** @inheritDoc */
  public readonly code = ERROR_CODES.PERMISSION;

  /** @inheritDoc */
  public readonly httpStatus = 403;
}

/** A device did not acknowledge a command within its timeout. */
export class DeviceUnavailableError extends NebulaError {
  /** @inheritDoc */
  public readonly code = ERROR_CODES.DEVICE_UNAVAILABLE;

  /** @inheritDoc */
  public readonly httpStatus = 503;
}

/** A protocol adapter failed while talking to its transport. */
export class AdapterError extends NebulaError {
  /** @inheritDoc */
  public readonly code = ERROR_CODES.ADAPTER;

  /** @inheritDoc */
  public readonly httpStatus = 502;
}

/** Installing, starting, configuring or removing a package failed. */
export class PackageError extends NebulaError {
  /** @inheritDoc */
  public readonly code = ERROR_CODES.PACKAGE;

  /** @inheritDoc */
  public readonly httpStatus = 500;
}

/**
 * Environment configuration was missing or invalid.
 *
 * Raised only during startup. A service that catches this exits with
 * `EXIT_CODES.INVALID_CONFIGURATION` rather than running half-configured.
 */
export class ConfigurationError extends NebulaError {
  /** @inheritDoc */
  public readonly code = ERROR_CODES.CONFIGURATION;

  /** @inheritDoc */
  public readonly httpStatus = 500;
}

/**
 * The database schema is not the version this build expects.
 *
 * Raised at startup by the schema version check. A service that catches this exits with
 * `EXIT_CODES.SCHEMA_VERSION_MISMATCH`; it must not attempt to migrate on its own.
 */
export class SchemaVersionMismatchError extends NebulaError {
  /** @inheritDoc */
  public readonly code = ERROR_CODES.SCHEMA_VERSION_MISMATCH;

  /** @inheritDoc */
  public readonly httpStatus = 500;
}
