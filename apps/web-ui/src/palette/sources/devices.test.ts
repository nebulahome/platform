import { describe, expect, it } from 'vitest';

import { queryWords } from '@/lib/search-text';
import { rankItems } from '@/palette/rank';
import { deviceItems } from '@/palette/sources/devices';
import { aDevice } from '@/testing/fixtures';
import { LINKED_SAMPLE_DEVICE } from '@/testing/linked-samples';

const DEVICES = [
  aDevice({
    id: 'garage',
    name: 'Garage relay',
    transportConfig: { host: '192.168.1.40' },
    mac: 'b0:81:84:96:2e:10',
  }),
  aDevice({
    id: 'thermometer',
    name: 'Bedroom thermometer',
    transportConfig: {},
    mac: null,
    externalId: 'A4:C1:38:0B:2F:91',
  }),
  { ...LINKED_SAMPLE_DEVICE, name: 'Dryer plug' },
];

/**
 * The names found for a query, best first.
 *
 * @param query - As typed.
 * @returns The names.
 */
function found(query: string): string[] {
  return rankItems(deviceItems(DEVICES, new Map()), queryWords(query), new Set()).map(
    ({ item }) => item.title,
  );
}

describe('deviceItems', () => {
  it('finds a device by its IP, and shows the address on its row', () => {
    expect(found('192.168.1.40')).toEqual(['Garage relay']);
    expect(deviceItems(DEVICES, new Map())[0]?.secondary).toContain('192.168.1.40');
  });

  it('finds a MAC typed with colons, dashes or nothing between, in either case', () => {
    expect(found('B0:81:84')).toEqual(['Garage relay']);
    expect(found('b0-81-84-96')).toEqual(['Garage relay']);
    expect(found('b08184962e10')).toEqual(['Garage relay']);
  });

  it('finds a Bluetooth device by the address it is keyed on', () => {
    expect(found('a4c1380b2f91')).toEqual(['Bedroom thermometer']);
    expect(deviceItems(DEVICES, new Map())[1]?.secondary).toContain('A4:C1:38:0B:2F:91');
  });

  it('finds a linked device by the address of any way into it', () => {
    const addresses = (LINKED_SAMPLE_DEVICE.linked?.ways ?? []).flatMap((way) =>
      way.address === null ? [] : [way.address],
    );

    expect(addresses.length).toBeGreaterThan(0);

    for (const address of addresses) {
      expect(found(address)).toContain('Dryer plug');
    }
  });
});
