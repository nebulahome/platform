import { describe, expect, it } from 'vitest';

import { parseEntityId, type EntityId } from '@nebulahome/contracts';
import {
  bundleManifestSchema,
  createDeclarativeIntegration,
  integrationProfileSchema,
  type Claim,
  type Integration,
} from '@nebulahome/package-runtime';

import { DeviceBook, describeDevice } from './devices.js';

const RELAY = parseEntityId('switch.relay_one');
const OTHER = parseEntityId('switch.relay_two');

/**
 * A real declarative integration for a generic REST relay.
 *
 * A profile rather than a hand-written double, so that these tests exercise the path a bundle
 * actually takes instead of a stand-in that agrees with them by construction.
 *
 * @param icon - The catalogue icon the entity starts with, when a test wants one.
 * @returns The integration.
 */
function relay(icon?: string): Integration {
  return createDeclarativeIntegration(
    bundleManifestSchema.parse({
      id: 'generic/rest-relay',
      version: '1.0.0',
      sdk: '^1.0.0',
      name: 'Generic REST relay',
      vendor: { id: 'generic', name: 'Generic' },
      transport: 'http',
      kind: 'declarative',
      profile: './profile.json',
      setup: './setup.json',
    }),
    integrationProfileSchema.parse({
      discovery: {
        claim: [{ path: 'relay', exists: true }],
        identity: { externalId: 'device.id' },
      },
      entities: [
        {
          domain: 'switch',
          ...(icon === undefined ? {} : { icon }),
          capabilities: { on_off: {} },
          state: { on_off: { isOn: 'relay.on' } },
          commands: { 'on_off.turn_on': { op: 'get', args: { path: '/relay/on' } } },
        },
      ],
    }),
  );
}

/**
 * A claim for one relay.
 *
 * @param deviceKey - How the transport addresses it.
 * @param externalId - How the integration identifies it.
 * @returns The claim.
 */
function claim(deviceKey: string, externalId: string): Claim {
  return { deviceKey, externalId, descriptor: { device: { id: externalId }, relay: {} } };
}

/**
 * A book holding one relay, or two when a second is asked for.
 *
 * @param second - Whether to bind a second device.
 * @returns The book.
 */
function book(second = false): DeviceBook {
  const bound = new DeviceBook();
  bound.bind({
    claim: claim('192.168.1.40', 'relay-one'),
    entities: new Map<string, EntityId>([['', RELAY]]),
  });

  if (second) {
    bound.bind({
      claim: claim('192.168.1.41', 'relay-two'),
      entities: new Map<string, EntityId>([['', OTHER]]),
    });
  }

  return bound;
}

describe('describeDevice', () => {
  it('registers an entity with the icon its profile starts it with', () => {
    // The icon rides the registration to `core` like the name does; a profile that names
    // none leaves the key out, so `core` writes nothing rather than an empty string.
    const iconed = describeDevice(
      'relay_one',
      relay('relay'),
      claim('192.168.1.40', 'relay-one'),
      {},
    );
    const bare = describeDevice('relay_one', relay(), claim('192.168.1.40', 'relay-one'), {});

    expect(iconed.registrations[0]?.icon).toBe('relay');
    expect(bare.registrations[0] !== undefined && 'icon' in bare.registrations[0]).toBe(false);
  });
});

describe('DeviceBook', () => {
  it('maps a message onto the entity of the device it came from', () => {
    const reports = book(true).ingest(
      relay(),
      {},
      {
        connectionKey: 'http:192.168.1.40',
        deviceKey: '192.168.1.40',
        payload: { relay: { on: true } },
      },
    );

    expect(reports.map((report) => report.entityId)).toEqual([RELAY]);
  });

  it('says nothing about a device it does not know', () => {
    // One connection carries every instance that shares it, so most of what arrives on it
    // belongs to somebody else. Silence is the correct answer, not a warning per message.
    const reports = book().ingest(
      relay(),
      {},
      {
        connectionKey: 'http:192.168.1.40',
        deviceKey: '192.168.1.99',
        payload: { relay: { on: true } },
      },
    );

    expect(reports).toEqual([]);
  });

  it('remembers what an entity last reported', () => {
    // What lets `toCommand` stay pure: a relative dim or a toggle reads the current value from
    // here instead of asking the device for it.
    const bound = book();
    bound.ingest(
      relay(),
      {},
      {
        connectionKey: 'http:192.168.1.40',
        deviceKey: '192.168.1.40',
        payload: { relay: { on: true } },
      },
    );

    expect(bound.lastState(RELAY)).toEqual({ on_off: { isOn: true } });
  });

  it('finds the device that owns an entity, which is what a command needs', () => {
    expect(book(true).byEntityId(OTHER)?.claim.externalId).toBe('relay-two');
  });

  it('knows nothing about an entity that is not on any of its devices', () => {
    expect(book().byEntityId(OTHER)).toBeUndefined();
  });

  it('lists every entity it has seen a state for, which is what a resync republishes', () => {
    const bound = book(true);

    for (const deviceKey of ['192.168.1.40', '192.168.1.41']) {
      bound.ingest(
        relay(),
        {},
        {
          connectionKey: 'http:x',
          deviceKey,
          payload: { relay: { on: true } },
        },
      );
    }

    expect(bound.known().sort()).toEqual([RELAY, OTHER].sort());
  });

  it('reports nothing for an entity that has never spoken', () => {
    // A resync must not invent a state for a device that has not answered since startup. `core`
    // marks those unavailable itself when nobody answers for them.
    expect(book().known()).toEqual([]);
  });

  it('says every entity that spoke is unreachable when its connection drops', () => {
    // What the hub publishes when a broker session or a socket goes down; an entity that never
    // spoke is left to `core`, which marks it unavailable itself.
    const bound = book(true);

    bound.ingest(
      relay(),
      {},
      { connectionKey: 'http:x', deviceKey: '192.168.1.40', payload: { relay: { on: true } } },
    );

    expect(bound.withAvailability(false)).toEqual([
      { entityId: RELAY, state: { on_off: { isOn: true } }, attributes: {}, isAvailable: false },
    ]);
  });

  it('lists the claims, which is what the subscription plan is built from', () => {
    expect(book(true).claims()).toHaveLength(2);
  });
});
