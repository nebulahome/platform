import { describe, expect, it } from 'vitest';

import { aVendor } from '@/testing/fixtures';

import { wayName } from './transport-marks';

const vendors = new Map(
  ['SwitchBot', 'Shelly'].map((name) => [
    name.toLowerCase(),
    aVendor({ id: name.toLowerCase(), name }),
  ]),
);

describe('wayName', () => {
  it("names a way by its transport, so one vendor's two ways never read alike", () => {
    const names = ['switchbot/cloud', 'bluetooth', 'matter'].map((transport) =>
      wayName({ vendorId: 'switchbot', transport }, vendors, 'Matter'),
    );

    expect(names).toEqual(['SwitchBot Cloud', 'Bluetooth', 'Matter']);
    expect(wayName({ vendorId: 'shelly', transport: 'shelly/rpc' }, vendors, 'Matter')).toBe(
      'Shelly',
    );
  });
});
