import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger, withTraceId, type PlatformLogger } from './create-logger.js';
import { REDACTION_PLACEHOLDER } from './redaction.js';

/**
 * Collects the newline-delimited JSON a logger writes.
 *
 * @returns The destination stream and a reader that parses whatever has been written so far.
 */
function createCapture(): { stream: Writable; records: () => Record<string, unknown>[] } {
  const lines: string[] = [];

  const stream = new Writable({
    write(chunk: Buffer, encoding, callback): void {
      lines.push(chunk.toString());
      callback();
    },
  });

  return {
    stream,
    records: (): Record<string, unknown>[] =>
      lines
        .join('')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

/**
 * Builds a logger writing into a capture stream at the most permissive level.
 *
 * @returns The logger under test and a reader for the records it emitted.
 */
function createTestLogger(): { logger: PlatformLogger; records: () => Record<string, unknown>[] } {
  const capture = createCapture();
  const logger = createLogger(
    { service: 'core', version: '1.2.3', level: 'trace' },
    capture.stream,
  );

  return { logger, records: capture.records };
}

describe('createLogger', () => {
  it('stamps the mandatory service and version fields on every record', () => {
    const { logger, records } = createTestLogger();

    logger.info({ entityId: 'light.kitchen_ceiling' }, 'Entity registered');

    expect(records()[0]).toMatchObject({
      service: 'core',
      version: '1.2.3',
      level: 'info',
      msg: 'Entity registered',
      entityId: 'light.kitchen_ceiling',
    });
  });

  it('writes the level as its name rather than a number', () => {
    const { logger, records } = createTestLogger();

    logger.warn('Adapter went offline');

    expect(records()[0]?.['level']).toBe('warn');
  });

  it('honours the configured severity threshold', () => {
    const capture = createCapture();
    const logger = createLogger(
      { service: 'core', version: '1.2.3', level: 'warn' },
      capture.stream,
    );

    logger.info('Should not be emitted');
    logger.warn('Should be emitted');

    expect(capture.records()).toHaveLength(1);
    expect(capture.records()[0]?.['msg']).toBe('Should be emitted');
  });
});

describe('redaction', () => {
  it('redacts secret fields at the root of a record', () => {
    const { logger, records } = createTestLogger();

    logger.info({ password: 'hunter2', accessToken: 'eyJhbGciOi', apiKey: 'sk-live' }, 'Sign-in');

    const record = records()[0];

    expect(record?.['password']).toBe(REDACTION_PLACEHOLDER);
    expect(record?.['accessToken']).toBe(REDACTION_PLACEHOLDER);
    expect(record?.['apiKey']).toBe(REDACTION_PLACEHOLDER);
  });

  it('redacts secret fields nested one level inside a context object', () => {
    const { logger, records } = createTestLogger();

    logger.info({ session: { sessionId: 'abc', refreshToken: 'rt_live' } }, 'Session created');

    const session = records()[0]?.['session'] as Record<string, unknown>;

    expect(session['sessionId']).toBe(REDACTION_PLACEHOLDER);
    expect(session['refreshToken']).toBe(REDACTION_PLACEHOLDER);
  });

  it('redacts the request headers that carry credentials', () => {
    const { logger, records } = createTestLogger();

    logger.info(
      { req: { headers: { authorization: 'Bearer eyJ', cookie: 'sid=1', accept: 'json' } } },
      'Request received',
    );

    const headers = (records()[0]?.['req'] as { headers: Record<string, unknown> }).headers;

    expect(headers['authorization']).toBe(REDACTION_PLACEHOLDER);
    expect(headers['cookie']).toBe(REDACTION_PLACEHOLDER);
    expect(headers['accept']).toBe('json');
  });

  it('leaves non-secret fields untouched', () => {
    const { logger, records } = createTestLogger();

    logger.info({ userId: 'u-1', entityId: 'light.kitchen_ceiling' }, 'Command accepted');

    expect(records()[0]?.['userId']).toBe('u-1');
  });
});

describe('withTraceId', () => {
  it('binds the trace identifier to every record the child emits', () => {
    const { logger, records } = createTestLogger();

    const scoped = withTraceId(logger, '01JD8Z4K2P9QF3M7X1V6R8T2NB');
    scoped.debug('Handling command');
    scoped.debug('Command acknowledged');

    expect(records()).toHaveLength(2);
    expect(records()[0]?.['traceId']).toBe('01JD8Z4K2P9QF3M7X1V6R8T2NB');
    expect(records()[1]?.['traceId']).toBe('01JD8Z4K2P9QF3M7X1V6R8T2NB');
  });
});
