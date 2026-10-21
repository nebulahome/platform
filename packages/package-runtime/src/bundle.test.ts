import { describe, expect, it } from 'vitest';

import {
  bundleManifestSchema,
  driverManifestSchema,
  integrationKindSchema,
  resolveManifest,
  vendorManifestSchema,
} from './bundle.js';

/**
 * A vendor's manifest with every required field present.
 *
 * @returns The manifest, as it would be read from `manifest.json`.
 */
function vendor(): Record<string, unknown> {
  return {
    id: 'shelly',
    version: '1.2.0',
    sdk: '^1.0.0',
    name: 'Shelly',
  };
}

/**
 * A code driver's manifest with every required field present.
 *
 * @returns The manifest, as it would be read from `driver.json`.
 */
function driver(): Record<string, unknown> {
  return {
    id: 'gen2',
    name: 'Gen2',
    transport: 'http',
    kind: 'code',
    entry: './index.js',
    setup: './setup.json',
  };
}

/**
 * A resolved manifest with every required field present.
 *
 * @returns The manifest, as the loader composes it from a vendor and a driver.
 */
function manifest(): Record<string, unknown> {
  return {
    id: 'shelly/gen2',
    version: '1.2.0',
    sdk: '^1.0.0',
    name: 'Shelly Gen2',
    vendor: { id: 'shelly', name: 'Shelly' },
    transport: 'http',
    kind: 'code',
    entry: './index.js',
    setup: './setup.json',
  };
}

describe('vendorManifestSchema', () => {
  it('carries the identity a catalogue lists a vendor by', () => {
    const parsed = vendorManifestSchema.parse(vendor());

    expect([parsed.id, parsed.name, parsed.version]).toEqual(['shelly', 'Shelly', '1.2.0']);
  });

  it('leaves the logo, the colour, the site and the setup to the vendors that have them', () => {
    // A vendor with nothing but a name and a driver is still a vendor. The interface draws a
    // monogram for one without a logo, and a vendor without vendor-wide settings has no form.
    const parsed = vendorManifestSchema.parse(vendor());

    expect([parsed.logo, parsed.color, parsed.url, parsed.setup]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('assumes a vendor works without the internet unless it says otherwise', () => {
    // The mark on the card is a warning, and a warning that has to be opted out of would show
    // on every local device by default - which is every device the platform was built for.
    expect(vendorManifestSchema.parse(vendor()).internetRequired).toBe(false);
    expect(
      vendorManifestSchema.parse({ ...vendor(), internetRequired: true }).internetRequired,
    ).toBe(true);
  });

  it('holds the colour to a hex triplet', () => {
    expect(vendorManifestSchema.parse({ ...vendor(), color: '#3B9DFF' }).color).toBe('#3B9DFF');
    expect(vendorManifestSchema.safeParse({ ...vendor(), color: 'blue' }).success).toBe(false);
  });

  it('refuses a field it does not know', () => {
    // Strict, so `hasMqtt: true` in a manifest is a load failure rather than a silent no-op:
    // which transports a vendor speaks is derived from its drivers, not declared.
    expect(vendorManifestSchema.safeParse({ ...vendor(), hasMqtt: true }).success).toBe(false);
  });

  it('reads a logo given as a path, with no room asked around it', () => {
    expect(vendorManifestSchema.parse({ ...vendor(), logo: './logo.svg' }).logo).toEqual({
      path: './logo.svg',
      padding: 0,
    });
    expect(vendorManifestSchema.parse(vendor()).logo).toBeUndefined();
  });

  it('lets a vendor ask for room around its logo, in pixels, where the logo is named', () => {
    // A mark drawn to the edge of its file needs more than the small margin every logo gets,
    // and the ask sits beside the file it is about rather than in a field of its own.
    const parsed = vendorManifestSchema.parse({
      ...vendor(),
      logo: { path: './logo.svg', padding: 6 },
    });

    expect(parsed.logo).toEqual({ path: './logo.svg', padding: 6 });
    expect(vendorManifestSchema.parse({ ...vendor(), logo: { path: './logo.svg' } }).logo).toEqual({
      path: './logo.svg',
      padding: 0,
    });
  });

  it('holds the room around a logo to whole pixels, sixteen at most', () => {
    const logo = { path: './logo.svg' };

    expect(
      vendorManifestSchema.safeParse({ ...vendor(), logo: { ...logo, padding: 40 } }).success,
    ).toBe(false);
    expect(
      vendorManifestSchema.safeParse({ ...vendor(), logo: { ...logo, padding: 2.5 } }).success,
    ).toBe(false);
    expect(
      vendorManifestSchema.safeParse({ ...vendor(), logo: { ...logo, inset: 4 } }).success,
    ).toBe(false);
    // The field the padding used to live in is gone, and a strict manifest says so.
    expect(vendorManifestSchema.safeParse({ ...vendor(), logoPadding: 4 }).success).toBe(false);
  });

  it('records the runtime the bundle was written against', () => {
    // A bundle outlives the runtime it was written for. Without a declared range, an old
    // profile is loaded against a schema it predates and fails somewhere further in.
    const withoutSdk = vendor();
    delete withoutSdk['sdk'];

    expect(vendorManifestSchema.safeParse(withoutSdk).success).toBe(false);
  });

  it('leaves integrity and signature to the catalogue', () => {
    // Neither is written by the author: the catalogue stamps them at publication, after the
    // approval a code bundle needs. A manifest without them is a bundle nobody has published.
    const parsed = vendorManifestSchema.parse(vendor());

    expect([parsed.integrity, parsed.signature]).toEqual([undefined, undefined]);
  });

  it('lets a vendor ship transports of its own, by name and module', () => {
    const parsed = vendorManifestSchema.parse({
      ...vendor(),
      transports: { rpc: './rpc/transport.js' },
    });

    expect(parsed.transports).toEqual({ rpc: './rpc/transport.js' });
  });

  it('ships no transport unless it says so', () => {
    expect(vendorManifestSchema.parse(vendor()).transports).toEqual({});
  });

  it('holds a transport name to a bare name; the vendor qualifies it', () => {
    expect(() =>
      vendorManifestSchema.parse({ ...vendor(), transports: { 'shelly/rpc': './rpc.js' } }),
    ).toThrow();
  });
});

describe('driverManifestSchema', () => {
  it('lets a driver name a transport its vendor ships, qualified by the vendor', () => {
    expect(driverManifestSchema.parse({ ...driver(), transport: 'shelly/rpc' }).transport).toBe(
      'shelly/rpc',
    );
  });

  it('requires every driver to say what setting up an instance asks', () => {
    // Without `setup.json` the interface has no form to show, and an instance could only be
    // created by writing a row by hand - which is the situation this file exists to end.
    const withoutSetup = driver();
    delete withoutSetup['setup'];

    expect(driverManifestSchema.safeParse(withoutSetup).success).toBe(false);
    expect(driverManifestSchema.parse(driver()).setup).toBe('./setup.json');
  });

  it('requires an entry point from a code driver', () => {
    const withoutEntry = driver();
    delete withoutEntry['entry'];

    expect(driverManifestSchema.safeParse(withoutEntry).success).toBe(false);
  });

  it('runs a matter driver on the matter transport, with neither a profile nor code', () => {
    const matter: Record<string, unknown> = { ...driver(), kind: 'matter', transport: 'matter' };
    delete matter['entry'];

    expect(driverManifestSchema.safeParse(matter).success).toBe(true);
    expect(driverManifestSchema.safeParse({ ...matter, transport: 'http' }).success).toBe(false);
    expect(driverManifestSchema.safeParse({ ...matter, entry: './driver.js' }).success).toBe(false);
    expect(driverManifestSchema.safeParse({ ...matter, kind: 'mqtt' }).success).toBe(false);
    expect(
      driverManifestSchema.safeParse({ ...matter, kind: 'mqtt', transport: 'mqtt-house' }).success,
    ).toBe(true);
  });

  it('requires a profile from a declarative driver', () => {
    expect(
      driverManifestSchema.safeParse({ ...driver(), kind: 'declarative', entry: undefined })
        .success,
    ).toBe(false);
  });

  it('refuses a driver that is both declarative and code', () => {
    // The two are different trust levels: a profile is data the catalogue can publish directly,
    // an entry point is code that has to be approved first. A driver claiming both would have
    // to be treated as the stricter one, which is a decision better refused than guessed.
    expect(
      driverManifestSchema.safeParse({
        ...driver(),
        kind: 'declarative',
        profile: './profile.json',
      }).success,
    ).toBe(false);
  });

  it('drives no named model unless it lists some', () => {
    expect(driverManifestSchema.parse(driver()).models).toEqual([]);
  });

  it('refuses a model listed twice', () => {
    // The list is what the owner picks from. The same label twice is two indistinguishable
    // choices, and whichever one they pick is a coin toss written into the row.
    expect(driverManifestSchema.safeParse({ ...driver(), models: ['X1C', 'X1C'] }).success).toBe(
      false,
    );
  });

  it('accepts a driver id that starts with a digit', () => {
    expect(driverManifestSchema.parse({ ...driver(), id: '1pm-mini-g3' }).id).toBe('1pm-mini-g3');
  });

  it('refuses what belongs to the vendor', () => {
    // A driver repeating the vendor's name or description is a second copy to keep in step,
    // and strictness is how the duplication the layout was made to end stays ended.
    expect(
      driverManifestSchema.safeParse({ ...driver(), vendor: { id: 'shelly', name: 'Shelly' } })
        .success,
    ).toBe(false);
    expect(driverManifestSchema.safeParse({ ...driver(), version: '1.0.0' }).success).toBe(false);
  });
});

describe('integrationKindSchema', () => {
  it('names a driver by its vendor and itself', () => {
    expect(integrationKindSchema.safeParse('shelly/gen2').success).toBe(true);
  });

  it('lets a driver be named the way its product is, digits first', () => {
    // `1PM Mini Gen3`, `2PM`, `2.5`: half of what Shelly makes starts with a digit. A kind is
    // never a bus subject token, so the reason an instance id must start with a letter does not
    // apply to the driver half of it - the vendor half still does, as a directory people type.
    expect(integrationKindSchema.safeParse('shelly/1pm-mini-g3').success).toBe(true);
    expect(integrationKindSchema.safeParse('1shelly/plus-1pm').success).toBe(false);
  });

  it('refuses a kind without a vendor', () => {
    // A bare driver id was the old shape. Refusing it here means a row from before the split,
    // or a client still sending one, fails at the boundary with a message about the kind.
    expect(integrationKindSchema.safeParse('shelly-gen2').success).toBe(false);
    expect(integrationKindSchema.safeParse('shelly/gen2/extra').success).toBe(false);
  });
});

describe('driverManifestSchema', () => {
  it('lets a driver name the catalogue icon its devices start with', () => {
    const parsed = driverManifestSchema.parse({ ...driver(), defaultIcon: 'relay' });

    expect(parsed.defaultIcon).toBe('relay');
    expect(driverManifestSchema.parse(driver()).defaultIcon).toBeUndefined();
    expect(driverManifestSchema.safeParse({ ...driver(), defaultIcon: 'Relay!' }).success).toBe(
      false,
    );
  });
});

describe('driverManifestSchema model codes', () => {
  it('maps what the hardware calls itself onto the model on the box', () => {
    const parsed = driverManifestSchema.parse({
      ...driver(),
      models: ['1PM Gen3', '1PM Mini Gen3'],
      modelCodes: { 'S3SW-001P16EU': '1PM Gen3', 'S3SW-001P8EU': '1PM Mini Gen3' },
    });

    expect(parsed.modelCodes).toEqual({
      'S3SW-001P16EU': '1PM Gen3',
      'S3SW-001P8EU': '1PM Mini Gen3',
    });
  });

  it('lets one code stand for a family whose exact model the hardware does not say', () => {
    // A Sonoff in DIY mode announces `diy_plug` whether it is a BASICR3 or a MINI: the driver
    // is certain, the model is a short list the owner picks from.
    const parsed = driverManifestSchema.parse({
      ...driver(),
      models: ['BASICR3', 'MINI'],
      modelCodes: { diy_plug: ['BASICR3', 'MINI'] },
    });

    expect(parsed.modelCodes).toEqual({ diy_plug: ['BASICR3', 'MINI'] });
  });

  it('refuses a code that names a model the driver does not list', () => {
    // Discovery would propose a model the form then refuses, on a device already half-added.
    expect(
      driverManifestSchema.safeParse({
        ...driver(),
        models: ['1PM Gen3'],
        modelCodes: { 'S3SW-001P16EU': '2PM Gen3' },
      }).success,
    ).toBe(false);
    expect(
      driverManifestSchema.safeParse({
        ...driver(),
        models: ['BASICR3'],
        modelCodes: { diy_plug: ['BASICR3', 'MINI'] },
      }).success,
    ).toBe(false);
  });

  it('refuses codes from a driver that lists no model to map them onto', () => {
    expect(
      driverManifestSchema.safeParse({ ...driver(), modelCodes: { NL42: 'Shapes' } }).success,
    ).toBe(false);
  });

  it('maps no code unless it says so', () => {
    expect(driverManifestSchema.parse(driver()).modelCodes).toBeUndefined();
  });
});

describe('driverManifestSchema model series', () => {
  it('puts the models in the series the vendor sells them as', () => {
    const parsed = driverManifestSchema.parse({
      ...driver(),
      models: ['H2D', 'X2D'],
      modelSeries: { H2D: 'H series', X2D: 'X series' },
    });

    expect(parsed.modelSeries).toEqual({ H2D: 'H series', X2D: 'X series' });
    expect(driverManifestSchema.parse(driver()).modelSeries).toBeUndefined();
  });

  it('refuses a series for a model the driver does not list', () => {
    // The form would group a model it never offers.
    expect(
      driverManifestSchema.safeParse({
        ...driver(),
        models: ['H2D'],
        modelSeries: { X2D: 'X series' },
      }).success,
    ).toBe(false);
  });
});

describe('resolveManifest', () => {
  it("refuses a driver that names another vendor's transport", () => {
    // A qualified transport is registered when its vendor loads, and vendors load in no
    // particular order: a driver leaning on another vendor's would work or not by luck.
    expect(() =>
      resolveManifest(vendorManifestSchema.parse(vendor()), {
        ...driverManifestSchema.parse(driver()),
        transport: 'other/rpc',
      }),
    ).toThrow(/belongs to another vendor/);
  });

  it("carries a transport of the driver's own vendor through", () => {
    expect(
      resolveManifest(vendorManifestSchema.parse(vendor()), {
        ...driverManifestSchema.parse(driver()),
        transport: 'shelly/rpc',
      }).transport,
    ).toBe('shelly/rpc');
  });

  it('carries the default icon from the driver', () => {
    const resolved = resolveManifest(
      vendorManifestSchema.parse(vendor()),
      driverManifestSchema.parse({ ...driver(), defaultIcon: 'relay' }),
    );

    expect(resolved.defaultIcon).toBe('relay');
    expect(bundleManifestSchema.safeParse(resolved).success).toBe(true);
  });

  it('composes the kind from the vendor and the driver', () => {
    const resolved = resolveManifest(
      vendorManifestSchema.parse(vendor()),
      driverManifestSchema.parse(driver()),
    );

    expect(resolved.id).toBe('shelly/gen2');
  });

  it('names the result after both', () => {
    const resolved = resolveManifest(
      vendorManifestSchema.parse(vendor()),
      driverManifestSchema.parse(driver()),
    );

    expect(resolved.name).toBe('Shelly Gen2');
  });

  it('takes the version, the runtime range and the description from the vendor', () => {
    const resolved = resolveManifest(
      vendorManifestSchema.parse({ ...vendor(), description: 'Relays on your own network.' }),
      driverManifestSchema.parse(driver()),
    );

    expect([resolved.version, resolved.sdk, resolved.description]).toEqual([
      '1.2.0',
      '^1.0.0',
      'Relays on your own network.',
    ]);
  });

  it('carries the vendor by id, name and site', () => {
    const resolved = resolveManifest(
      vendorManifestSchema.parse({ ...vendor(), url: 'https://shelly.com' }),
      driverManifestSchema.parse(driver()),
    );

    expect(resolved.vendor).toEqual({ id: 'shelly', name: 'Shelly', url: 'https://shelly.com' });
  });

  it('takes the transport, the models and the entry point from the driver', () => {
    const resolved = resolveManifest(
      vendorManifestSchema.parse(vendor()),
      driverManifestSchema.parse({ ...driver(), models: ['SNSW-001X16EU'] }),
    );

    expect([resolved.transport, resolved.models, resolved.kind, resolved.entry]).toEqual([
      'http',
      ['SNSW-001X16EU'],
      'code',
      './index.js',
    ]);
  });

  it('carries the codes the models are reported by, for discovery to read', () => {
    const resolved = resolveManifest(
      vendorManifestSchema.parse(vendor()),
      driverManifestSchema.parse({
        ...driver(),
        models: ['1PM Gen3'],
        modelCodes: { 'S3SW-001P16EU': '1PM Gen3' },
      }),
    );

    expect(resolved.modelCodes).toEqual({ 'S3SW-001P16EU': '1PM Gen3' });
    expect(bundleManifestSchema.safeParse(resolved).success).toBe(true);
  });

  it('carries the series of the models, for the catalogue to group them by', () => {
    const resolved = resolveManifest(
      vendorManifestSchema.parse(vendor()),
      driverManifestSchema.parse({
        ...driver(),
        models: ['X1C'],
        modelSeries: { X1C: 'X series' },
      }),
    );

    expect(resolved.modelSeries).toEqual({ X1C: 'X series' });
    expect(bundleManifestSchema.safeParse(resolved).success).toBe(true);
  });

  it('produces what the resolved manifest schema accepts', () => {
    // The resolved manifest is what every other part of the runtime reads, and the schema is
    // the contract they read it by; a resolver that composed something the schema refuses
    // would be found by the first hub test to build a manifest by hand instead.
    const resolved = resolveManifest(
      vendorManifestSchema.parse(vendor()),
      driverManifestSchema.parse(driver()),
    );

    expect(bundleManifestSchema.safeParse(resolved).success).toBe(true);
  });
});

describe('bundleManifestSchema', () => {
  it('carries what a catalogue lists it by', () => {
    // The manifest is also the catalogue row: `vendor.id` is the grouping by company and
    // `transport` the grouping by connection, so neither is optional.
    const parsed = bundleManifestSchema.parse(manifest());

    expect([parsed.vendor.id, parsed.transport]).toEqual(['shelly', 'http']);
  });

  it('is keyed by a vendor-qualified kind', () => {
    expect(bundleManifestSchema.safeParse({ ...manifest(), id: 'shelly-gen2' }).success).toBe(
      false,
    );
  });

  it('requires every bundle to say what setting up an instance asks', () => {
    const withoutSetup = manifest();
    delete withoutSetup['setup'];

    expect(bundleManifestSchema.safeParse(withoutSetup).success).toBe(false);
  });

  it('requires a profile from a declarative bundle', () => {
    expect(
      bundleManifestSchema.safeParse({ ...manifest(), kind: 'declarative', entry: undefined })
        .success,
    ).toBe(false);
  });

  it('refuses a bundle that is both declarative and code', () => {
    expect(
      bundleManifestSchema.safeParse({
        ...manifest(),
        kind: 'declarative',
        profile: './profile.json',
      }).success,
    ).toBe(false);
  });
});
