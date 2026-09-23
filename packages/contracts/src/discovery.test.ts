import { describe, expect, it } from 'vitest';

import { discoveryAdoptSchema } from './api-registry.js';
import { WS_TOPICS, wsServerMessageSchema } from './api-ws.js';
import { BUS_PATTERNS, busSubjects } from './bus-subjects.js';
import {
  discoveredDeviceSchema,
  discoveredReplySchema,
  discoveryEventSchema,
  HUB_DISCOVERED_METHOD,
} from './discovery.js';
import { probeReplySchema } from './integrations.js';

/**
 * A Shelly heard over mDNS and identified by its probe.
 *
 * @returns The candidate, as the hub lists it.
 */
function candidate(): Record<string, unknown> {
  return {
    id: '3f1c9a0b5e2d4c71',
    vendorId: 'shelly',
    driverId: 'switch-pm',
    kind: 'shelly/switch-pm',
    source: 'mdns',
    address: '192.168.1.40',
    externalId: 'shelly1pmg3-a8032ab12345',
    name: 'Kitchen',
    model: '1PM Gen3',
    modelChoices: ['1PM Gen3'],
    modelCode: 'S3SW-001P16EU',
    swVersion: '1.4.2',
    transportConfig: { host: '192.168.1.40' },
    firstSeenAt: '2026-09-23T10:00:00.000Z',
    lastSeenAt: '2026-09-23T10:05:00.000Z',
  };
}

describe('discoveredDeviceSchema', () => {
  it('carries the device, the driver it belongs to and how to reach it', () => {
    const parsed = discoveredDeviceSchema.parse(candidate());

    expect([parsed.kind, parsed.model, parsed.transportConfig]).toEqual([
      'shelly/switch-pm',
      '1PM Gen3',
      { host: '192.168.1.40' },
    ]);
  });

  it('holds what a device did not say as null rather than leaving it out', () => {
    // A Nanoleaf gives its serial only to a caller holding its token, and a Sonoff in DIY mode
    // does not say which of its family it is.
    const parsed = discoveredDeviceSchema.parse({
      ...candidate(),
      externalId: null,
      name: null,
      model: null,
      modelCode: null,
      swVersion: null,
      modelChoices: ['BASICR3', 'MINI'],
    });

    expect([parsed.externalId, parsed.model, parsed.modelChoices]).toEqual([
      null,
      null,
      ['BASICR3', 'MINI'],
    ]);
  });

  it('always offers at least one model to adopt it as', () => {
    expect(discoveredDeviceSchema.safeParse({ ...candidate(), modelChoices: [] }).success).toBe(
      false,
    );
  });

  it('names how the device was heard', () => {
    expect(discoveredDeviceSchema.safeParse({ ...candidate(), source: 'module' }).success).toBe(
      true,
    );
    expect(discoveredDeviceSchema.safeParse({ ...candidate(), source: 'sweep' }).success).toBe(
      false,
    );
  });
});

describe('the discovered method and event', () => {
  it('is a method of the hub, answered with every candidate', () => {
    expect(busSubjects.service('hub', HUB_DISCOVERED_METHOD)).toBe('nebula.v1.svc.hub.discovered');
    expect(discoveredReplySchema.parse({ items: [candidate()] }).items).toHaveLength(1);
  });

  it('announces that the list changed on a subject of its own, with how long it now is', () => {
    expect(busSubjects.discoveryEvent('changed')).toBe('nebula.v1.event.discovery.changed');
    expect(BUS_PATTERNS.allDiscoveryEvents).toBe('nebula.v1.event.discovery.*');
    expect(discoveryEventSchema.parse({ count: 2 }).count).toBe(2);
  });
});

describe('probeReplySchema', () => {
  it('may say which driver and model the probe found, for the form to preselect', () => {
    const parsed = probeReplySchema.parse({
      isReachable: true,
      detail: '192.168.1.40 answered: S3SW-001P16EU',
      detected: { kind: 'shelly/switch-pm', model: '1PM Gen3', modelChoices: ['1PM Gen3'] },
    });

    expect(parsed.detected?.kind).toBe('shelly/switch-pm');
    expect(probeReplySchema.parse({ isReachable: false, detail: 'timed out' }).detected).toBe(
      undefined,
    );
  });
});

describe('discoveryAdoptSchema', () => {
  it('asks only what the owner decides: the id, the name, the room, the tags', () => {
    const parsed = discoveryAdoptSchema.parse({ id: 'shelly-kitchen', name: 'Kitchen' });

    expect([parsed.transportConfig, parsed.options, parsed.tagIds, parsed.model]).toEqual([
      {},
      {},
      [],
      undefined,
    ]);
  });

  it('refuses an id the platform keeps for itself', () => {
    expect(discoveryAdoptSchema.safeParse({ id: 'system', name: 'Kitchen' }).success).toBe(false);
  });

  it('takes no kind: the candidate says which driver it is', () => {
    const parsed = discoveryAdoptSchema.parse({
      id: 'shelly-kitchen',
      name: 'Kitchen',
      kind: 'bambu-lab/printer',
    });

    expect('kind' in parsed).toBe(false);
  });
});

describe('the discovery topic', () => {
  it('can be subscribed to, and carries the count', () => {
    expect(WS_TOPICS).toContain('discovery');
    expect(
      wsServerMessageSchema.parse({ type: 'discovery_event', event: 'changed', count: 3 }),
    ).toEqual({ type: 'discovery_event', event: 'changed', count: 3 });
  });
});
