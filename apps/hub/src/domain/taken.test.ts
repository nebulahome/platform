import { describe, expect, it } from 'vitest';

import { takenFrom } from './taken.js';

describe('takenFrom', () => {
  it("keys every instance's address and device by its vendor", () => {
    const taken = takenFrom([
      { kind: 'shelly/switch-pm', transportConfig: { host: '192.168.1.40' }, externalId: 'abc' },
      { kind: 'sonoff/diy-plug', transportConfig: { host: '192.168.1.50:8081' }, externalId: null },
    ]);

    expect([...taken.externalIds]).toEqual(['shelly\nabc']);
    expect([...taken.hosts]).toEqual(['shelly\n192.168.1.40', 'sonoff\n192.168.1.50:8081']);
  });

  it('counts an instance that has not been identified yet by its address alone', () => {
    // An owner who typed the address a minute ago must not be offered the same device again
    // while the hub is still waiting to hear from it.
    const taken = takenFrom([
      { kind: 'shelly/plug', transportConfig: { host: '192.168.1.41' }, externalId: null },
    ]);

    expect(taken.externalIds.size).toBe(0);
    expect(taken.hosts.has('shelly\n192.168.1.41')).toBe(true);
  });

  it('ignores a configuration with no host to compare, as a broker-reached device has', () => {
    const taken = takenFrom([
      {
        kind: 'bambu-lab/printer',
        transportConfig: { url: 'mqtts://192.168.1.60:8883' },
        externalId: '01P00A',
      },
    ]);

    expect([...taken.hosts]).toEqual([]);
    expect([...taken.externalIds]).toEqual(['bambu-lab\n01P00A']);
  });
});
