import { describe, expect, it } from 'vitest';

import {
  busSubjects,
  CORE_HISTORY_IMPORT_METHOD,
  CORE_SERVICE,
  type EntityId,
} from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';
import type {
  Integration,
  MappingContext,
  PastReadings,
  TransportRequest,
} from '@nebulahome/package-runtime';

import { importHistory, type HistoryImportJob } from './history-import.js';

const logger = createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' });
const now = new Date('2026-11-16T12:00:00.000Z');
const price = 'sensor.pun_this_hour' as EntityId;
const zonal = 'sensor.pun_zonal_this_hour' as EntityId;
const context: MappingContext = {
  options: {},
  claim: { deviceKey: 'gme-nat', externalId: 'gme-nat', descriptor: {} },
  entities: new Map([
    ['pun_hourly', price],
    ['zonal_hourly', zonal],
  ]),
  lastState: () => undefined,
};

/**
 * `count` readings a minute apart, the newest a minute before now.
 *
 * @param count - How many.
 * @returns The readings.
 */
function minutes(count: number): PastReadings['readings'] {
  return Array.from({ length: count }, (unused, index) => ({
    at: new Date(now.getTime() - (index + 1) * 60_000).toISOString(),
    value: index,
  }));
}

/**
 * A driver that tells the readings it is given, and asks for them over `days`.
 *
 * @param readings - What the answer reads as.
 * @param days - How far back the driver says it can tell.
 * @returns The driver's `history`, on an integration that is otherwise never called.
 */
function driver(readings: PastReadings[], days = 3): Integration {
  const integration: Partial<Integration> = {
    history: {
      days,
      request: (range): TransportRequest => ({ deviceKey: 'gme-nat', op: 'history', args: range }),
      toReadings: () => readings,
    },
  };

  return integration as Integration;
}

/** What `core` was asked. */
type Asked = {
  readonly subject: string;
  readonly payload: { entityId: string; readings: { observedAt: string; value: number }[] };
  readonly options: { timeoutMs?: number } | undefined;
};

/**
 * An import with a transport that answers anything and a `core` that writes everything.
 *
 * @param integration - The driver.
 * @param settings - What to change: the entities created, the signal, what `core` does.
 * @param settings.entityIds - The entities `core` has just created; both by default.
 * @param settings.signal - Ends it.
 * @param settings.onAsk - Called each time `core` is asked; a throw is `core` failing that batch.
 * @param settings.onSend - Called when the transport is asked, before it answers.
 * @returns The job, and what the transport and `core` were asked.
 */
function job(
  integration: Integration,
  settings: {
    readonly entityIds?: readonly EntityId[];
    readonly signal?: AbortSignal;
    readonly onAsk?: (asked: Asked) => void;
    readonly onSend?: () => void;
  } = {},
) {
  const sent: TransportRequest[] = [];
  const asked: Asked[] = [];
  const client = {
    request: async (
      subject: string,
      payload: Asked['payload'],
      schema: unknown,
      options?: { timeoutMs?: number },
    ) => {
      const each = { subject, payload, options };

      asked.push(each);
      settings.onAsk?.(each);

      return Promise.resolve({ written: payload.readings.length, skipped: 0 });
    },
  };
  const value: HistoryImportJob = {
    instanceId: 'pun-zone',
    integration,
    context,
    entityIds: new Set(settings.entityIds ?? [price, zonal]),
    connection: {
      send: async (sentRequest) => {
        sent.push(sentRequest);
        settings.onSend?.();

        return Promise.resolve([]);
      },
    },
    client: client as unknown as HistoryImportJob['client'],
    logger,
    signal: settings.signal ?? new AbortController().signal,
    now: () => now,
  };

  return { value, sent, asked };
}

describe("a device's past", () => {
  it('is asked for once over the days the driver says, and handed to core in batches', async () => {
    const { value, sent, asked } = job(driver([{ entityId: price, readings: minutes(12_000) }]));

    await expect(importHistory(value)).resolves.toEqual({ written: 12_000, skipped: 0 });
    expect(sent).toEqual([
      {
        deviceKey: 'gme-nat',
        op: 'history',
        args: { from: '2026-11-13T12:00:00.000Z', to: '2026-11-16T12:00:00.000Z' },
      },
    ]);
    expect(asked.map((each) => each.payload.readings.length)).toEqual([5000, 5000, 2000]);
    expect(asked[0]?.subject).toBe(busSubjects.service(CORE_SERVICE, CORE_HISTORY_IMPORT_METHOD));
    expect(asked[0]?.payload).toMatchObject({ integrationId: 'pun-zone', entityId: price });
    // Far longer than a command is given: core writes thousands of rows per batch.
    expect(asked[0]?.options?.timeoutMs).toBe(60_000);
  });

  it('never reaches further back than a week', async () => {
    const { value, sent } = job(driver([{ entityId: price, readings: minutes(1) }], 28));

    await importHistory(value);
    expect(sent[0]?.args['from']).toBe('2026-11-09T12:00:00.000Z');
  });

  it('is imported only for the entities core has just created', async () => {
    const { value, asked } = job(
      driver([
        { entityId: price, readings: minutes(3) },
        { entityId: zonal, readings: minutes(3) },
      ]),
      { entityIds: [zonal] },
    );

    await expect(importHistory(value)).resolves.toEqual({ written: 3, skipped: 0 });
    expect(asked.map((each) => each.payload.entityId)).toEqual([zonal]);
  });

  it('is not asked for when no entity is new, nor of a driver that cannot tell it', async () => {
    const none: Partial<Integration> = {};
    const known = job(driver([{ entityId: price, readings: minutes(3) }]), { entityIds: [] });
    const blind = job(none as Integration);

    await expect(importHistory(known.value)).resolves.toBeUndefined();
    await expect(importHistory(blind.value)).resolves.toBeUndefined();
    expect([...known.sent, ...blind.sent]).toEqual([]);
  });

  it('leaves out a reading core would refuse its batch over, and sends times in UTC', async () => {
    const { value, asked } = job(
      driver([
        {
          entityId: price,
          readings: [
            { at: '2026-11-16T12:00:00+01:00', value: 1 },
            { at: '2026-11-16 10:00', value: 2 },
            { at: '2026-11-16T09:00:00.000Z', value: Number.NaN },
          ],
        },
      ]),
    );

    await expect(importHistory(value)).resolves.toEqual({ written: 1, skipped: 2 });
    expect(asked[0]?.payload.readings).toEqual([
      { observedAt: '2026-11-16T11:00:00.000Z', value: 1 },
    ]);
  });

  it('goes on with the next batch when core fails one', async () => {
    const { value, asked } = job(driver([{ entityId: price, readings: minutes(12_000) }]), {
      onAsk: () => {
        if (asked.length === 1) {
          throw new Error('timed out');
        }
      },
    });

    await expect(importHistory(value)).resolves.toEqual({ written: 7000, skipped: 0 });
    expect(asked).toHaveLength(3);
  });

  it('asks core nothing once the instance stops, even when the transport answers anyway', async () => {
    const abort = new AbortController();
    const { value, asked } = job(driver([{ entityId: price, readings: minutes(10) }]), {
      signal: abort.signal,
      onSend: () => {
        abort.abort();
      },
    });

    await expect(importHistory(value)).resolves.toBeUndefined();
    expect(asked).toEqual([]);
  });

  it('stops between batches once the instance stops', async () => {
    const abort = new AbortController();
    const { value, asked } = job(driver([{ entityId: price, readings: minutes(12_000) }]), {
      signal: abort.signal,
      onAsk: () => {
        abort.abort();
      },
    });

    await expect(importHistory(value)).resolves.toEqual({ written: 5000, skipped: 0 });
    expect(asked).toHaveLength(1);
  });
});
