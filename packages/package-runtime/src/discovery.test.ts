import { describe, expect, it } from 'vitest';

import {
  associateModel,
  identifySighting,
  matchesAnnouncement,
  resolveDiscovery,
  vendorDiscoverySchema,
  type DiscoveryDriver,
} from './discovery.js';

/**
 * Shelly's discovery: an mDNS service, a probe, and where the probe's answer says who it is.
 *
 * @returns The file, as it would be read from `discovery.json`.
 */
function shellyDiscovery(): Record<string, unknown> {
  return {
    listen: [{ mdns: '_shelly._tcp' }],
    probe: { transport: 'shelly/rpc', op: 'call', args: { method: 'Shelly.GetDeviceInfo' } },
    identity: { externalId: 'id', name: 'name', model: 'model', swVersion: 'ver' },
  };
}

/**
 * Two drivers of one vendor, each with the codes of its models.
 *
 * @returns The drivers, as the loader hands them over.
 */
function shellyDrivers(): DiscoveryDriver[] {
  return [
    {
      id: 'switch-pm',
      name: 'Relay with power metering',
      models: ['1PM Gen3', '1PM Mini Gen3'],
      modelCodes: { 'S3SW-001P16EU': '1PM Gen3', 'S3SW-001P8EU': '1PM Mini Gen3' },
    },
    {
      id: 'plug',
      name: 'Plug',
      models: ['Plug S Gen3'],
      modelCodes: { 'S3PL-00112EU': 'Plug S Gen3' },
    },
  ];
}

describe('vendorDiscoverySchema', () => {
  it('reads an mDNS service, a probe and where the answer says who the device is', () => {
    const parsed = vendorDiscoverySchema.parse(shellyDiscovery());

    expect(parsed.listen).toEqual([{ mdns: '_shelly._tcp' }]);
    expect(parsed.probe?.transport).toBe('shelly/rpc');
    expect(parsed.match).toEqual([]);
  });

  it('lets a vendor listen with a module of its own, for a protocol the platform does not speak', () => {
    const parsed = vendorDiscoverySchema.parse({
      listen: [{ module: './lan/discovery.js' }],
      identity: { externalId: 'device', model: 'sku' },
    });

    // On the house's network unless it says otherwise: most listeners hear multicast.
    expect(parsed.listen).toEqual([{ module: './lan/discovery.js', lan: true }]);
  });

  it('holds an mDNS service to the underscored form the protocol uses', () => {
    const withService = (mdns: string): boolean =>
      vendorDiscoverySchema.safeParse({ ...shellyDiscovery(), listen: [{ mdns }] }).success;

    expect(withService('_ewelink._tcp')).toBe(true);
    expect(withService('_hue._udp')).toBe(true);
    expect(withService('shelly')).toBe(false);
    expect(withService('_shelly._tcp.local')).toBe(false);
  });

  it('refuses a source it does not know, so a future one fails where it is written', () => {
    expect(
      vendorDiscoverySchema.safeParse({ ...shellyDiscovery(), listen: [{ ssdp: 'urn:x' }] })
        .success,
    ).toBe(false);
    expect(vendorDiscoverySchema.safeParse({ ...shellyDiscovery(), listen: [] }).success).toBe(
      false,
    );
  });

  it('requires the model from a vendor that does not probe', () => {
    // Without a probe there is no answer for the drivers' own claims to read, so the model code
    // is the only way to the driver.
    expect(
      vendorDiscoverySchema.safeParse({
        listen: [{ mdns: '_nanoleafapi._tcp' }],
        identity: { name: 'instance' },
      }).success,
    ).toBe(false);
    expect(
      vendorDiscoverySchema.safeParse({
        listen: [{ mdns: '_nanoleafapi._tcp' }],
        identity: { model: 'txt.md', name: 'instance' },
      }).success,
    ).toBe(true);
  });

  it('holds every expression to a path', () => {
    expect(
      vendorDiscoverySchema.safeParse({
        ...shellyDiscovery(),
        identity: { model: 'model.toUpperCase()' },
      }).success,
    ).toBe(false);
  });
});

describe('resolveDiscovery', () => {
  it("refuses a probe over another vendor's transport", () => {
    // The same rule a driver is held to: vendors load in no particular order.
    expect(() =>
      resolveDiscovery(
        'shelly',
        vendorDiscoverySchema.parse({
          ...shellyDiscovery(),
          probe: { transport: 'tasmota/raw', op: 'get' },
        }),
        shellyDrivers(),
      ),
    ).toThrow(/tasmota\/raw/);
  });

  it('refuses pairing through a driver the vendor does not have', () => {
    expect(() =>
      resolveDiscovery(
        'shelly',
        vendorDiscoverySchema.parse({
          ...shellyDiscovery(),
          adopt: 'automatic',
          pairing: { driver: 'bridge', entity: 'permit_join' },
        }),
        shellyDrivers(),
      ),
    ).toThrow(/bridge/);
  });

  it('proposes to the owner unless the vendor says its devices are added on their own', () => {
    expect(vendorDiscoverySchema.parse(shellyDiscovery()).adopt).toBe('owner');
    expect(vendorDiscoverySchema.parse({ ...shellyDiscovery(), adopt: 'automatic' }).adopt).toBe(
      'automatic',
    );
  });

  it('refuses one code mapped by two drivers of a vendor that does not probe, naming both', () => {
    // Without a probe nothing but the code can tell the two apart, and which driver a device
    // belonged to would be a matter of load order.
    const drivers = shellyDrivers();
    const [first] = drivers;

    if (first === undefined) {
      throw new Error('fixture');
    }

    const clash = [...drivers, { ...first, id: 'switch-pm-copy' }];

    expect(() =>
      resolveDiscovery(
        'shelly',
        vendorDiscoverySchema.parse({
          listen: [{ mdns: '_shelly._tcp' }],
          identity: { model: 'txt.model' },
        }),
        clash,
      ),
    ).toThrow(/switch-pm.*switch-pm-copy|switch-pm-copy.*switch-pm/);
  });

  it('lets two drivers share a code when the vendor probes, for their claims to tell apart', () => {
    // A Shelly 2PM reports the same code as relays or as a cover; its profile says which.
    const plan = resolveDiscovery('shelly', vendorDiscoverySchema.parse(shellyDiscovery()), [
      {
        id: 'cover-pm',
        name: 'Cover',
        models: ['2PM Gen3 (cover)'],
        modelCodes: { 'S3SW-002P16EU': '2PM Gen3 (cover)' },
      },
      {
        id: 'switch-2pm',
        name: 'Relays',
        models: ['2PM Gen3 (relays)'],
        modelCodes: { 'S3SW-002P16EU': '2PM Gen3 (relays)' },
      },
    ]);

    expect(associateModel(plan, 'S3SW-002P16EU', (driverId) => driverId === 'switch-2pm')).toEqual({
      driverId: 'switch-2pm',
      model: '2PM Gen3 (relays)',
      modelChoices: ['2PM Gen3 (relays)'],
    });
    expect(associateModel(plan, 'S3SW-002P16EU', () => false)).toBeNull();
  });

  it('accepts a probe over a platform transport', () => {
    const plan = resolveDiscovery(
      'sonoff',
      vendorDiscoverySchema.parse({
        listen: [{ mdns: '_ewelink._tcp' }],
        probe: { transport: 'http', op: 'post', args: { path: '/zeroconf/info' } },
        identity: { externalId: 'data.deviceid', model: 'type' },
      }),
      [],
    );

    expect(plan.vendorId).toBe('sonoff');
  });
});

describe('matchesAnnouncement', () => {
  it('lets through what every condition holds for, and nothing else', () => {
    const plan = resolveDiscovery(
      'sonoff',
      vendorDiscoverySchema.parse({
        listen: [{ mdns: '_ewelink._tcp' }],
        match: [{ path: 'txt.type', exists: true }],
        identity: { externalId: 'txt.id', model: 'txt.type' },
      }),
      [],
    );

    expect(matchesAnnouncement(plan, { txt: { type: 'diy_plug' } })).toBe(true);
    expect(matchesAnnouncement(plan, { txt: { id: '1000abcd' } })).toBe(false);
  });

  it('lets everything through when the vendor asks for nothing', () => {
    const plan = resolveDiscovery(
      'shelly',
      vendorDiscoverySchema.parse(shellyDiscovery()),
      shellyDrivers(),
    );

    expect(matchesAnnouncement(plan, {})).toBe(true);
  });
});

describe('identifySighting', () => {
  it('reads who the device is from where the vendor says', () => {
    const plan = resolveDiscovery(
      'shelly',
      vendorDiscoverySchema.parse(shellyDiscovery()),
      shellyDrivers(),
    );

    expect(
      identifySighting(plan, {
        id: 'shelly1pmg3-abc',
        name: 'Kitchen',
        model: 'S3SW-001P16EU',
        ver: '1.4.2',
      }),
    ).toEqual({
      externalId: 'shelly1pmg3-abc',
      name: 'Kitchen',
      modelCode: 'S3SW-001P16EU',
      swVersion: '1.4.2',
    });
  });

  it('leaves out what the device did not say, and turns a number into text', () => {
    const plan = resolveDiscovery(
      'shelly',
      vendorDiscoverySchema.parse(shellyDiscovery()),
      shellyDrivers(),
    );

    expect(identifySighting(plan, { id: 4412, model: 'S3SW-001P16EU', name: null })).toEqual({
      externalId: '4412',
      name: null,
      modelCode: 'S3SW-001P16EU',
      swVersion: null,
    });
  });

  it('reads the first of several paths that names a value', () => {
    // Shelly's generations answer GET /shelly in two vocabularies.
    const plan = resolveDiscovery(
      'shelly',
      vendorDiscoverySchema.parse({
        ...shellyDiscovery(),
        identity: { externalId: ['id', 'mac'], model: ['model', 'type'], swVersion: ['ver', 'fw'] },
      }),
      shellyDrivers(),
    );

    expect(
      identifySighting(plan, { type: 'SHSW-25', mac: 'A4CF12F45CC4', fw: '20230913-112003' }),
    ).toEqual({
      externalId: 'A4CF12F45CC4',
      name: null,
      modelCode: 'SHSW-25',
      swVersion: '20230913-112003',
    });
    expect(
      identifySighting(plan, { id: 'shellyplus1-a8', mac: 'A8', model: 'SNSW-001X16EU' }),
    ).toEqual({
      externalId: 'shellyplus1-a8',
      name: null,
      modelCode: 'SNSW-001X16EU',
      swVersion: null,
    });
  });
});

describe('associateModel', () => {
  const plan = resolveDiscovery(
    'shelly',
    vendorDiscoverySchema.parse(shellyDiscovery()),
    shellyDrivers(),
  );

  it('finds the driver and the model from the code the hardware reports', () => {
    expect(associateModel(plan, 'S3SW-001P8EU')).toEqual({
      driverId: 'switch-pm',
      model: '1PM Mini Gen3',
      modelChoices: ['1PM Mini Gen3'],
    });
  });

  it("lets the driver's claim refuse a code only it maps, when there was a probe", () => {
    // A Pro 3EM reports the same code in its monophase profile, which the triphase driver's claim
    // refuses: proposing it would only fail at identification.
    expect(associateModel(plan, 'S3SW-001P8EU', () => false)).toBeNull();
    expect(associateModel(plan, 'S3SW-001P8EU', (driverId) => driverId === 'switch-pm')).toEqual({
      driverId: 'switch-pm',
      model: '1PM Mini Gen3',
      modelChoices: ['1PM Mini Gen3'],
    });
  });

  it('is certain of the driver and offers the family when the code names several models', () => {
    const sonoff = resolveDiscovery(
      'sonoff',
      vendorDiscoverySchema.parse({
        listen: [{ mdns: '_ewelink._tcp' }],
        identity: { externalId: 'txt.id', model: 'txt.type' },
      }),
      [
        {
          id: 'diy-plug',
          name: 'DIY plug',
          models: ['BASICR3', 'MINI'],
          modelCodes: { diy_plug: ['BASICR3', 'MINI'] },
        },
      ],
    );

    expect(associateModel(sonoff, 'diy_plug')).toEqual({
      driverId: 'diy-plug',
      model: null,
      modelChoices: ['BASICR3', 'MINI'],
    });
  });

  it("falls back on the drivers' own claims, in order, when no driver knows the code", () => {
    const claimedBy = (driverId: string): boolean => driverId === 'plug';

    expect(associateModel(plan, 'S3PL-UNKNOWN', claimedBy)).toEqual({
      driverId: 'plug',
      model: 'Plug S Gen3',
      modelChoices: ['Plug S Gen3'],
    });
  });

  it('takes the model the code spells out when a claimed driver lists it by that name', () => {
    const drivers: DiscoveryDriver[] = [{ id: 'printer', name: 'Printer', models: ['X1C', 'P1S'] }];
    const bambu = resolveDiscovery(
      'bambu-lab',
      vendorDiscoverySchema.parse({
        ...shellyDiscovery(),
        probe: { transport: 'mqtt', op: 'get' },
      }),
      drivers,
    );

    expect(associateModel(bambu, 'P1S', () => true)).toEqual({
      driverId: 'printer',
      model: 'P1S',
      modelChoices: ['X1C', 'P1S'],
    });
    expect(associateModel(bambu, 'A9', () => true)).toEqual({
      driverId: 'printer',
      model: null,
      modelChoices: ['X1C', 'P1S'],
    });
  });

  it("offers a driver that lists no model under the driver's own name", () => {
    const plex = resolveDiscovery(
      'plex',
      vendorDiscoverySchema.parse({
        ...shellyDiscovery(),
        probe: { transport: 'http', op: 'get' },
      }),
      [{ id: 'server', name: 'Media Server', models: [] }],
    );

    expect(associateModel(plex, null, () => true)).toEqual({
      driverId: 'server',
      model: 'Media Server',
      modelChoices: ['Media Server'],
    });
  });

  it('finds nothing for a device no driver of the vendor takes', () => {
    expect(associateModel(plan, 'S9XX-000')).toBeNull();
    expect(associateModel(plan, null, () => false)).toBeNull();
  });
});
