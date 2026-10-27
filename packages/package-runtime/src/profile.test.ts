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

  it('lets an entity name the catalogue icon it starts with', () => {
    // The icon is a catalogue id, the same alphabet a driver's `defaultIcon` uses, so a profile
    // cannot smuggle a drawing in; whether the id exists is the catalogue's question.
    const profile = relayProfile();
    const entity = { ...(profile['entities'] as Record<string, unknown>[])[0], icon: 'relay' };

    expect(
      integrationProfileSchema.parse({ ...profile, entities: [entity] }).entities[0]?.icon,
    ).toBe('relay');
    expect(
      integrationProfileSchema.safeParse({
        ...profile,
        entities: [{ ...entity, icon: 'Not An Id' }],
      }).success,
    ).toBe(false);
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

  it('lets a claim name one model string among several', () => {
    // A family of devices is one profile and a list of the model codes it drives; the list is
    // membership, not an `or` between paths, so the ceiling stays where it is.
    const profile = relayProfile();
    const discovery = profile['discovery'] as Record<string, unknown>;
    const claim = [{ path: 'model', oneOf: ['S3SW-001P16EU', 'S4SW-001P16EU'] }];

    expect(
      integrationProfileSchema.parse({ ...profile, discovery: { ...discovery, claim } }).discovery
        .claim[0],
    ).toEqual({ path: 'model', oneOf: ['S3SW-001P16EU', 'S4SW-001P16EU'] });
  });

  it('refuses an empty list, which would claim nothing and say nothing', () => {
    const profile = relayProfile();
    const discovery = profile['discovery'] as Record<string, unknown>;

    expect(
      integrationProfileSchema.safeParse({
        ...profile,
        discovery: { ...discovery, claim: [{ path: 'model', oneOf: [] }] },
      }).success,
    ).toBe(false);
  });

  it('lets a state value be looked up in a table', () => {
    // A device says `opening`, `closing`, `open`, `closed`, `stopped`; the capability wants
    // three words. A table renames and cannot compute, which is why it is admitted.
    const profile = relayProfile();
    const entity = {
      domain: 'cover',
      capabilities: { cover: {} },
      state: {
        cover: {
          position: 'current_pos',
          motion: { path: 'state', map: { opening: 'opening' }, default: 'stopped' },
        },
      },
    };

    expect(
      integrationProfileSchema.parse({ ...profile, entities: [entity] }).entities[0]?.state.cover?.[
        'motion'
      ],
    ).toEqual({ path: 'state', map: { opening: 'opening' }, default: 'stopped' });
  });
});

describe('integrationProfileSchema roles', () => {
  it('lets a device say it is an IR blaster, and a Bluetooth proxy', () => {
    const parsed = integrationProfileSchema.parse({
      ...relayProfile(),
      infrared: { signals: ['ir', 'rf'], receives: true },
      bluetoothProxy: { modes: ['passive', 'active'] },
    });

    expect(parsed.infrared).toEqual({ signals: ['ir', 'rf'], receives: true });
    expect(parsed.bluetoothProxy).toEqual({ modes: ['passive', 'active'] });
    expect(integrationProfileSchema.parse(relayProfile()).infrared).toBeUndefined();
  });

  it('refuses a blaster that sends radio only, or a proxy without a mode', () => {
    expect(
      integrationProfileSchema.safeParse({
        ...relayProfile(),
        infrared: { signals: ['rf'], receives: false },
      }).success,
    ).toBe(false);
    expect(
      integrationProfileSchema.safeParse({ ...relayProfile(), bluetoothProxy: { modes: [] } })
        .success,
    ).toBe(false);
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
