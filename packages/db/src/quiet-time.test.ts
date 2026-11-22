/**
 * The quietest time as the services that start long jobs read it: what `core` reported, or
 * nothing while it has reported nothing.
 */
import { describe, expect, it } from 'vitest';

import { QUIET_TIME_ENTITY_ID, quietTimeAttributes, type QuietTime } from '@nebulahome/contracts';

import type { Database } from './client.js';
import { readQuietTime } from './quiet-time.js';

/** What `core` learned, as it reports it. */
const LEARNED: QuietTime = {
  state: 'ready',
  time: '03:30',
  quietFrom: '03:00',
  quietTo: '04:00',
  daysOfData: 7,
  daysNeeded: 3,
  profile: [],
  reason: null,
  timezone: 'Europe/Rome',
};

/**
 * A database that answers every query with the same rows, and keeps what it was asked.
 *
 * @param rows - The rows.
 * @param asked - Where each query's parameters go.
 * @returns A handle that satisfies the type and reaches nothing.
 */
function databaseWith(rows: readonly unknown[], asked: unknown[][]): Database {
  return {
    /**
     * Answers a query.
     *
     * @param query - The query, whose parameters are kept.
     * @param query.queryChunks - Its text and parameters, in order.
     * @returns The rows.
     */
    execute: async (query: { queryChunks?: unknown[] }): Promise<readonly unknown[]> => {
      asked.push(query.queryChunks ?? []);

      return Promise.resolve(rows);
    },
  } as unknown as Database;
}

describe('readQuietTime', () => {
  it('reads what core reported for the entity', async () => {
    const asked: unknown[][] = [];
    const db = databaseWith(
      [{ state: { sensor_text: { value: '03:30' } }, attributes: quietTimeAttributes(LEARNED) }],
      asked,
    );

    expect(await readQuietTime(db)).toEqual(LEARNED);
    expect(asked[0]).toContain(QUIET_TIME_ENTITY_ID);
  });

  it('is null while the entity has no state', async () => {
    expect(await readQuietTime(databaseWith([], []))).toBeNull();
  });
});
