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
});

describe('driverManifestSchema', () => {
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

describe('resolveManifest', () => {
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
