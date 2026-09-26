import { describe, expect, it } from 'vitest';

import { addressOf, takenFrom } from './taken.js';

describe('takenFrom', () => {
  it("keys every instance's address and device by its vendor", () => {
    const taken = takenFrom([
      {
        id: 'relay-1',
        kind: 'shelly/switch-pm',
        transportConfig: { host: '192.168.1.40' },
        externalId: 'abc',
      },
      {
        id: 'plug-1',
        kind: 'sonoff/diy-plug',
        transportConfig: { host: '192.168.1.50:8081' },
        externalId: null,
      },
    ]);

    expect([...taken.externalIds]).toEqual(['shelly\nabc']);
    expect([...taken.hosts]).toEqual(['shelly\n192.168.1.40', 'sonoff\n192.168.1.50:8081']);
    expect(taken.locations.get('shelly\nabc')).toEqual({
      instanceId: 'relay-1',
      host: '192.168.1.40',
    });
  });

  it('counts an instance that has not been identified yet by its address alone', () => {
    // An owner who typed the address a minute ago must not be offered the same device again
    // while the hub is still waiting to hear from it.
    const taken = takenFrom([
      {
        id: 'plug-2',
        kind: 'shelly/plug',
        transportConfig: { host: '192.168.1.41' },
        externalId: null,
      },
    ]);

    expect(taken.externalIds.size).toBe(0);
    expect(taken.locations.size).toBe(0);
    expect(taken.hosts.has('shelly\n192.168.1.41')).toBe(true);
  });

  it('reads the address of a device reached through a URL, as a printer on its broker is', () => {
    const taken = takenFrom([
      {
        id: 'printer-1',
        kind: 'bambu-lab/printer',
        transportConfig: { url: 'mqtts://192.168.1.60:8883' },
        externalId: '01P00A',
      },
    ]);

    expect([...taken.hosts]).toEqual(['bambu-lab\n192.168.1.60']);
    expect([...taken.externalIds]).toEqual(['bambu-lab\n01P00A']);
  });
});

describe('addressOf', () => {
  it('reads the host, then the host of a URL, and nothing from anything else', () => {
    expect(addressOf({ host: '192.168.1.40:8081' })).toBe('192.168.1.40:8081');
    expect(addressOf({ url: 'mqtts://printer.local:8883' })).toBe('printer.local');
    expect(addressOf({ url: 'not a url' })).toBeUndefined();
    expect(addressOf({ broker: 'x' })).toBeUndefined();
  });
});
