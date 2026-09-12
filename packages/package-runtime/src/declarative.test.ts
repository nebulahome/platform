import { describe, expect, it } from 'vitest';

import { parseEntityId, type CapabilityState, type EntityId } from '@nebula-home/contracts';

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

/**
 * The profile of that bundle: one relay, polled, switchable.
 *
 * @returns The parsed profile.
 */
function profile(): ReturnType<typeof integrationProfileSchema.parse> {
  return integrationProfileSchema.parse({
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
  });
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
