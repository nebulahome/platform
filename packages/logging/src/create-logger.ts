/**
 * The shared pino logger factory.
 *
 * Every service builds its logger here rather than configuring pino itself, so that the
 * mandatory fields, the level semantics and above all the redaction list are identical
 * everywhere. `console.*` is a lint error across the platform precisely because this is the
 * only sanctioned way to emit a line (RULES.md 10).
 */
import { Writable } from 'node:stream';

import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

import type { LogLevel } from '@nebulahome/contracts';

import { formatLogContext, formatLogLine, type RenderableLogRecord } from './format.js';
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
  /** Service name, such as `core`, `api` or `packet-manager`. Appears on every record. */
  readonly service: string;

  /**
   * Package id, when the records come from an installed package.
   *
   * This is what the name bracket of a rendered line shows, in preference to `service`: an owner
   * installed `nvr`, they never installed `packet-manager`, so naming the supervising service
   * would name the wrong thing exactly when someone is working out which package misbehaved.
   */
  readonly packageId?: string;

  /** Version of the running build. Appears on every record so logs can be tied to a release. */
  readonly version: string;

  /** Lowest severity to emit. Comes from the validated `LOG_LEVEL` variable. */
  readonly level: LogLevel;

  /**
   * Render `[time][name][LEVEL] message` lines instead of newline-delimited JSON.
   *
   * Development only. Production emits JSON, which is what `logger` parses into the typed
   * columns of `history.logs`; a bracketed line would have to be parsed back out with a regular
   * expression to recover the level or the trace identifier.
   */
  readonly pretty?: boolean;
};

/**
 * Builds a destination that renders records instead of writing raw JSON.
 *
 * It formats what pino already serialised rather than hooking in earlier, so the line a
 * developer reads is produced from exactly the record that would have gone over the wire -
 * redaction included. A formatter placed before serialisation could show a value that the
 * production path would have censored.
 *
 * @param output - Where the rendered lines go, normally `process.stdout`.
 * @returns A stream pino can write to.
 */
function createRenderingStream(output: NodeJS.WritableStream): DestinationStream {
  return new Writable({
    /**
     * Renders one batch of newline-delimited JSON.
     *
     * @param chunk - One or more serialised records.
     * @param encoding - Ignored; pino always writes UTF-8.
     * @param callback - Signals completion to the stream machinery.
     */
    write(chunk: Buffer, encoding, callback): void {
      for (const line of chunk.toString().split('\n')) {
        if (line.length === 0) {
          continue;
        }

        try {
          const record = JSON.parse(line) as RenderableLogRecord & Record<string, unknown>;
          const context = formatLogContext(record);

          output.write(`${formatLogLine(record)}${context === '' ? '' : ` ${context}`}\n`);
        } catch {
          // Not JSON, so something wrote to this stream that did not come from pino. Passing it
          // through unchanged is better than swallowing it: whatever it is, it is still output
          // somebody expects to see.
          output.write(`${line}\n`);
        }
      }

      callback();
    },
  });
}

/**
 * Builds the root logger for a service.
 *
 * The returned logger already carries `service`, `version` and, for a package, `packageId`.
 * `traceId` is not set here because it belongs to one unit of work rather than to the process -
 * attach it per request with {@link withTraceId}.
 *
 * @param options - Service identity, severity threshold and output format.
 * @param destination - Where records are written. Defaults to stdout; tests pass a stream.
 * @returns A logger with the platform's mandatory fields and redaction already applied.
 */
export function createLogger(
  options: CreateLoggerOptions,
  destination?: DestinationStream,
): PlatformLogger {
  const base: Record<string, string> = { service: options.service, version: options.version };

  if (options.packageId !== undefined) {
    base['packageId'] = options.packageId;
  }

  const loggerOptions: LoggerOptions = {
    level: options.level,
    base,
    formatters: { level: formatLevelAsName },
    timestamp: pino.stdTimeFunctions.isoTime,

    redact: { paths: [...REDACTED_PATHS], censor: REDACTION_PLACEHOLDER },
  };

  if (destination !== undefined) {
    return pino(loggerOptions, destination);
  }

  if (options.pretty === true) {
    return pino(loggerOptions, createRenderingStream(process.stdout));
  }

  return pino(loggerOptions);
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
