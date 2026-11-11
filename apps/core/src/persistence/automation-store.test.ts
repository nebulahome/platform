import { describe, expect, it, vi } from 'vitest';

import type { Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import { loadHouse } from './automation-store.js';

/**
 * A database whose selects answer the rows given, in turn.
 *
 * @param answers - What each select returns.
 * @returns The stub.
 */
function answering(answers: unknown[][]): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(answers.shift() ?? []),
        }),
      }),
    }),
  } as unknown as Database;
}

describe('loadHouse', () => {
  it('keeps time in UTC, and says so, for a zone that is not one', async () => {
    // Every clock reading the zone throws on it - a bare timer included, which ends the process.
    const warn = vi.fn();
    const house = await loadHouse(answering([[{ value: 'Mars/Olympus' }], []]), {
      warn,
    } as unknown as PlatformLogger);

    expect(house.timeZone).toBe('UTC');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('keeps a zone that is one', async () => {
    const house = await loadHouse(answering([[{ value: 'Europe/Rome' }], []]));

    expect(house.timeZone).toBe('Europe/Rome');
  });
});
