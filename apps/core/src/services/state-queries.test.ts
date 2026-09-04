import {
  busSubjects,
  entityStateSchema,
  NotFoundError,
  parseEntityId,
  stateSnapshotReplySchema,
} from '@nebula-home/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { createCoreHarness, type CoreHarness } from '../testing/harness.js';

import { startEntityReadService, startSnapshotService } from './state-queries.js';

const bulb = parseEntityId('light.kitchen_ceiling');
const thermometer = parseEntityId('sensor.kitchen_temperature');
const unknown = parseEntityId('light.never_reported');

const TAKEN_AT = new Date('2026-09-04T12:00:00.000Z');

describe('state queries', () => {
  let harness: CoreHarness;

  beforeEach(() => {
    harness = createCoreHarness(() => TAKEN_AT);

    harness.registry.apply(
      { entityId: bulb, state: { on_off: { isOn: true } } },
      { source: 'pkg-mqtt' },
    );
    harness.registry.apply(
      { entityId: thermometer, state: { sensor_numeric: { value: 21.5 } } },
      { source: 'pkg-wifi' },
    );

    startSnapshotService({
      client: harness.client,
      registry: harness.registry,
      now: () => TAKEN_AT,
    });
    startEntityReadService({ client: harness.client, registry: harness.registry });
  });

  it('answers a snapshot with everything the registry holds', async () => {
    // The one request a service makes at startup, after which it stays current from the event
    // stream. That pairing is why no event on the bus needs to be durable.
    const snapshot = await harness
      .clientFor('api')
      .request(busSubjects.stateSnapshot(), {}, stateSnapshotReplySchema);

    expect(snapshot.entities.map((entity) => entity.entityId)).toStrictEqual([bulb, thermometer]);
    expect(snapshot.takenAt).toStrictEqual(TAKEN_AT);
  });

  it('survives a round trip through JSON with its dates intact', async () => {
    const snapshot = await harness
      .clientFor('api')
      .request(busSubjects.stateSnapshot(), {}, stateSnapshotReplySchema);

    expect(snapshot.entities[0]?.lastChanged).toBeInstanceOf(Date);
    expect(snapshot.entities[0]?.lastUpdated).toBeInstanceOf(Date);
  });

  it('answers a single-entity read', async () => {
    const state = await harness
      .clientFor('api')
      .request(busSubjects.stateGet(thermometer), {}, entityStateSchema);

    expect(state.entityId).toBe(thermometer);
    expect(state.state.sensor_numeric?.value).toBe(21.5);
  });

  it('reports an entity nobody has reported as not found', async () => {
    // Distinct from an entity that exists and is unreachable, which answers normally with
    // `isAvailable: false`.
    await expect(
      harness.clientFor('api').request(busSubjects.stateGet(unknown), {}, entityStateSchema),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a read subject that does not name an entity', async () => {
    await expect(
      harness.clientFor('api').request('nebula.v1.state.get.NotAnEntity', {}, entityStateSchema),
    ).rejects.toThrow(/does not name an entity/);
  });

  it('reflects a change made after the service started', async () => {
    harness.registry.apply(
      { entityId: bulb, state: { on_off: { isOn: false } } },
      { source: 'pkg-mqtt' },
    );

    const state = await harness
      .clientFor('api')
      .request(busSubjects.stateGet(bulb), {}, entityStateSchema);

    expect(state.state.on_off?.isOn).toBe(false);
  });
});
