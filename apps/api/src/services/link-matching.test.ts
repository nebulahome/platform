import { describe, expect, it } from 'vitest';

import { matchEntities, type MatchEntity } from './link-matching.js';

/**
 * One entity, as linking compares it.
 *
 * @param rowId - Its row, which names it in the test.
 * @param fields - What differs from a power sensor reached over Shelly.
 * @returns The entity.
 */
function entity(rowId: string, fields: Partial<MatchEntity> = {}): MatchEntity {
  return {
    rowId,
    entityId: `sensor.${rowId}`,
    domain: 'sensor',
    capabilities: ['sensor_numeric'],
    deviceClass: 'power',
    unit: 'W',
    stateClass: 'measurement',
    matter: null,
    isMatter: false,
    value: null,
    ...fields,
  };
}

const RELAY = { endpoint: 1, cluster: 6, attribute: 0 };

describe('matchEntities', () => {
  it('links what the bundle declares, a relay as much as a meter', () => {
    const relay = entity('relay', { domain: 'switch', capabilities: ['on_off'], matter: RELAY });
    const matterRelay = entity('m-relay', {
      domain: 'switch',
      capabilities: ['on_off'],
      matter: RELAY,
      isMatter: true,
    });

    expect(matchEntities([relay], [matterRelay]).pairs).toEqual([
      { a: relay, b: matterRelay, origin: 'declared' },
    ]);
  });

  it('links the one sensor of a kind on each side, and never two controls alike', () => {
    const power = entity('power');
    const matterPower = entity('m-power', { isMatter: true });
    const relays = [
      entity('relay', { domain: 'switch', capabilities: ['on_off'] }),
      entity('m-relay', { domain: 'switch', capabilities: ['on_off'], isMatter: true }),
    ] as const;

    const result = matchEntities([power, relays[0]], [matterPower, relays[1]]);

    expect(result.pairs.map((pair) => [pair.a.rowId, pair.b.rowId, pair.origin])).toEqual([
      ['power', 'm-power', 'auto'],
    ]);
    expect(result.suggested.map(([a, b]) => [a.rowId, b.rowId])).toEqual([['relay', 'm-relay']]);
  });

  it('tells two pairs apart by what they read only when it is clear', () => {
    const left = [entity('p1', { value: 0 }), entity('p2', { value: 120 })];
    const right = [
      entity('m1', { value: 121, isMatter: true }),
      entity('m2', { value: 0, isMatter: true }),
    ];

    expect(matchEntities(left, right).pairs.map((pair) => [pair.a.rowId, pair.b.rowId])).toEqual([
      ['p1', 'm2'],
      ['p2', 'm1'],
    ]);

    const idle = [entity('p1', { value: 0 }), entity('p2', { value: 0 })];
    const idleMatter = [
      entity('m1', { value: 0, isMatter: true }),
      entity('m2', { value: 0, isMatter: true }),
    ];
    const unclear = matchEntities(idle, idleMatter);

    expect(unclear.pairs).toEqual([]);
    expect(unclear.suggested).toHaveLength(4);
  });

  it('never links, nor suggests, again what the owner unlinked', () => {
    const result = matchEntities(
      [entity('power')],
      [entity('m-power', { isMatter: true })],
      [['m-power', 'power']],
    );

    expect(result.pairs).toEqual([]);
    expect(result.suggested).toEqual([]);
  });
});
