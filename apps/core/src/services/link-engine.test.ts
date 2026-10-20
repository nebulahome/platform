import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseEntityId, type EntityId, type StateReport } from '@nebulahome/contracts';

import type { EntityRecord } from '../domain/entity-directory.js';
import { createCoreHarness, entityRecord, type CoreHarness } from '../testing/harness.js';

import { countOn, LinkEngine } from './link-engine.js';

const plug = parseEntityId('switch.dryer_plug');
const plugMatter = parseEntityId('switch.matter_dryer_plug');
const energy = parseEntityId('sensor.dryer_plug_energy');
const energyMatter = parseEntityId('sensor.matter_dryer_plug_energy');

/**
 * The two sides of a link: the entity that leads, through Shelly, and its Matter twin.
 *
 * @param holder - The leading entity.
 * @param child - The one linked to it.
 * @param options - What the pair reads.
 * @param options.capabilities - What both declare.
 * @param options.stateClass - How the reading accumulates.
 * @returns The two records.
 */
function linked(
  holder: EntityId,
  child: EntityId,
  options: { capabilities: Record<string, object>; stateClass?: string },
): [EntityRecord, EntityRecord] {
  return [
    {
      ...entityRecord(holder, { source: 'shelly-plug', capabilities: options.capabilities }),
      sources: [holder, child],
      transport: null,
      preferred: 'shelly-plug',
      stateClass: options.stateClass ?? null,
    },
    {
      ...entityRecord(child, { source: 'matter-plug', capabilities: options.capabilities }),
      linkedTo: holder,
    },
  ];
}

describe('LinkEngine', () => {
  let harness: CoreHarness;
  let engine: LinkEngine;

  /**
   * Has one source report, as its adapter would.
   *
   * @param entityId - The source.
   * @param report - What it says.
   * @throws {Error} When the source is not in the directory.
   */
  const say = (entityId: EntityId, report: Omit<StateReport, 'entityId'>): void => {
    const record = harness.directory.get(entityId);

    if (record === undefined) {
      throw new Error(`No record for ${entityId}`);
    }

    engine.report(record, { entityId, ...report }, 'trace');
  };

  beforeEach(() => {
    harness = createCoreHarness();

    for (const record of [
      ...linked(plug, plugMatter, { capabilities: { on_off: {} } }),
      ...linked(energy, energyMatter, {
        capabilities: { sensor_numeric: {} },
        stateClass: 'total_increasing',
      }),
    ]) {
      harness.directory.set(record);
    }

    engine = new LinkEngine({
      directory: harness.directory,
      registry: harness.registry,
      ingest: {
        client: harness.client,
        registry: harness.registry,
        directory: harness.directory,
        history: harness.history,
        stateCache: harness.stateCache,
        logger: harness.logger,
      },
      logger: harness.logger,
      newTraceId: () => 'trace',
    });
    engine.start();
  });

  it('reads the way the device prefers, and both addresses read the same', () => {
    say(plug, { state: { on_off: { isOn: true } } });
    say(plugMatter, { state: { on_off: { isOn: false } } });

    expect(harness.registry.get(plug)).toMatchObject({
      state: { on_off: { isOn: true } },
      source: 'shelly-plug',
    });
    expect(harness.registry.get(plugMatter)).toMatchObject({
      entityId: plugMatter,
      state: { on_off: { isOn: true } },
    });
  });

  it('is read the other way while the preferred one is silent, and comes back', async () => {
    say(plug, { state: { on_off: { isOn: true } } });
    say(plugMatter, { state: { on_off: { isOn: true } } });

    await vi.waitFor(() => {
      expect(harness.historyRows).toHaveLength(1);
    });

    say(plug, { state: { on_off: { isOn: true } }, isAvailable: false });

    expect(harness.registry.get(plug)).toMatchObject({ isAvailable: true, source: 'matter-plug' });

    // The state held, the way in changed: the history says so.
    await vi.waitFor(async () => {
      await harness.history.flush();
      expect(harness.historyRows.map((row) => row.source)).toEqual(['shelly-plug', 'matter-plug']);
    });

    say(plug, { state: { on_off: { isOn: true } }, isAvailable: true });

    expect(harness.registry.get(plug)?.source).toBe('shelly-plug');
  });

  it('is unavailable only when every way in is silent', () => {
    say(plug, { state: { on_off: { isOn: true } }, isAvailable: false });
    say(plugMatter, { state: { on_off: { isOn: true } }, isAvailable: false });

    expect(harness.registry.get(plug)?.isAvailable).toBe(false);
  });

  it('carries a counter on across a change of way, and over a meter that starts again', () => {
    say(energy, { state: { sensor_numeric: { value: 100 } } });
    say(energyMatter, { state: { sensor_numeric: { value: 5000 } } });

    expect(harness.registry.get(energy)?.state.sensor_numeric?.value).toBe(100);

    say(energy, { state: { sensor_numeric: { value: 100 } }, isAvailable: false });
    expect(harness.registry.get(energy)?.state.sensor_numeric?.value).toBe(100);

    say(energyMatter, { state: { sensor_numeric: { value: 5003 } } });
    expect(harness.registry.get(energy)?.state.sensor_numeric?.value).toBe(103);

    say(energy, { state: { sensor_numeric: { value: 102 } }, isAvailable: true });
    expect(harness.registry.get(energy)?.state.sensor_numeric?.value).toBe(103);

    say(energy, { state: { sensor_numeric: { value: 104 } } });
    expect(harness.registry.get(energy)?.state.sensor_numeric?.value).toBe(105);

    say(energy, { state: { sensor_numeric: { value: 1 } } });
    expect(harness.registry.get(energy)?.state.sensor_numeric?.value).toBe(106);
  });

  it('sends a command the way that answers', () => {
    const holder = harness.directory.get(plug);

    say(plug, { state: { on_off: { isOn: true } } });
    say(plugMatter, { state: { on_off: { isOn: true } } });

    expect(holder && engine.route(holder, 'on_off')?.entityId).toBe(plug);

    say(plug, { state: { on_off: { isOn: true } }, isAvailable: false });

    expect(holder && engine.route(holder, 'on_off')?.entityId).toBe(plugMatter);
  });

  it('reads the other way when an adapter does not answer', () => {
    say(plug, { state: { on_off: { isOn: true } } });
    say(plugMatter, { state: { on_off: { isOn: false } } });

    engine.silence('shelly-plug');

    expect(harness.registry.get(plug)).toMatchObject({
      state: { on_off: { isOn: false } },
      source: 'matter-plug',
    });
  });

  it('gives an unlinked entity back what its adapter last said', () => {
    say(plug, { state: { on_off: { isOn: true } } });
    say(plugMatter, { state: { on_off: { isOn: false } } });

    const before = [harness.directory.get(plug), harness.directory.get(plugMatter)].filter(
      (record): record is EntityRecord => record !== undefined,
    );

    harness.directory.set(entityRecord(plug, { source: 'shelly-plug' }));
    harness.directory.set(entityRecord(plugMatter, { source: 'matter-plug' }));
    engine.resync(before);

    expect(harness.registry.get(plugMatter)).toMatchObject({
      entityId: plugMatter,
      state: { on_off: { isOn: false } },
    });
    expect(harness.registry.get(plug)?.state.on_off).toEqual({ isOn: true });
  });
});

describe('countOn', () => {
  it("starts a freshly linked counter from the leading entity's own reading", () => {
    expect(
      countOn({
        total: 312.4,
        counter: undefined,
        source: energy,
        value: 312.5,
        isSwitch: false,
        isHolder: true,
      }),
    ).toBe(312.5);
  });

  it('takes the first reading of another way as a reference only', () => {
    expect(
      countOn({
        total: 312.4,
        counter: undefined,
        source: energyMatter,
        value: 9000,
        isSwitch: false,
        isHolder: false,
      }),
    ).toBe(312.4);
  });
});
