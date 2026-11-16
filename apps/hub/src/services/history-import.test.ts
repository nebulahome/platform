import { describe, expect, it } from 'vitest';

import {
  busSubjects,
  CORE_HISTORY_IMPORT_METHOD,
  CORE_SERVICE,
  type EntityId,
} from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';
import type { Integration, MappingContext, TransportRequest } from '@nebulahome/package-runtime';

import { importHistory, type HistoryImportJob } from './history-import.js';

const logger = createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' });
const now = new Date('2026-11-16T12:00:00.000Z');
const price = 'sensor.pun_this_hour' as EntityId;
const context: MappingContext = {
  options: {},
  claim: { deviceKey: 'gme-nat', externalId: 'gme-nat', descriptor: {} },
  entities: new Map([['pun_hourly', price]]),
  lastState: () => undefined,
};

/**
 * A driver that tells `count` past readings of one entity, a minute apart, and asks for them
 * over `days`.
 *
 * @param count - How many readings the answer holds.
 * @param days - How far back the driver says it can tell.
 * @returns The driver's `history`, on an integration that is otherwise never called.
 */
function driver(count: number, days = 7): Integration {
  return {
    history: {
      days,
      request: (range: { from: string; to: string }): TransportRequest => ({
        deviceKey: 'gme-nat',
        op: 'history',
        args: range,
      }),
      toReadings: () => [
        {
          entityId: price,
          readings: Array.from({ length: count }, (unused, index) => ({
            at: new Date(now.getTime() - (index + 1) * 60_000).toISOString(),
            value: index,
          })),
        },
      ],
    },
  } as unknown as Integration;
}

/**
 * An import with a transport that answers anything and a `core` that writes everything.
 *
 * @param integration - The driver.
 * @param signal - Ends it.
 * @param onAsk - Called each time `core` is asked, before it answers.
 * @returns The job, and what the transport and `core` were asked.
 */
function job(
  integration: Integration,
  signal = new AbortController().signal,
  onAsk: () => void = () => undefined,
) {
  const sent: TransportRequest[] = [];
  const asked: { subject: string; payload: { readings: unknown[] } }[] = [];
  const client = {
    request: async (subject: string, payload: { readings: unknown[] }) => {
      asked.push({ subject, payload });
      onAsk();

      return Promise.resolve({ written: payload.readings.length, skipped: 0 });
    },
  };
  const value: HistoryImportJob = {
    instanceId: 'pun-zone',
    integration,
    context,
    connection: {
      send: async (sentRequest) => {
        sent.push(sentRequest);

        return Promise.resolve([]);
      },
    },
    client: client as unknown as HistoryImportJob['client'],
    logger,
    signal,
    now: () => now,
  };

  return { value, sent, asked };
}

describe("a device's past", () => {
  it('is asked for once over the days the driver says, and handed to core in batches', async () => {
    const { value, sent, asked } = job(driver(12_000));

    await expect(importHistory(value)).resolves.toEqual({ written: 12_000, skipped: 0 });
    expect(sent).toEqual([
      {
        deviceKey: 'gme-nat',
        op: 'history',
        args: { from: '2026-11-09T12:00:00.000Z', to: '2026-11-16T12:00:00.000Z' },
      },
    ]);
    expect(asked.map((each) => each.payload.readings.length)).toEqual([5000, 5000, 2000]);
    expect(asked[0]?.subject).toBe(busSubjects.service(CORE_SERVICE, CORE_HISTORY_IMPORT_METHOD));
    expect(asked[0]?.payload).toMatchObject({ integrationId: 'pun-zone', entityId: price });
  });

  it('never reaches further back than the hub keeps raw readings', async () => {
    const { value, sent } = job(driver(1, 365));

    await importHistory(value);
    expect(sent[0]?.args['from']).toBe('2026-10-19T12:00:00.000Z');
  });

  it('is not asked for of a driver that cannot tell it', async () => {
    const none: Partial<Integration> = {};
    const { value, sent } = job(none as Integration);

    await expect(importHistory(value)).resolves.toBeUndefined();
    expect(sent).toEqual([]);
  });

  it('stops between batches once the instance stops', async () => {
    const abort = new AbortController();
    const { value, asked } = job(driver(12_000), abort.signal, () => {
      abort.abort();
    });

    await expect(importHistory(value)).resolves.toEqual({ written: 5000, skipped: 0 });
    expect(asked).toHaveLength(1);
  });
});
