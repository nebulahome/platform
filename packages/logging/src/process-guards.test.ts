import { afterEach, describe, expect, it, vi } from 'vitest';

import { EXIT_CODES } from '@nebulahome/contracts';

import type { PlatformLogger } from './create-logger.js';
import { armShutdownTimeout, guardProcess } from './process-guards.js';

/**
 * Builds a logger that only records the calls made to it.
 *
 * @returns A stand-in for the platform logger.
 */
function createSpyLogger(): PlatformLogger {
  return { error: vi.fn(), fatal: vi.fn() } as unknown as PlatformLogger;
}

describe('process guards', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('ends the process once the shutdown overruns its time', () => {
    vi.useFakeTimers();
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const logger = createSpyLogger();

    armShutdownTimeout(logger, 500);
    vi.advanceTimersByTime(499);
    expect(exit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(logger.error).toHaveBeenCalledWith(
      { timeoutMs: 500 },
      'Shutdown did not finish in time, exiting',
    );
    expect(exit).toHaveBeenCalledWith(EXIT_CODES.UNHANDLED_ERROR);
  });

  it('survives a failed promise and ends on an uncaught throw', () => {
    const handlers = new Map<string, (error: unknown) => void>();
    vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: (error: unknown) => void,
    ) => {
      handlers.set(event, handler);

      return process;
    }) as typeof process.on);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const logger = createSpyLogger();
    const failure = new Error('boom');

    guardProcess(logger, 'core failed with an error it did not catch');

    handlers.get('unhandledRejection')?.(failure);
    expect(logger.error).toHaveBeenCalledWith(
      { err: failure },
      'A promise failed and nothing caught it',
    );
    expect(exit).not.toHaveBeenCalled();

    handlers.get('uncaughtException')?.(failure);
    expect(logger.fatal).toHaveBeenCalledWith(
      { err: failure },
      'core failed with an error it did not catch',
    );
    expect(exit).toHaveBeenCalledWith(EXIT_CODES.UNHANDLED_ERROR);
  });
});
