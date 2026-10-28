import { describe, expect, it } from 'vitest';

import {
  BLUETOOTH_SAMPLE_DEVICES,
  BLUETOOTH_SAMPLE_MAP,
  BLUETOOTH_SAMPLE_NEARBY,
} from '@/testing/bluetooth-samples';

import { bluetoothMapOf } from './bluetooth-map';
import { isKept } from './bluetooth-nearby';

describe('bluetoothMapOf', () => {
  it('rings the scanners round this server and hangs each device on the one that hears it best', () => {
    const { points, links } = bluetoothMapOf(BLUETOOTH_SAMPLE_MAP, BLUETOOTH_SAMPLE_DEVICES);

    expect(points[0]).toMatchObject({ id: 'server', x: 0, y: 0 });
    expect(links.map((link) => `${link.source} > ${link.target} (${link.look})`).sort()).toEqual([
      'adapter:hci0 > A4:C1:38:0D:7E:52 (strong)',
      'adapter:hci0 > D8:2C:5E:41:03:9A (connected)',
      'proxy:bathroom-plug > 5C:F8:21:9B:44:D7 (fair)',
      'proxy:bathroom-plug > 7C:C6:B6:61:2A:0F (strong)',
      'proxy:garage-plug > 38:39:8F:A2:10:6C (strong)',
      'proxy:kitchen-plug > C4:7C:8D:6A:51:E0 (weak)',
      'server > adapter:hci0 (adapter)',
      'server > proxy:bathroom-plug (wifi)',
      'server > proxy:garage-plug (wifi)',
      'server > proxy:kitchen-plug (wifi)',
    ]);
  });
});

describe('the Nearby filter', () => {
  it('keeps what is recognised by an integration, with a fair signal or better', () => {
    const kept = BLUETOOTH_SAMPLE_NEARBY.filter((item) =>
      isKept(
        item,
        {
          recognised: new Set(['integration']),
          signal: 'fair',
          heardBy: new Set(),
          makers: new Set(),
          isNamedOnly: false,
          isRecentOnly: false,
          showsPrivate: false,
          sortBy: 'signal',
        },
        Date.now(),
      ),
    );

    expect(kept.map((item) => item.name)).toEqual(['ATC_5E910B', 'Meter Plus']);
  });
});
