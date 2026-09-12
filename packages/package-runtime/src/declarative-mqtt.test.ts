/**
 * The declarative mapper on a device that lives on a topic.
 *
 * A device reached over MQTT differs from one reached by address in three ways, and each one
 * needed something the profile grammar did not have. Its identity is in the topic rather than
 * the payload; its reports say `"on"` where the model wants `true`; and a command to it has to
 * be published somewhere only the device's own topic can name. These cases are the fixture the
 * Bambu Lab bundle is built on, reduced to one light.
 */
import { describe, expect, it } from 'vitest';

import { parseEntityId, type CapabilityState, type EntityId } from '@nebula-home/contracts';

import { bundleManifestSchema } from './bundle.js';
import { createDeclarativeIntegration } from './declarative.js';
import type { Claim, MappingContext } from './integration.js';
import { integrationProfileSchema } from './profile.js';

const LIGHT = parseEntityId('light.printer_chamber');

/**
 * A manifest for a device that owns a topic.
 *
 * @returns The parsed manifest.
 */
function manifest(): ReturnType<typeof bundleManifestSchema.parse> {
  return bundleManifestSchema.parse({
    id: 'acme/topic-light',
    version: '1.0.0',
    sdk: '^1.0.0',
    name: 'A light on a topic',
    vendor: { id: 'acme', name: 'Acme Lights' },
    transport: 'mqtt',
    kind: 'declarative',
    profile: './profile.json',
    setup: './setup.json',
  });
}

/**
 * A profile for it: one light, reported as a word, commanded on its own topic.
 *
 * @returns The parsed profile.
 */
function profile(): ReturnType<typeof integrationProfileSchema.parse> {
  return integrationProfileSchema.parse({
    discovery: {
      scan: { filter: 'device/+/report' },
      claim: [{ path: 'message.light', exists: true }],
      identity: { externalId: 'segments[1]' },
    },
    subscriptions: [{ op: 'topic', args: { filter: ['device', { $: 'segments[1]' }, 'report'] } }],
    entities: [
      {
        domain: 'light',
        capabilities: { on_off: {} },
        state: { on_off: { isOn: { path: 'message.light.mode', equals: 'on' } } },
        commands: {
          'on_off.turn_on': {
            op: 'publish',
            args: {
              topic: ['device', { $: 'device.segments[1]' }, 'request'],
              payload: { light: { mode: 'on' } },
            },
          },
        },
      },
    ],
  });
}

/** What the scan saw: a report, on the device's own topic. */
const DESCRIPTOR = {
  topic: 'device/SN123/report',
  segments: ['device', 'SN123', 'report'],
  message: { light: { mode: 'on' } },
};

/**
 * The claim the integration produces for it.
 *
 * @returns The claim.
 */
function claim(): Claim {
  return { deviceKey: 'device/SN123/report', externalId: 'SN123', descriptor: DESCRIPTOR };
}

/**
 * A mapping context holding the one light.
 *
 * @param lastState - What it last reported, if anything.
 * @returns The context.
 */
function context(lastState?: CapabilityState): MappingContext {
  return {
    options: {},
    claim: claim(),
    entities: new Map<string, EntityId>([['', LIGHT]]),
    lastState: (): CapabilityState | undefined => lastState,
  };
}

/**
 * The integration under test.
 *
 * @returns A declarative integration built from the fixture.
 */
function integration(): ReturnType<typeof createDeclarativeIntegration> {
  return createDeclarativeIntegration(manifest(), profile());
}

describe('identity from the topic', () => {
  it('claims a device by a segment of the topic it spoke on', () => {
    const claimed = integration().claim({ deviceKey: DESCRIPTOR.topic, payload: DESCRIPTOR }, {});

    expect(claimed?.externalId).toBe('SN123');
  });

  it('subscribes to the device by composing its topic', () => {
    const [subscription] = integration().subscriptions([claim()], {});

    // Filled element by element, so the serial lands between two literals. A string could not
    // have been composed; a list of segments can.
    expect(subscription?.args['filter']).toEqual(['device', 'SN123', 'report']);
  });

  it('names the maker from the bundle when the device does not say', () => {
    expect(integration().describe(claim(), {}).manufacturer).toBe('Acme Lights');
  });
});

describe('a state field that compares', () => {
  it('reads "on" as true', () => {
    const [report] = integration().toState(
      { connectionKey: 'mqtt', deviceKey: DESCRIPTOR.topic, payload: DESCRIPTOR },
      context(),
    );

    expect(report?.state).toEqual({ on_off: { isOn: true } });
  });

  it('reads anything else as false', () => {
    const payload = { ...DESCRIPTOR, message: { light: { mode: 'flashing' } } };
    const [report] = integration().toState(
      { connectionKey: 'mqtt', deviceKey: DESCRIPTOR.topic, payload },
      context(),
    );

    expect(report?.state).toEqual({ on_off: { isOn: false } });
  });

  it('says nothing when the field was not in the report', () => {
    // A partial report that omits the light must leave it as it was. Reading absence as
    // "not equal to on" would switch every light off on every delta.
    const payload = { ...DESCRIPTOR, message: { temperature: 21 } };

    expect(
      integration().toState(
        { connectionKey: 'mqtt', deviceKey: DESCRIPTOR.topic, payload },
        context(),
      ),
    ).toEqual([]);
  });
});

describe('a command addressed to the device', () => {
  it('publishes on a topic composed from the device the command is for', () => {
    const request = integration().toCommand(
      { entityId: LIGHT, capability: 'on_off', command: { command: 'turn_on' } },
      context(),
    );

    expect(request.op).toBe('publish');
    expect(request.args['topic']).toEqual(['device', 'SN123', 'request']);
    expect(request.args['payload']).toEqual({ light: { mode: 'on' } });
  });
});

describe('the grammar', () => {
  it('admits a comparison and nothing beyond it', () => {
    // The same two things a claim can say, and no third. `notEquals`, `greaterThan` or a list
    // of alternatives would each be the first feature of a language.
    const base = profile();
    const withExtra = {
      ...base,
      entities: [
        {
          ...base.entities[0],
          state: { on_off: { isOn: { path: 'message.light.mode', equals: 'on', or: 'ON' } } },
        },
      ],
    };

    expect(integrationProfileSchema.safeParse(withExtra).success).toBe(false);
  });
});
