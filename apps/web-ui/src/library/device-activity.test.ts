/**
 * A device's activity in words, and a device-wide event drawn as one line.
 */
import { describe, expect, it } from 'vitest';

import { entityIdSchema, type ActivityEntry } from '@nebulahome/contracts';

import { anEntity } from '@/testing/fixtures';

import { activityLinesOf, byDay, changesOf, dayOf } from './device-activity';

const RELAY = anEntity({ entityId: 'switch.bench_relay', name: 'Relay' });
const THERMOSTAT = anEntity({
  entityId: 'climate.hall',
  name: 'Hall thermostat',
  capabilities: [{ capability: 'thermostat', params: {} }],
});
const ENTITIES = new Map([
  [RELAY.entityId, RELAY],
  [THERMOSTAT.entityId, THERMOSTAT],
]);

/**
 * One entry of the activity.
 *
 * @param overrides - What differs from the relay turning on at ten.
 * @returns The entry.
 */
function entry(overrides: Partial<ActivityEntry>): ActivityEntry {
  return {
    time: new Date('2026-09-25T10:00:00.000Z'),
    entityId: entityIdSchema.parse('switch.bench_relay'),
    kind: 'state',
    from: { on_off: { isOn: false } },
    to: { on_off: { isOn: true } },
    isAvailable: true,
    wasAvailable: true,
    source: 'shelly-bench',
    ...overrides,
  };
}

describe('activityLinesOf', () => {
  it('says a switch turned on or off', () => {
    const [on, off] = activityLinesOf(
      [entry({}), entry({ from: { on_off: { isOn: true } }, to: { on_off: { isOn: false } } })],
      ENTITIES,
      'Bench relay',
    );

    expect([on?.title, on?.summary, on?.tone]).toEqual(['Relay', 'Turned on', 'on']);
    expect([off?.summary, off?.tone]).toEqual(['Turned off', 'off']);
  });

  it('says what a capability went from and to, named as the entity names it', () => {
    const base = {
      currentTemperature: 20,
      targetTemperature: 21,
      action: 'idle',
      humidity: 40,
    };
    const [line] = activityLinesOf(
      [
        entry({
          entityId: entityIdSchema.parse('climate.hall'),
          from: { thermostat: { ...base, mode: 'heat' } },
          to: { thermostat: { ...base, mode: 'auto' } },
        }),
      ],
      ENTITIES,
      'Hall',
    );

    expect(line?.summary).toMatch(/^Climate: .+ → .+$/u);
    expect(line?.changes).toHaveLength(1);
  });

  it('draws a device dropping off the network as one line, counting what it took', () => {
    const offline = { kind: 'availability' as const, isAvailable: false, wasAvailable: true };
    const lines = activityLinesOf(
      [
        entry({ ...offline }),
        entry({
          ...offline,
          entityId: entityIdSchema.parse('climate.hall'),
          time: new Date('2026-09-25T09:59:59.000Z'),
        }),
      ],
      ENTITIES,
      'Bench relay',
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      title: 'Bench relay',
      summary: 'Went offline · 2 entities',
      tone: 'offline',
    });
    expect(lines[0]?.entries).toHaveLength(2);
  });

  it('keeps an entity it no longer knows, by its address', () => {
    const [line] = activityLinesOf(
      [entry({ entityId: entityIdSchema.parse('switch.gone') })],
      ENTITIES,
      'Bench relay',
    );

    expect(line?.title).toBe('switch.gone');
  });
});

describe('changesOf', () => {
  it('leaves out a capability that did not change', () => {
    const changes = changesOf(
      {
        from: { on_off: { isOn: true }, level: { level: 40 } },
        to: { on_off: { isOn: true }, level: { level: 60 } },
      },
      { unitOfMeasurement: null, deviceClass: null, domain: 'light' },
    );

    expect(changes).toEqual([
      { capability: 'level', label: 'Brightness', before: '40%', after: '60%' },
    ]);
  });
});

describe('dayOf and byDay', () => {
  const now = new Date(2026, 8, 25, 18, 0);

  it('names today and yesterday, and the date before that', () => {
    expect(dayOf(new Date(2026, 8, 25, 1, 0), now)).toBe('Today');
    expect(dayOf(new Date(2026, 8, 24, 23, 0), now)).toBe('Yesterday');
    expect(dayOf(new Date(2026, 8, 20, 12, 0), now)).not.toMatch(/Today|Yesterday/u);
  });

  it('groups the lines under their day, in order', () => {
    const lines = activityLinesOf(
      [
        entry({ time: new Date(2026, 8, 25, 9, 0) }),
        entry({ time: new Date(2026, 8, 24, 9, 0) }),
        entry({ time: new Date(2026, 8, 24, 8, 0) }),
      ],
      ENTITIES,
      'Bench relay',
    );

    expect(byDay(lines, now).map((group) => [group.day, group.lines.length])).toEqual([
      ['Today', 1],
      ['Yesterday', 2],
    ]);
  });
});
