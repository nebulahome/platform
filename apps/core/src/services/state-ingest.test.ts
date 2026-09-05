import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  busSubjects,
  entityStateSchema,
  parseEntityId,
  type EntityState,
} from '@nebula-home/contracts';

import { entityRecord, createCoreHarness, type CoreHarness } from '../testing/harness.js';

import { startStateIngest } from './state-ingest.js';

const bulb = parseEntityId('light.kitchen_ceiling');
const hallway = parseEntityId('light.hallway');
const thermometer = parseEntityId('sensor.kitchen_temperature');

describe('startStateIngest', () => {
  let harness: CoreHarness;

  beforeEach(() => {
    harness = createCoreHarness();
    harness.directory.set(entityRecord(bulb, { capabilities: { on_off: {}, level: {} } }));
    harness.directory.set(entityRecord(thermometer, { capabilities: { sensor_numeric: {} } }));

    startStateIngest({
      client: harness.client,
      registry: harness.registry,
      directory: harness.directory,
      history: harness.history,
      stateCache: harness.stateCache,
      logger: harness.logger,
    });
  });

  it('applies a report from the owning adapter', async () => {
    harness.clientFor('pkg-mqtt').publish(busSubjects.stateReport(bulb), {
      entityId: bulb,
      state: { on_off: { isOn: true } },
    });

    await vi.waitFor(() => {
      expect(harness.registry.get(bulb)?.state.on_off?.isOn).toBe(true);
    });
  });

  it('writes one history row and one cache row per change', async () => {
    harness.clientFor('pkg-mqtt').publish(busSubjects.stateReport(bulb), {
      entityId: bulb,
      state: { level: { level: 40 } },
    });

    await vi.waitFor(() => {
      expect(harness.historyRows).toHaveLength(1);
      expect(harness.cacheRows).toHaveLength(1);
    });

    // The hypertable references the uuid, not the text identifier, which is the whole reason the
    // directory carries the row id at all.
    expect(harness.historyRows[0]?.entityId).toBe(`row-${bulb}`);
    expect(harness.historyRows[0]?.previousState).toBeNull();
  });

  it('writes nothing when a sensor repeats itself', async () => {
    const adapter = harness.clientFor('pkg-mqtt');

    adapter.publish(busSubjects.stateReport(thermometer), {
      entityId: thermometer,
      state: { sensor_numeric: { value: 21.5 } },
    });

    await vi.waitFor(() => {
      expect(harness.historyRows).toHaveLength(1);
    });

    adapter.publish(busSubjects.stateReport(thermometer), {
      entityId: thermometer,
      state: { sensor_numeric: { value: 21.5 } },
    });
    adapter.publish(busSubjects.stateReport(thermometer), {
      entityId: thermometer,
      state: { sensor_numeric: { value: 21.5 } },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // A power meter reporting every second would otherwise write 86,400 identical rows a day.
    expect(harness.historyRows).toHaveLength(1);
  });

  it('refuses a report from a package that does not own the entity', async () => {
    // Without this, any installed package could report `lock.front_door` as unlocked.
    harness.clientFor('pkg-impostor').publish(busSubjects.stateReport(bulb), {
      entityId: bulb,
      state: { on_off: { isOn: true } },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(harness.registry.get(bulb)).toBeUndefined();
    expect(harness.historyRows).toHaveLength(0);
  });

  it('refuses a report whose subject and payload name different entities', async () => {
    // Guessing which of the two to believe is how a report ends up applied to the wrong light.
    harness.clientFor('pkg-mqtt').publish(busSubjects.stateReport(hallway), {
      entityId: bulb,
      state: { on_off: { isOn: true } },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(harness.registry.get(bulb)).toBeUndefined();
    expect(harness.registry.get(hallway)).toBeUndefined();
  });

  it('refuses a report for an entity nobody registered', async () => {
    harness.clientFor('pkg-mqtt').publish(busSubjects.stateReport(hallway), {
      entityId: hallway,
      state: { on_off: { isOn: true } },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(harness.registry.get(hallway)).toBeUndefined();
  });

  it('ignores a report for an entity the owner disabled', async () => {
    harness.directory.set(entityRecord(hallway, { isEnabled: false }));

    harness.clientFor('pkg-mqtt').publish(busSubjects.stateReport(hallway), {
      entityId: hallway,
      state: { on_off: { isOn: true } },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(harness.registry.get(hallway)).toBeUndefined();
  });

  it('drops a report whose payload does not match the capability schema', async () => {
    harness.clientFor('pkg-mqtt').publish(busSubjects.stateReport(bulb), {
      entityId: bulb,
      state: { level: { level: 'very bright' } },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(harness.registry.get(bulb)).toBeUndefined();
  });

  it('keeps serving after a rejected report', async () => {
    // One misbehaving adapter must not silently stop every state report in the house.
    const adapter = harness.clientFor('pkg-mqtt');

    adapter.publish(busSubjects.stateReport(bulb), { entityId: bulb, state: { level: {} } });
    adapter.publish(busSubjects.stateReport(bulb), {
      entityId: bulb,
      state: { on_off: { isOn: true } },
    });

    await vi.waitFor(() => {
      expect(harness.registry.get(bulb)?.state.on_off?.isOn).toBe(true);
    });
  });

  it('fans the change out with both the new state and the old one', async () => {
    const events: { current: EntityState; previous?: EntityState | undefined }[] = [];

    harness
      .clientFor('api')
      .subscribe(
        busSubjects.stateChanged(bulb),
        z.object({ current: entityStateSchema, previous: entityStateSchema.optional() }),
        (payload) => {
          events.push(payload);
        },
      );

    const adapter = harness.clientFor('pkg-mqtt');

    adapter.publish(busSubjects.stateReport(bulb), {
      entityId: bulb,
      state: { level: { level: 10 } },
    });

    await vi.waitFor(() => {
      expect(events).toHaveLength(1);
    });

    adapter.publish(busSubjects.stateReport(bulb), {
      entityId: bulb,
      state: { level: { level: 90 } },
    });

    await vi.waitFor(() => {
      expect(events).toHaveLength(2);
    });

    // The previous state is what lets a subscriber tell "turned on" from "was already on".
    expect(events[1]?.previous).toMatchObject({ state: { level: { level: 10 } } });
  });
});
