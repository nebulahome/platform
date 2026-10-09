import { describe, expect, it } from 'vitest';

import { parseEntityId, type CapabilityState, type EntityId } from '@nebulahome/contracts';

import { bundleManifestSchema } from './bundle.js';
import { createDeclarativeIntegration } from './declarative.js';
import type { Claim, MappingContext } from './integration.js';
import { integrationProfileSchema } from './profile.js';

const RELAY = parseEntityId('switch.lab_relay');

/**
 * The manifest of a declarative bundle for a generic REST relay.
 *
 * @returns The parsed manifest.
 */
function manifest(): ReturnType<typeof bundleManifestSchema.parse> {
  return bundleManifestSchema.parse({
    id: 'generic/rest-relay',
    version: '1.0.0',
    sdk: '^1.0.0',
    name: 'Generic REST relay',
    vendor: { id: 'generic', name: 'Generic' },
    transport: 'http',
    kind: 'declarative',
    profile: './profile.json',
    setup: './setup.json',
  });
}

/** The profile of that bundle, as `profile.json` holds it: one relay, polled, switchable. */
const PROFILE_JSON = {
  discovery: {
    scan: { mdns: '_http._tcp' },
    probe: { op: 'get', args: { path: '/status' } },
    claim: [{ path: 'relay', exists: true }],
    identity: { externalId: 'device.id', name: 'device.name', model: 'device.model' },
  },
  subscriptions: [{ op: 'poll', args: { path: '/status', everyMs: 5000 } }],
  entities: [
    {
      domain: 'switch',
      capabilities: { on_off: {}, level: {} },
      state: { on_off: { isOn: 'relay.on' }, level: { level: 'relay.brightness' } },
      commands: {
        'on_off.turn_on': { op: 'get', args: { path: '/relay/on' } },
        'level.set_level': {
          op: 'get',
          args: { path: '/relay/dim', query: { v: { $: 'command.level' } } },
        },
      },
    },
  ],
};

/**
 * The profile of that bundle: one relay, polled, switchable.
 *
 * @returns The parsed profile.
 */
function profile(): ReturnType<typeof integrationProfileSchema.parse> {
  return integrationProfileSchema.parse(PROFILE_JSON);
}

/** What a probe returned for a relay that is on. */
const DESCRIPTOR = { device: { id: 'relay-aabbcc', name: 'Lab relay', model: 'R1' }, relay: {} };

/**
 * A claim as the integration would have produced it.
 *
 * @returns The claim.
 */
function claim(): Claim {
  return { deviceKey: '192.168.1.40', externalId: 'relay-aabbcc', descriptor: DESCRIPTOR };
}

/**
 * A mapping context holding one entity and an optional last state.
 *
 * @param lastState - What the entity last reported, if anything.
 * @returns The context.
 */
function context(lastState?: CapabilityState): MappingContext {
  return {
    options: {},
    claim: claim(),
    entities: new Map<string, EntityId>([['', RELAY]]),
    lastState: (): CapabilityState | undefined => lastState,
  };
}

/**
 * The integration under test.
 *
 * @returns A declarative integration built from the fixture bundle.
 */
function integration(): ReturnType<typeof createDeclarativeIntegration> {
  return createDeclarativeIntegration(manifest(), profile());
}

describe('claim', () => {
  it('claims a device that satisfies every condition', () => {
    const claimed = integration().claim({ deviceKey: '192.168.1.40', payload: DESCRIPTOR }, {});

    expect(claimed?.externalId).toBe('relay-aabbcc');
  });

  it('leaves a device alone when a condition does not hold', () => {
    const payload = { device: { id: 'x' } };

    expect(integration().claim({ deviceKey: '192.168.1.41', payload }, {})).toBeNull();
  });

  it('leaves a device alone when it cannot be identified', () => {
    // Without an external id there is nothing to make this the same device next time, so
    // adopting it would create a new row on every scan.
    const payload = { relay: {}, device: {} };

    expect(integration().claim({ deviceKey: '192.168.1.42', payload }, {})).toBeNull();
  });

  it('claims a device whose model is one of several', () => {
    // A family: one profile, a list of the models it drives. The list is membership, so a
    // model outside it is left alone the way a failed `equals` leaves it alone.
    const family = createDeclarativeIntegration(
      manifest(),
      integrationProfileSchema.parse({
        ...PROFILE_JSON,
        discovery: {
          ...PROFILE_JSON.discovery,
          claim: [{ path: 'device.model', oneOf: ['R1', 'R2'] }],
        },
      }),
    );
    const other = { ...DESCRIPTOR, device: { ...DESCRIPTOR.device, model: 'R3' } };

    expect(family.claim({ deviceKey: 'x', payload: DESCRIPTOR }, {})?.externalId).toBe(
      'relay-aabbcc',
    );
    expect(family.claim({ deviceKey: 'x', payload: other }, {})).toBeNull();
  });
});

describe('describe', () => {
  it('reads the device identity out of what the probe returned', () => {
    const described = integration().describe(claim(), {});

    expect([described.externalId, described.name, described.model]).toEqual([
      'relay-aabbcc',
      'Lab relay',
      'R1',
    ]);
  });

  it('falls back to the identifier when the device reports no name', () => {
    const bare = { ...claim(), descriptor: { device: { id: 'relay-aabbcc' }, relay: {} } };

    expect(integration().describe(bare, {}).name).toBe('relay-aabbcc');
  });

  it('exposes the entities the profile declares', () => {
    const [entity] = integration().describe(claim(), {}).entities;

    expect([entity?.domain, Object.keys(entity?.capabilities ?? {})]).toEqual([
      'switch',
      ['on_off', 'level'],
    ]);
  });

  it('carries the icon an entity was given, and no key at all otherwise', () => {
    const [bare] = integration().describe(claim(), {}).entities;
    const withIcon = profile();
    const [declared] = withIcon.entities;
    const iconed = createDeclarativeIntegration(manifest(), {
      ...withIcon,
      entities: declared === undefined ? [] : [{ ...declared, icon: 'relay' }],
    });
    const [entity] = iconed.describe(claim(), {}).entities;

    expect(entity?.icon).toBe('relay');
    expect(bare !== undefined && 'icon' in bare).toBe(false);
  });
});

describe('subscriptions', () => {
  it('names the device each subscription is for', () => {
    // A polling transport has to know what to poll. The profile does not write it, because a
    // profile describes a kind of device rather than one device.
    const [subscription] = integration().subscriptions([claim()], {});

    expect(subscription?.args).toMatchObject({ deviceKey: '192.168.1.40', path: '/status' });
  });

  it('renders one per device', () => {
    const other = { ...claim(), deviceKey: '192.168.1.41', externalId: 'relay-ddeeff' };

    expect(integration().subscriptions([claim(), other], {})).toHaveLength(2);
  });

  it('collapses two devices that ask for exactly the same thing', () => {
    // Two instances watching one MQTT topic filter must not make the transport subscribe twice.
    expect(integration().subscriptions([claim(), claim()], {})).toHaveLength(1);
  });

  it('reads as often as the owner chose, in place of the profile', () => {
    const [subscription] = integration().subscriptions([claim()], { pollInterval: 30 });

    expect(subscription?.args).toMatchObject({ path: '/status', everyMs: 30_000 });
  });

  it('keeps the profile interval when the owner chose none', () => {
    const [subscription] = integration().subscriptions([claim()], {});

    expect(subscription?.args).toMatchObject({ everyMs: 5000 });
  });
});

describe('toState', () => {
  it('maps a payload onto the canonical model', () => {
    const message = {
      connectionKey: 'http:192.168.1.40',
      deviceKey: '192.168.1.40',
      payload: { relay: { on: true, brightness: 40 } },
    };

    const [report] = integration().toState(message, context());

    expect([report?.entityId, report?.state]).toEqual([
      RELAY,
      { on_off: { isOn: true }, level: { level: 40 } },
    ]);
  });

  it('leaves out a field the device did not report', () => {
    // Reports are partial by capability: a device that sent only its on/off state has not said
    // anything about brightness, and inventing a value would be worse than saying nothing.
    const message = {
      connectionKey: 'http:192.168.1.40',
      deviceKey: '192.168.1.40',
      payload: { relay: { on: true } },
    };

    expect(integration().toState(message, context())[0]?.state).toEqual({ on_off: { isOn: true } });
  });

  it('says nothing at all about an entity the payload does not mention', () => {
    const message = {
      connectionKey: 'http:192.168.1.40',
      deviceKey: '192.168.1.40',
      payload: { unrelated: true },
    };

    expect(integration().toState(message, context())).toEqual([]);
  });

  it('drops a value whose type the capability does not accept', () => {
    // Firmware lies. A relay reporting `on` as the string "yes" must not put a malformed state
    // into the registry, and must not stop the rest of the payload being read either.
    const message = {
      connectionKey: 'http:192.168.1.40',
      deviceKey: '192.168.1.40',
      payload: { relay: { on: 'yes', brightness: 40 } },
    };

    expect(integration().toState(message, context())[0]?.state).toEqual({ level: { level: 40 } });
  });

  it('looks a value up in a table, falling back to the default and keeping absence', () => {
    const cover = parseEntityId('cover.lab_cover');
    const shutter = createDeclarativeIntegration(
      manifest(),
      integrationProfileSchema.parse({
        ...PROFILE_JSON,
        entities: [
          {
            domain: 'cover',
            capabilities: { cover: {} },
            state: {
              cover: {
                position: 'cover.pos',
                motion: { path: 'cover.state', map: { opening: 'opening' }, default: 'stopped' },
              },
            },
          },
        ],
      }),
    );
    const mapping = { ...context(), entities: new Map<string, EntityId>([['', cover]]) };
    const read = (payload: unknown): CapabilityState | undefined =>
      shutter.toState({ connectionKey: 'c', deviceKey: 'd', payload }, mapping)[0]?.state;

    expect(read({ cover: { pos: 40, state: 'opening' } })).toEqual({
      cover: { position: 40, motion: 'opening' },
    });
    expect(read({ cover: { pos: 40, state: 'closed' } })).toEqual({
      cover: { position: 40, motion: 'stopped' },
    });
    // No `state` at all: the table says nothing, so the cover says nothing.
    expect(read({ cover: { pos: 40 } })).toBeUndefined();
  });
});

describe('toState with attributes', () => {
  /**
   * A pairing sensor that reads whether pairing is open, and when it closes as an attribute.
   *
   * @returns The integration and the context naming its one entity.
   */
  function pairing(): {
    integration: ReturnType<typeof createDeclarativeIntegration>;
    mapping: MappingContext;
  } {
    const sensor = parseEntityId('sensor.bridge_pairing');

    return {
      integration: createDeclarativeIntegration(
        manifest(),
        integrationProfileSchema.parse({
          ...PROFILE_JSON,
          entities: [
            {
              domain: 'sensor',
              capabilities: { sensor_text: {} },
              state: { sensor_text: { value: 'pairing.state' } },
              attributes: { endsAt: 'pairing.endsAt' },
            },
          ],
        }),
      ),
      mapping: { ...context(), entities: new Map<string, EntityId>([['', sensor]]) },
    };
  }

  it('reports what the attributes read beside the state', () => {
    const { integration: bridge, mapping } = pairing();
    const [report] = bridge.toState(
      {
        connectionKey: 'c',
        deviceKey: 'd',
        payload: { pairing: { state: 'enabled', endsAt: '2026-09-30T20:04:14.000Z' } },
      },
      mapping,
    );

    expect(report?.state).toEqual({ sensor_text: { value: 'enabled' } });
    expect(report?.attributes).toEqual({ endsAt: '2026-09-30T20:04:14.000Z' });
  });

  it('leaves out an attribute no longer said, so it is gone rather than stale', () => {
    const { integration: bridge, mapping } = pairing();
    const [report] = bridge.toState(
      { connectionKey: 'c', deviceKey: 'd', payload: { pairing: { state: 'disabled' } } },
      mapping,
    );

    expect(report?.attributes).toEqual({});
  });

  it('names an attribute in camelCase, as a state field is named', () => {
    expect(
      integrationProfileSchema.safeParse({
        ...PROFILE_JSON,
        entities: [
          {
            domain: 'sensor',
            capabilities: { sensor_text: {} },
            state: { sensor_text: { value: 'pairing.state' } },
            attributes: { 'ends-at': 'pairing.endsAt' },
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('toState for firmware', () => {
  /**
   * An integration exposing a firmware sensor and an install button.
   *
   * @returns The integration and a reader of what each entity reports for a payload.
   */
  function firmware(): {
    read: (payload: unknown) => Map<string, CapabilityState>;
  } {
    const sensor = parseEntityId('binary_sensor.lab_firmware');
    const button = parseEntityId('button.lab_firmware_install');
    const built = createDeclarativeIntegration(
      manifest(),
      integrationProfileSchema.parse({
        ...PROFILE_JSON,
        entities: [
          {
            domain: 'binary_sensor',
            objectId: 'firmware',
            capabilities: { sensor_binary: {} },
            state: {
              sensor_binary: { isOn: { path: 'sys.available_updates.stable', present: true } },
            },
            deviceClass: 'update',
          },
          {
            domain: 'button',
            objectId: 'firmware_install',
            capabilities: { button: {} },
            state: {},
            commands: {
              'button.press': { op: 'call', args: { method: 'Shelly.Update' } },
            },
          },
        ],
      }),
    );
    const mapping = {
      ...context(),
      entities: new Map<string, EntityId>([
        ['firmware', sensor],
        ['firmware_install', button],
      ]),
    };

    return {
      read: (payload) =>
        new Map(
          built
            .toState({ connectionKey: 'c', deviceKey: 'd', payload }, mapping)
            .map((report) => [report.entityId, report.state]),
        ),
    };
  }

  it('says an update is offered, then that it no longer is', () => {
    const { read } = firmware();

    expect(
      read({ sys: { available_updates: { stable: { version: '1.5.0' } } } }).get(
        'binary_sensor.lab_firmware',
      ),
    ).toEqual({ sensor_binary: { isOn: true } });
    expect(read({ sys: { available_updates: {} } }).get('binary_sensor.lab_firmware')).toEqual({
      sensor_binary: { isOn: false },
    });
  });

  it('says nothing about firmware in a report that does not carry it', () => {
    const { read } = firmware();

    expect(read({ relay: { on: true } }).has('binary_sensor.lab_firmware')).toBe(false);
  });

  it('reports the button on anything the device says, so it is available with the device', () => {
    const { read } = firmware();

    expect(read({ relay: { on: true } }).get('button.lab_firmware_install')).toEqual({
      button: {},
    });
  });
});

describe('toCommand', () => {
  it('turns a command into the request the profile describes', () => {
    const request = integration().toCommand(
      { entityId: RELAY, capability: 'on_off', command: { command: 'turn_on' } },
      context(),
    );

    expect(request).toEqual({
      deviceKey: '192.168.1.40',
      op: 'get',
      args: { path: '/relay/on' },
    });
  });

  it('carries a value out of the command into the request', () => {
    const request = integration().toCommand(
      { entityId: RELAY, capability: 'level', command: { command: 'set_level', level: 70 } },
      context(),
    );

    expect(request.args).toEqual({ path: '/relay/dim', query: { v: 70 } });
  });

  it("converts a fade into the device's units, and leaves it out when there is none", () => {
    const dimmer = createDeclarativeIntegration(
      manifest(),
      integrationProfileSchema.parse({
        ...PROFILE_JSON,
        entities: [
          {
            ...PROFILE_JSON.entities[0],
            commands: {
              'level.set_level': {
                op: 'call',
                args: {
                  method: 'Light.Set',
                  params: {
                    brightness: { $: 'command.level' },
                    transition_duration: {
                      $: 'command.transitionMs',
                      scale: 0.001,
                      decimals: 1,
                      max: 10,
                      optional: true,
                    },
                  },
                  steps: [{ $: 'command.level' }, { $: 'command.nothing', optional: true }],
                },
              },
            },
          },
        ],
      }),
    );
    /**
     * The request for a level, with or without a fade.
     *
     * @param transitionMs - The fade, if any.
     * @returns The request's arguments.
     */
    const argsFor = (transitionMs?: number) =>
      dimmer.toCommand(
        {
          entityId: RELAY,
          capability: 'level',
          command: {
            command: 'set_level',
            level: 40,
            ...(transitionMs === undefined ? {} : { transitionMs }),
          },
        },
        context(),
      ).args;

    expect(argsFor(2_345)).toEqual({
      method: 'Light.Set',
      params: { brightness: 40, transition_duration: 2.3 },
      steps: [40],
    });
    // Clamped to what the device takes.
    expect(argsFor(60_000)).toMatchObject({ params: { transition_duration: 10 } });
    // No fade asked for: the key is not there at all, rather than null.
    expect(argsFor()).toEqual({
      method: 'Light.Set',
      params: { brightness: 40 },
      steps: [40],
    });
  });

  it('refuses a command the profile does not describe', () => {
    // Better than sending a request built from nothing: `core` turns the failure into an error
    // the caller sees, rather than an acknowledgement for something that never happened.
    expect(() =>
      integration().toCommand(
        { entityId: RELAY, capability: 'on_off', command: { command: 'toggle' } },
        context(),
      ),
    ).toThrow(/toggle/);
  });

  it('refuses a command for an entity this device does not have', () => {
    const other = parseEntityId('switch.somewhere_else');

    expect(() =>
      integration().toCommand(
        { entityId: other, capability: 'on_off', command: { command: 'turn_on' } },
        context(),
      ),
    ).toThrow(/somewhere_else/);
  });
});

describe('toState for packed and moved readings', () => {
  /**
   * An integration reading a nozzle whose current and target temperatures share one number, a
   * bed whose firmware moved its reading, and a door that is one bit of a flags word.
   *
   * @returns A reader of what each entity reports for a payload.
   */
  function printer(): (payload: unknown) => Map<string, CapabilityState> {
    const numeric = (value: unknown) => ({
      domain: 'sensor',
      capabilities: { sensor_numeric: {} },
      state: { sensor_numeric: { value } },
    });
    const built = createDeclarativeIntegration(
      manifest(),
      integrationProfileSchema.parse({
        ...PROFILE_JSON,
        entities: [
          { ...numeric({ path: 'extruder[0].temp', bits: [0, 16] }), objectId: 'nozzle' },
          { ...numeric({ path: 'extruder[0].temp', bits: [16, 16] }), objectId: 'target' },
          {
            ...numeric([{ path: 'device.bed.temp', bits: [0, 16] }, 'bed_temper']),
            objectId: 'bed',
          },
          { ...numeric({ path: 'ams.humidity_raw', base: 10 }), objectId: 'humidity' },
          {
            domain: 'binary_sensor',
            objectId: 'door',
            capabilities: { sensor_binary: {} },
            state: {
              sensor_binary: {
                isOn: [
                  { path: 'stat', bits: [23, 1], base: 16, equals: 1 },
                  { path: 'home_flag', bits: [23, 1], equals: 1 },
                ],
              },
            },
          },
        ],
      }),
    );
    const mapping = {
      ...context(),
      entities: new Map<string, EntityId>(
        ['nozzle', 'target', 'bed', 'humidity', 'door'].map((key) => [
          key,
          parseEntityId(`${key === 'door' ? 'binary_sensor' : 'sensor'}.lab_${key}`),
        ]),
      ),
    };

    return (payload) =>
      new Map(
        built
          .toState({ connectionKey: 'c', deviceKey: 'd', payload }, mapping)
          .map((report) => [report.entityId, report.state]),
      );
  }

  it('reads two temperatures out of one number', () => {
    // 220 << 16 | 218: heading for 220, at 218 now.
    const read = printer()({ extruder: [{ id: 0, temp: 14_418_138 }] });

    expect(read.get('sensor.lab_nozzle')).toEqual({ sensor_numeric: { value: 218 } });
    expect(read.get('sensor.lab_target')).toEqual({ sensor_numeric: { value: 220 } });
  });

  it('reads a reading wherever the firmware put it, the first place first', () => {
    const read = printer();

    expect(read({ device: { bed: { temp: (65 << 16) | 63 } } }).get('sensor.lab_bed')).toEqual({
      sensor_numeric: { value: 63 },
    });
    expect(read({ bed_temper: 24.5 }).get('sensor.lab_bed')).toEqual({
      sensor_numeric: { value: 24.5 },
    });
    expect(read({ relay: { on: true } }).has('sensor.lab_bed')).toBe(false);
  });

  it('reads one bit of a flags word, as a number or as hexadecimal text', () => {
    const read = printer();

    expect(read({ stat: '46A58008' }).get('binary_sensor.lab_door')).toEqual({
      sensor_binary: { isOn: true },
    });
    expect(read({ stat: '46258008' }).get('binary_sensor.lab_door')).toEqual({
      sensor_binary: { isOn: false },
    });
    // Negative: the word's top bit is set, and the reading must not care.
    expect(read({ home_flag: -1_058_546_177 }).get('binary_sensor.lab_door')).toEqual({
      sensor_binary: { isOn: true },
    });
    expect(read({ home_flag: -1_066_934_785 }).get('binary_sensor.lab_door')).toEqual({
      sensor_binary: { isOn: false },
    });
  });

  it('reads a number written as text, and nothing from text that is none', () => {
    const read = printer();

    expect(read({ ams: { humidity_raw: '18' } }).get('sensor.lab_humidity')).toEqual({
      sensor_numeric: { value: 18 },
    });
    expect(read({ ams: { humidity_raw: 'n/a' } }).has('sensor.lab_humidity')).toBe(false);
  });

  it('refuses bits that do not fit in 32', () => {
    expect(
      integrationProfileSchema.safeParse({
        ...PROFILE_JSON,
        entities: [
          {
            domain: 'sensor',
            capabilities: { sensor_numeric: {} },
            state: { sensor_numeric: { value: { path: 'temp', bits: [24, 16] } } },
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('an image entity', () => {
  const MAP = parseEntityId('image.lab_robot_map');
  const imaging = createDeclarativeIntegration(
    manifest(),
    integrationProfileSchema.parse({
      ...PROFILE_JSON,
      entities: [
        {
          domain: 'image',
          objectId: 'map',
          capabilities: { image: {} },
          state: {},
          image: { path: 'map.svg', contentType: 'image/svg+xml', minIntervalMs: 5000 },
        },
      ],
    }),
  );
  const mapping: MappingContext = {
    ...context(),
    entities: new Map<string, EntityId>([['map', MAP]]),
  };

  it('reports which picture it is, and hands the picture over beside the state', () => {
    const [report] = imaging.toState(
      { connectionKey: 'k', deviceKey: '192.168.1.40', payload: { map: { svg: '<svg/>' } } },
      mapping,
    );

    expect(report?.state.image?.contentType).toBe('image/svg+xml');
    expect(report?.state.image?.revision).toMatch(/^[0-9a-f]{16}$/u);
    expect(report?.blob).toEqual({
      contentType: 'image/svg+xml',
      data: '<svg/>',
      minIntervalMs: 5000,
    });
  });

  it('changes its revision exactly when the picture changes, and says nothing without one', () => {
    const revisionOf = (svg: string): unknown =>
      imaging.toState({ connectionKey: 'k', deviceKey: 'x', payload: { map: { svg } } }, mapping)[0]
        ?.state.image?.revision;

    expect(revisionOf('<svg/>')).toBe(revisionOf('<svg/>'));
    expect(revisionOf('<svg/>')).not.toBe(revisionOf('<svg><g/></svg>'));
    expect(
      imaging.toState({ connectionKey: 'k', deviceKey: 'x', payload: { other: 1 } }, mapping),
    ).toEqual([]);
  });

  it('is refused on an entity that is not an image', () => {
    expect(() =>
      integrationProfileSchema.parse({
        ...PROFILE_JSON,
        entities: [
          {
            domain: 'sensor',
            capabilities: { sensor_text: {} },
            state: {},
            image: { path: 'x', contentType: 'image/png' },
          },
        ],
      }),
    ).toThrow('Only an image has a picture');
  });
});
