import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  busSubjects,
  entityStateSchema,
  parseEntityId,
  resyncRequestSchema,
  type ResyncReply,
  type ResyncRequest,
} from '@nebulahome/contracts';

import { entityRecord, createCoreHarness, type CoreHarness } from '../testing/harness.js';

import { requestResync } from './resync.js';

const bulb = parseEntityId('light.kitchen_ceiling');
const thermometer = parseEntityId('sensor.kitchen_temperature');
const average = parseEntityId('alias.average_indoor_temperature');

describe('requestResync', () => {
  let harness: CoreHarness;

  beforeEach(() => {
    harness = createCoreHarness();

    harness.directory.set(entityRecord(bulb, { source: 'pkg-weather' }));
    harness.directory.set(entityRecord(thermometer, { source: 'pkg-wifi' }));
    harness.directory.set(entityRecord(average, { source: 'derived' }));

    harness.registry.apply(
      { entityId: bulb, state: { on_off: { isOn: true } } },
      { source: 'pkg-weather' },
    );
    harness.registry.apply(
      { entityId: thermometer, state: { sensor_numeric: { value: 21 } } },
      { source: 'pkg-wifi' },
    );
  });

  /**
   * Starts an adapter that answers a resynchronisation request.
   *
   * @param packageId - The package it publishes under.
   * @param seen - Where the request is recorded.
   */
  function startAdapter(packageId: string, seen: ResyncRequest[]): void {
    harness
      .clientFor(packageId)
      .serve(
        busSubjects.stateResync(packageId),
        resyncRequestSchema,
        (request: ResyncRequest): ResyncReply => {
          seen.push(request);

          return { entityCount: 1 };
        },
      );
  }

  /**
   * Runs a pass with the harness's collaborators.
   *
   * @returns Which adapters answered and which did not.
   */
  const run = async (): ReturnType<typeof requestResync> =>
    requestResync({
      client: harness.client,
      directory: harness.directory,
      registry: harness.registry,
      logger: harness.logger,
      timeoutMs: 200,
      reason: 'startup',
    });

  it('asks only the packages that actually own an entity', async () => {
    // A derived entity has no adapter behind it, so asking would be a request nobody answers and
    // a timeout at every single startup.
    const weather: ResyncRequest[] = [];
    const wifi: ResyncRequest[] = [];

    startAdapter('pkg-weather', weather);
    startAdapter('pkg-wifi', wifi);

    const outcome = await run();

    expect(outcome.answered.toSorted()).toStrictEqual(['pkg-weather', 'pkg-wifi']);
    expect(outcome.silent).toStrictEqual([]);
    expect(weather).toStrictEqual([{ reason: 'startup' }]);
    expect(wifi).toStrictEqual([{ reason: 'startup' }]);
  });

  it('marks the entities of a silent adapter unreachable', async () => {
    // A package that is not running is the expected case, not a failure to abort on. Showing
    // values nobody has confirmed since the restart would be worse than greying them out.
    startAdapter('pkg-weather', []);

    const outcome = await run();

    expect(outcome.answered).toStrictEqual(['pkg-weather']);
    expect(outcome.silent).toStrictEqual(['pkg-wifi']);
    expect(harness.registry.get(thermometer)?.isAvailable).toBe(false);
    expect(harness.registry.get(bulb)?.isAvailable).toBe(true);
  });

  it('keeps the last known values of an unreachable adapter', async () => {
    startAdapter('pkg-weather', []);

    await run();

    expect(harness.registry.get(thermometer)?.state.sensor_numeric?.value).toBe(21);
  });

  it('tells everyone when an entity becomes unreachable', async () => {
    const events: { current: { isAvailable: boolean } }[] = [];

    harness
      .clientFor('api')
      .subscribe(
        busSubjects.stateChanged(thermometer),
        z.object({ current: entityStateSchema }),
        (payload) => {
          events.push(payload);
        },
      );

    startAdapter('pkg-weather', []);

    await run();

    await vi.waitFor(() => {
      expect(events).toHaveLength(1);
    });

    expect(events[0]?.current.isAvailable).toBe(false);
  });

  it('does nothing at all when no package owns anything', async () => {
    const empty = createCoreHarness();

    const outcome = await requestResync({
      client: empty.client,
      directory: empty.directory,
      registry: empty.registry,
      logger: empty.logger,
      timeoutMs: 200,
      reason: 'startup',
    });

    expect(outcome).toStrictEqual({ answered: [], silent: [] });
  });
});
