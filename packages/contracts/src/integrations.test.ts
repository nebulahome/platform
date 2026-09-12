import { describe, expect, it } from 'vitest';

import {
  adoptRequestSchema,
  catalogueReplySchema,
  discoverRequestSchema,
  discoveredCandidateSchema,
  integrationIdSchema,
  integrationKindIdSchema,
  integrationVendorSchema,
  modelChoicesOf,
  probeReplySchema,
  probeRequestSchema,
  reloadReplySchema,
  type IntegrationVendor,
} from './integrations.js';
import { packageIdSchema } from './package-manifest.js';

/**
 * A candidate with every required field present, for tests that vary one of them.
 *
 * @returns The candidate, as it would arrive on the bus.
 */
function candidate(): Record<string, unknown> {
  return {
    candidateId: 'scan-1:shellyplus1-aabbcc',
    integrationId: 'shelly-lab',
    externalId: 'shellyplus1-aabbcc',
    name: 'Lab relay',
    entities: [{ entityId: 'switch.lab_relay', name: 'Lab relay', capabilities: ['on_off'] }],
  };
}

/**
 * A vendor as the hub lists it, with one driver that drives several models and one that
 * drives one, for tests about the choices an owner is offered.
 *
 * @returns The catalogue entry.
 */
function vendor(): IntegrationVendor {
  return integrationVendorSchema.parse({
    id: 'bambu-lab',
    version: '1.0.0',
    name: 'Bambu Lab',
    internetRequired: false,
    transports: ['mqtt'],
    setup: { transport: { fields: [] } },
    drivers: [
      {
        id: 'bambu-lab/printer',
        vendorId: 'bambu-lab',
        driverId: 'printer',
        name: 'Printer',
        transport: 'mqtt',
        models: ['X1C', 'P1S'],
        setup: { transport: { fields: [] } },
      },
      {
        id: 'bambu-lab/scanner',
        vendorId: 'bambu-lab',
        driverId: 'scanner',
        name: 'Scanner',
        transport: 'mqtt',
        models: [],
        setup: { transport: { fields: [] } },
      },
    ],
  });
}

describe('integrationKindIdSchema', () => {
  it('names a driver by its vendor and itself', () => {
    expect(integrationKindIdSchema.safeParse('bambu-lab/printer').success).toBe(true);
  });

  it('refuses the old, unqualified shape', () => {
    // A row or a client still saying `bambu-lab` fails here, at the boundary, with a message
    // about the kind - rather than in the hub, with a message about a bundle that is not there.
    expect(integrationKindIdSchema.safeParse('bambu-lab').success).toBe(false);
  });
});

describe('modelChoicesOf', () => {
  it('offers every model of every driver, in the order the bundle lists them', () => {
    expect(modelChoicesOf(vendor()).map((choice) => choice.model)).toEqual([
      'X1C',
      'P1S',
      'Scanner',
    ]);
  });

  it('names the driver each choice selects', () => {
    // The pick decides two things at once: which driver's form to show, and which label to
    // keep on the row. Carrying the kind beside the model is what lets the form follow the pick.
    expect(modelChoicesOf(vendor())[0]).toEqual({
      kind: 'bambu-lab/printer',
      driverId: 'printer',
      model: 'X1C',
    });
  });

  it('offers a driver that lists no model under its own name', () => {
    expect(modelChoicesOf(vendor())[2]).toEqual({
      kind: 'bambu-lab/scanner',
      driverId: 'scanner',
      model: 'Scanner',
    });
  });
});

describe('integrationIdSchema', () => {
  it('accepts and rejects exactly what a package id does', () => {
    // The two share one namespace: both become `entities.source`, the subject token `core`
    // routes a command on. If one pattern drifted, a collision would get through that nothing
    // downstream could tell apart, and two owners would answer the same subject.
    for (const value of ['zigbee2mqtt', 'shelly-lab', 'a1', 'Upper', '1leading', 'x', '']) {
      expect(integrationIdSchema.safeParse(value).success).toBe(
        packageIdSchema.safeParse(value).success,
      );
    }
  });
});

describe('discoveredCandidateSchema', () => {
  it('describes the entities adoption would create', () => {
    const parsed = discoveredCandidateSchema.parse(candidate());

    expect(parsed.entities[0]?.capabilities).toEqual(['on_off']);
  });

  it('refuses a candidate that would adopt nothing', () => {
    // A device exposing no entity is a registry row no automation can name and no card can
    // show, so it is refused at discovery rather than adopted and then wondered about.
    expect(discoveredCandidateSchema.safeParse({ ...candidate(), entities: [] }).success).toBe(
      false,
    );
  });

  it('keeps what the transport saw, for when a claim looks wrong', () => {
    const parsed = discoveredCandidateSchema.parse(candidate());

    expect(parsed.evidence).toEqual({});
  });
});

describe('discoverRequestSchema', () => {
  it('scans every enabled instance when none is named', () => {
    expect(discoverRequestSchema.parse({}).integrationId).toBeUndefined();
  });

  it('bounds a scan even when the caller says nothing', () => {
    // A scan holds a radio or a subscription open. Without a default, a caller that forgot the
    // field would leave one running until the service restarts.
    expect(discoverRequestSchema.parse({}).timeoutMs).toBe(30_000);
  });
});

describe('adoptRequestSchema', () => {
  it('leaves the name the integration discovered unless the owner replaces it', () => {
    expect(adoptRequestSchema.parse({ candidateId: 'scan-1:x' }).name).toBeUndefined();
  });
});

describe('the management methods', () => {
  it('describes a vendor with its drivers and what each form asks, so the interface never reads a bundle', () => {
    const reply = catalogueReplySchema.parse({
      vendors: [
        {
          id: 'bambu-lab',
          version: '1.0.0',
          name: 'Bambu Lab',
          internetRequired: false,
          transports: ['mqtt'],
          setup: { transport: { fields: [] } },
          drivers: [
            {
              id: 'bambu-lab/printer',
              vendorId: 'bambu-lab',
              driverId: 'printer',
              name: 'Printer',
              transport: 'mqtt',
              models: ['P1S'],
              setup: {
                transport: {
                  constants: { username: 'bblp' },
                  fields: [
                    { key: 'url', type: 'text', label: 'Printer address', isRequired: true },
                  ],
                },
              },
            },
          ],
        },
      ],
    });

    expect(reply.vendors[0]?.drivers[0]?.setup.transport.fields[0]?.key).toBe('url');
    expect(reply.vendors[0]?.drivers[0]?.setup.options.fields).toEqual([]);
  });

  it('carries a logo only as a data URL of an image', () => {
    // The interface puts it straight into an `img`, so anything else here is either a broken
    // image or a way to load a script from a bundle. Both are refused at the boundary.
    const svg = 'data:image/svg+xml;base64,PHN2Zy8+';

    expect(integrationVendorSchema.parse({ ...vendor(), logo: svg }).logo).toBe(svg);
    expect(
      integrationVendorSchema.safeParse({ ...vendor(), logo: 'https://example.com/logo.svg' })
        .success,
    ).toBe(false);
  });

  it('bounds a probe even when the caller says nothing', () => {
    expect(
      probeRequestSchema.parse({ kind: 'bambu-lab/printer', transportConfig: {} }).timeoutMs,
    ).toBe(8000);
    expect(
      probeRequestSchema.safeParse({
        kind: 'bambu-lab/printer',
        transportConfig: {},
        timeoutMs: 120_000,
      }).success,
    ).toBe(false);
  });

  it('answers a probe with a verdict and a sentence, never a throw', () => {
    expect(probeReplySchema.parse({ isReachable: false, detail: 'ECONNREFUSED' })).toEqual({
      isReachable: false,
      detail: 'ECONNREFUSED',
    });
  });

  it('answers a reload with the state the hub recorded', () => {
    expect(reloadReplySchema.parse({ state: 'running', lastError: null }).state).toBe('running');
    expect(reloadReplySchema.safeParse({ state: 'sleeping', lastError: null }).success).toBe(false);
  });
});
