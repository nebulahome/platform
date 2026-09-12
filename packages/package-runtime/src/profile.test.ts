import { describe, expect, it } from 'vitest';

import { integrationProfileSchema } from './profile.js';

/**
 * A generic REST relay: one endpoint reporting state, two switching it.
 *
 * Deliberately the whole of what the declarative tier is for. Anything that needs more than
 * this is a code bundle.
 *
 * @returns The profile, as it would be read from `profile.json`.
 */
function relayProfile(): Record<string, unknown> {
  return {
    discovery: {
      scan: { mdns: '_http._tcp' },
      probe: { op: 'get', args: { path: '/status' } },
      claim: [{ path: 'relay', exists: true }],
      identity: { externalId: 'device.id', name: 'device.name' },
    },
    subscriptions: [{ op: 'poll', args: { path: '/status', everyMs: 5000 } }],
    entities: [
      {
        domain: 'switch',
        capabilities: { on_off: {} },
        state: { on_off: { isOn: 'relay.on' } },
        commands: {
          'on_off.turn_on': { op: 'get', args: { path: '/relay/on' } },
          'on_off.turn_off': { op: 'get', args: { path: '/relay/off' } },
        },
      },
    ],
  };
}

describe('integrationProfileSchema', () => {
  it('accepts a device whose entities are known in advance', () => {
    const parsed = integrationProfileSchema.parse(relayProfile());

    expect(parsed.entities[0]?.state.on_off).toEqual({ isOn: 'relay.on' });
  });

  it('reads a value out of the command into the request', () => {
    // The one thing a request template cannot be literal about: `set_level` carries the level
    // the caller asked for, and it has to reach the device.
    const profile = relayProfile();
    const entity = { ...(profile['entities'] as Record<string, unknown>[])[0] };
    entity['capabilities'] = { on_off: {}, level: {} };
    entity['commands'] = {
      'level.set_level': {
        op: 'get',
        args: { path: '/dim', query: { v: { $: 'command.level' } } },
      },
    };

    expect(integrationProfileSchema.safeParse({ ...profile, entities: [entity] }).success).toBe(
      true,
    );
  });
});

describe('the declarative ceiling', () => {
  it('refuses a profile that iterates over the payload', () => {
    // The line the tier is drawn on: if the number or kind of entity depends on the payload,
    // it is a code bundle. A field like this is how a configuration format starts becoming a
    // programming language, so it is refused structurally rather than discouraged in a guide.
    const profile = relayProfile();
    const entity = { ...(profile['entities'] as Record<string, unknown>[])[0], each: 'switches' };

    expect(integrationProfileSchema.safeParse({ ...profile, entities: [entity] }).success).toBe(
      false,
    );
  });

  it('refuses a helper function called from the profile', () => {
    const profile = relayProfile();
    const entity = { ...(profile['entities'] as Record<string, unknown>[])[0] };
    entity['state'] = { on_off: { isOn: { $fn: 'decode', args: 'raw' } } };

    expect(integrationProfileSchema.safeParse({ ...profile, entities: [entity] }).success).toBe(
      false,
    );
  });

  it('refuses a conditional smuggled into a path', () => {
    // A path is validated against a grammar that admits names, quoted keys and indexes, and
    // nothing else. A blocklist of jsonata operators would be one operator behind forever.
    const profile = relayProfile();
    const entity = { ...(profile['entities'] as Record<string, unknown>[])[0] };
    entity['state'] = { on_off: { isOn: 'relay.on ? true : false' } };

    expect(integrationProfileSchema.safeParse({ ...profile, entities: [entity] }).success).toBe(
      false,
    );
  });

  it('refuses a function call smuggled into a path', () => {
    const profile = relayProfile();
    const entity = { ...(profile['entities'] as Record<string, unknown>[])[0] };
    entity['state'] = { on_off: { isOn: '$exists(relay.on)' } };

    expect(integrationProfileSchema.safeParse({ ...profile, entities: [entity] }).success).toBe(
      false,
    );
  });

  it('accepts a quoted key, which real payloads need', () => {
    // Shelly reports channels as `switch:0`, which is not an identifier.
    const profile = relayProfile();
    const entity = { ...(profile['entities'] as Record<string, unknown>[])[0] };
    entity['state'] = { on_off: { isOn: "'switch:0'.output" } };

    expect(integrationProfileSchema.safeParse({ ...profile, entities: [entity] }).success).toBe(
      true,
    );
  });

  it('refuses an unknown key anywhere in the profile', () => {
    expect(
      integrationProfileSchema.safeParse({ ...relayProfile(), whenOffline: 'retry' }).success,
    ).toBe(false);
  });

  it('refuses a command naming a capability that does not exist', () => {
    const profile = relayProfile();
    const entity = { ...(profile['entities'] as Record<string, unknown>[])[0] };
    entity['commands'] = { 'teleport.engage': { op: 'get', args: {} } };

    expect(integrationProfileSchema.safeParse({ ...profile, entities: [entity] }).success).toBe(
      false,
    );
  });

  it('refuses a profile that declares no entity', () => {
    expect(integrationProfileSchema.safeParse({ ...relayProfile(), entities: [] }).success).toBe(
      false,
    );
  });
});

describe('state mapping against the capability', () => {
  it('refuses a state field the capability does not have', () => {
    // A misspelt field would map nothing, forever, in silence: the entity would simply never
    // report. Whoever writes a profile is not necessarily a programmer, and this is the one
    // mistake they cannot debug from the outside.
    const profile = relayProfile();
    const entity = { ...(profile['entities'] as Record<string, unknown>[])[0] };
    entity['state'] = { on_off: { isOnn: 'relay.on' } };

    expect(integrationProfileSchema.safeParse({ ...profile, entities: [entity] }).success).toBe(
      false,
    );
  });

  it('refuses a state mapping for a capability the entity does not declare', () => {
    const profile = relayProfile();
    const entity = { ...(profile['entities'] as Record<string, unknown>[])[0] };
    entity['state'] = { on_off: { isOn: 'relay.on' }, level: { level: 'relay.brightness' } };

    expect(integrationProfileSchema.safeParse({ ...profile, entities: [entity] }).success).toBe(
      false,
    );
  });
});
