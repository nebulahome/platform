/**
 * The shared pino logger factory.
 *
 * Every service builds its logger here rather than configuring pino itself, so that the
 * mandatory fields, the level semantics and above all the redaction list are identical
 * everywhere. `console.*` is a lint error across the platform precisely because this is the
 * only sanctioned way to emit a line (RULES.md 10).
 */
import type { LogLevel } from '@nebula-home/contracts';
import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

import { REDACTED_PATHS, REDACTION_PLACEHOLDER } from './redaction.js';

/**
 * Renders the severity of a record as its name.
 *
 * Pino's default is the numeric level, which is compact but forces every consumer - including a
 * human reading `docker logs` - to carry the mapping in their head.
 *
 * @param label - The severity name pino resolved for the record.
 * @returns The `level` field as it is written to the record.
 */
function formatLevelAsName(label: string): { level: string } {
  return { level: label };
}

/** A configured platform logger. */
export type PlatformLogger = Logger;

/** How a service identifies itself and how much it emits. */
export type CreateLoggerOptions = {
  /** Service or package name, such as `core` or `pkg-mqtt`. Appears on every record. */
  readonly service: string;

  /** Version of the running build. Appears on every record so logs can be tied to a release. */
  readonly version: string;

  /** Lowest severity to emit. Comes from the validated `LOG_LEVEL` variable. */
  readonly level: LogLevel;

  /**
   * Render human-readable output instead of newline-delimited JSON.
   *
   * Development only. Production logs are consumed by `logger`, which parses JSON.
   */
  readonly pretty?: boolean;
};

/**
 * Builds the root logger for a service.
 *
 * The returned logger already carries `service` and `version`. `traceId` is not set here
 * because it belongs to one unit of work rather than to the process - attach it per request
 * with {@link withTraceId}.
 *
 * @param options - Service identity, severity threshold and output format.
 * @param destination - Where records are written. Defaults to stdout; tests pass a stream.
 * @returns A logger with the platform's mandatory fields and redaction already applied.
 */
export function createLogger(
  options: CreateLoggerOptions,
  destination?: DestinationStream,
): PlatformLogger {
  const loggerOptions: LoggerOptions = {
    level: options.level,
    base: { service: options.service, version: options.version },
    formatters: { level: formatLevelAsName },
    timestamp: pino.stdTimeFunctions.isoTime,

    redact: { paths: [...REDACTED_PATHS], censor: REDACTION_PLACEHOLDER },
  };

  // Pretty printing runs pino-pretty in a worker thread, which replaces the destination. The
  // two are therefore mutually exclusive, and a test stream always wins.
  if (options.pretty === true && destination === undefined) {
    return pino({
      ...loggerOptions,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
      },
    });
  }

  return destination === undefined ? pino(loggerOptions) : pino(loggerOptions, destination);
}

/**
 * Derives a child logger bound to one unit of work.
 *
 * The trace identifier is propagated across HTTP, the bus and every service that handles the
 * same request, so that one failure can be reassembled from several log streams.
 *
 * @param logger - The service's root logger, or another child.
 * @param traceId - Identifier of the request, command or job being handled.
 * @returns A child logger that stamps `traceId` on every record it emits.
 */
export function withTraceId(logger: PlatformLogger, traceId: string): PlatformLogger {
  return logger.child({ traceId });
}
