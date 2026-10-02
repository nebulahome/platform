import { describe, expect, it } from 'vitest';

import {
  NotFoundError,
  parseEntityId,
  type CapabilityName,
  type JsonObject,
} from '@nebulahome/contracts';

import { EntityDirectory, type EntityRecord } from './entity-directory.js';

const bulb = parseEntityId('light.kitchen_ceiling');
const derived = parseEntityId('alias.average_indoor_temperature');

/**
 * Builds a record for one entity.
 *
 * @param entityId - The entity.
 * @param source - Who owns it.
 * @returns The record.
 */
function record(entityId: ReturnType<typeof parseEntityId>, source: string): EntityRecord {
  return {
    entityId,
    rowId: `row-${entityId}`,
    source,
    isEnabled: true,
    capabilities: new Map<CapabilityName, JsonObject>([['on_off', {}]]),
  };
}

describe('EntityDirectory', () => {
  it('reads back what was put in', () => {
    const directory = new EntityDirectory();

    directory.set(record(bulb, 'pkg-mqtt'));

    expect(directory.get(bulb)?.rowId).toBe('row-light.kitchen_ceiling');
    expect(directory.size).toBe(1);
  });

  it('answers a missing entity with the error the API turns into a 404', () => {
    expect(() => new EntityDirectory().require(bulb)).toThrow(NotFoundError);
  });

  it('lists only the adapters worth asking for a resynchronisation', () => {
    // Derived and system entities have no adapter behind them, so asking one to resend would be
    // a request nobody answers and a five-second timeout at every startup.
    const directory = new EntityDirectory();

    directory.set(record(bulb, 'pkg-mqtt'));
    directory.set(record(parseEntityId('sensor.hallway_motion'), 'pkg-mqtt'));
    directory.set(record(parseEntityId('switch.desk_lamp'), 'pkg-wifi'));
    directory.set(record(derived, 'derived'));

    expect(directory.owningPackages().toSorted()).toStrictEqual(['pkg-mqtt', 'pkg-wifi']);
  });

  it('forgets an entity', () => {
    const directory = new EntityDirectory();

    directory.set(record(bulb, 'pkg-mqtt'));

    expect(directory.remove(bulb)).toBe(true);
    expect(directory.remove(bulb)).toBe(false);
    expect(directory.size).toBe(0);
  });
});
