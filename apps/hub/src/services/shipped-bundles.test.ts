/**
 * The bundles under development in this repository.
 *
 * Outside production they are loaded at startup from `apps/hub/bundles`, in the place of the
 * integrations catalogue that will one day serve them, which means a typo in one of them is not a
 * failing test but a service that comes up with one fewer integration than it should — and says
 * so in a log line nobody is reading. `loadBundles` skips a directory it cannot parse rather
 * than refusing to start, which is right for a bundle somebody installed and wrong for one this
 * repository is responsible for.
 *
 * So the shipped ones are checked here twice over: through the real loader, which must report no
 * failures, and through the profile schema directly, which is where a mistyped path or a state
 * field that does not exist is actually caught. The second matters because a profile maps
 * payloads by name — a misspelt path maps nothing, forever, in silence, and the only symptom is
 * an entity that never reports.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { getSensorClass, sensorRegistrationIssue, toCanonical } from '@nebula-home/contracts';
import { loadBuiltinIcons } from '@nebula-home/icons';
import { integrationProfileSchema, type IntegrationProfile } from '@nebula-home/package-runtime';

import { RUNTIME_VERSION } from '../config.js';

import { loadBundles } from './bundles.js';

/** The `bundles/` directory beside the application, as the service reads it outside production. */
const DIRECTORY = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../bundles');

/** The families the Shelly bundle ships, one driver per layout of components. */
const SHELLY_DRIVERS = [
  '3em',
  'cover-pm',
  'dimmer',
  'dimmer-pm',
  'em-1',
  'em-2',
  'inputs',
  'plug',
  'pm',
  'power-strip',
  'shutter',
  'switch',
  'switch-2',
  'switch-2pm',
  'switch-pm',
];

/**
 * Every Shelly profile, parsed the way the loader parses it, keyed by driver.
 *
 * @returns The profiles, each having passed the schema the hub applies at startup.
 */
async function shellyProfiles(): Promise<Map<string, IntegrationProfile>> {
  const profiles = new Map<string, IntegrationProfile>();

  for (const driver of SHELLY_DRIVERS) {
    const text = await readFile(path.join(DIRECTORY, `shelly/${driver}/profile.json`), 'utf8');

    profiles.set(driver, integrationProfileSchema.parse(JSON.parse(text)));
  }

  return profiles;
}

/**
 * The model codes one profile claims.
 *
 * @param profile - The profile.
 * @returns The codes in its `model` condition, in order.
 */
function codesOf(profile: IntegrationProfile): string[] {
  const condition = profile.discovery.claim.find((each) => each.path === 'model');

  return condition !== undefined && 'oneOf' in condition ? condition.oneOf.map(String) : [];
}

describe('the bundles that ship', () => {
  it('all load, with nothing skipped', async () => {
    const result = await loadBundles({ directory: DIRECTORY, runtimeVersion: RUNTIME_VERSION });

    // The assertion that matters. A bundle this repository ships and the hub silently skips is
    // the failure this file exists to prevent.
    expect(result.failures).toEqual([]);
    expect(result.loaded.length).toBeGreaterThan(0);
  });

  it('ships every vendor under development, each with a logo the interface can show', async () => {
    const { vendors } = await loadBundles({
      directory: DIRECTORY,
      runtimeVersion: RUNTIME_VERSION,
    });

    expect(vendors.map((vendor) => vendor.manifest.id).sort()).toEqual([
      'bambu-lab',
      'govee',
      'nanoleaf',
      'plex',
      'shelly',
      'sonoff',
    ]);

    for (const vendor of vendors) {
      expect(vendor.logo).toMatch(/^data:image\/svg\+xml;base64,/);
    }
  });

  it('gives every shipped driver a default icon the catalogue has', async () => {
    // The API resolves the icon when a device is added and falls back to none with a warning
    // when it is unknown - which is fine for a bundle somebody else wrote, and a mistake here.
    const { loaded } = await loadBundles({ directory: DIRECTORY, runtimeVersion: RUNTIME_VERSION });
    const builtin = new Set(loadBuiltinIcons().map((icon) => icon.id));

    for (const bundle of loaded) {
      const icon = bundle.manifest.defaultIcon;

      expect(icon, `${bundle.manifest.id} names no default icon`).toBeDefined();
      expect(builtin.has(icon ?? ''), `${bundle.manifest.id} names ${String(icon)}`).toBe(true);
    }
  });

  it('gives every shipped entity an icon the catalogue has', async () => {
    // An entity's icon is the bundle's first word on it and the owner's afterwards. Nothing
    // checks the id at registration - `core` has no catalogue - so a wrong one would only show
    // as a blank tile on the devices page. For a shipped bundle, it is caught here instead.
    const { loaded } = await loadBundles({ directory: DIRECTORY, runtimeVersion: RUNTIME_VERSION });
    const builtin = new Set(loadBuiltinIcons().map((icon) => icon.id));

    for (const bundle of loaded) {
      const profilePath = bundle.manifest.profile;

      if (profilePath === undefined) {
        continue;
      }

      const text = await readFile(path.join(bundle.directory, profilePath), 'utf8');
      const profile = integrationProfileSchema.parse(JSON.parse(text));

      for (const entity of profile.entities) {
        const label = `${bundle.manifest.id} ${entity.objectId ?? entity.domain}`;

        expect(entity.icon, `${label} names no icon`).toBeDefined();
        expect(builtin.has(entity.icon ?? ''), `${label} names ${String(entity.icon)}`).toBe(true);
      }
    }
  });

  it('registers every shipped reading in a unit its sensor class accepts', async () => {
    // `core` refuses a registration whose unit does not belong to its class, so a wrong unit
    // here is a device that is identified and then never completed - found on hardware, late.
    const { loaded } = await loadBundles({ directory: DIRECTORY, runtimeVersion: RUNTIME_VERSION });

    for (const bundle of loaded) {
      const { entities } = bundle.integration.describe(
        { deviceKey: 'x', externalId: 'x', descriptor: {} },
        {},
      );

      for (const entity of entities) {
        const label = `${bundle.manifest.id} ${entity.objectId ?? entity.domain}`;

        expect(sensorRegistrationIssue(entity), label).toBeUndefined();
      }
    }
  });

  it('converts every shipped reading from the unit the device speaks', async () => {
    // A native unit the catalogue cannot convert publishes nothing at all: the reading is
    // dropped rather than stored in the wrong unit.
    const { loaded } = await loadBundles({ directory: DIRECTORY, runtimeVersion: RUNTIME_VERSION });

    for (const bundle of loaded) {
      const profilePath = bundle.manifest.profile;

      if (profilePath === undefined) {
        continue;
      }

      const text = await readFile(path.join(bundle.directory, profilePath), 'utf8');
      const profile = integrationProfileSchema.parse(JSON.parse(text));

      for (const entity of profile.entities) {
        const { deviceClass, unitOfMeasurement } = entity;

        if (deviceClass === undefined || getSensorClass(deviceClass)?.valueKind !== 'number') {
          continue;
        }

        const label = `${bundle.manifest.id} ${entity.objectId ?? entity.domain}`;

        expect(toCanonical(deviceClass, 1, unitOfMeasurement ?? ''), label).toBeDefined();
      }
    }
  });

  it('offers every Bambu Lab printer the one driver serves as its own choice', async () => {
    // One profile drives them all, but the owner adding one is asked which, and the answer is
    // what the vendor page shows for the row. Six names here is six entries in that dropdown.
    const { vendors } = await loadBundles({
      directory: DIRECTORY,
      runtimeVersion: RUNTIME_VERSION,
    });
    const bambu = vendors.find((vendor) => vendor.manifest.id === 'bambu-lab');

    expect(bambu?.drivers.map((driver) => driver.manifest.models)).toEqual([
      ['X1C', 'X1E', 'P1S', 'P1P', 'A1', 'A1 mini'],
    ]);
  });

  it('includes the Bambu Lab printer, over MQTT and declarative', async () => {
    const { loaded } = await loadBundles({
      directory: DIRECTORY,
      runtimeVersion: RUNTIME_VERSION,
    });

    const bambu = loaded.find((one) => one.manifest.id === 'bambu-lab/printer');

    expect(bambu).toBeDefined();
    expect(bambu?.manifest.transport).toBe('mqtt');
    expect(bambu?.manifest.kind).toBe('declarative');
  });
});

describe('the Shelly bundle', () => {
  it('ships its own transport and one declarative driver per family', async () => {
    const { vendors } = await loadBundles({
      directory: DIRECTORY,
      runtimeVersion: RUNTIME_VERSION,
    });
    const shelly = vendors.find((vendor) => vendor.manifest.id === 'shelly');

    expect(shelly?.ownTransports.map((transport) => transport.id)).toEqual(['shelly/rpc']);
    expect(shelly?.transports).toEqual(['shelly/rpc']);
    expect(shelly?.drivers.map((driver) => driver.driverId).sort()).toEqual(SHELLY_DRIVERS);

    for (const driver of shelly?.drivers ?? []) {
      expect(driver.manifest.transport, driver.driverId).toBe('shelly/rpc');

      // Declarative is a trust boundary as much as a format: the drivers are data. The code the
      // vendor ships is the transport, and it is reviewed as code.
      expect(driver.manifest.kind, driver.driverId).toBe('declarative');
    }
  });

  it('claims every model by its hardware code, each in exactly one family', async () => {
    // `app` is the firmware's word and has changed between releases; the model code is the
    // hardware's. A code claimed by two families would leave the hub picking one by the order
    // the directories were read in - unless the two differ on the profile the device is in.
    const profiles = await shellyProfiles();
    const families = new Map<string, string[]>();

    for (const [driver, profile] of profiles) {
      const codes = codesOf(profile);

      expect(codes.length, `${driver} claims no model`).toBeGreaterThan(0);

      for (const code of codes) {
        families.set(code, [...(families.get(code) ?? []), driver]);
      }
    }

    for (const [code, drivers] of families) {
      if (drivers.length === 1) {
        continue;
      }

      const conditions = drivers.map((driver) =>
        JSON.stringify(
          profiles.get(driver)?.discovery.claim.find((each) => each.path === 'profile'),
        ),
      );

      expect(conditions, `${code} is claimed by ${drivers.join(' and ')}`).not.toContain(undefined);
      expect(new Set(conditions).size, `${code} is claimed twice for one profile`).toBe(
        drivers.length,
      );
    }
  });

  it('names one model for every code it claims, in the same order', async () => {
    const { vendors } = await loadBundles({
      directory: DIRECTORY,
      runtimeVersion: RUNTIME_VERSION,
    });
    const shelly = vendors.find((vendor) => vendor.manifest.id === 'shelly');
    const profiles = await shellyProfiles();

    for (const driver of shelly?.drivers ?? []) {
      const profile = profiles.get(driver.driverId);

      expect(profile, driver.driverId).toBeDefined();
      expect(driver.manifest.models.length, driver.driverId).toBe(
        profile === undefined ? -1 : codesOf(profile).length,
      );
    }
  });

  it('identifies every device by asking who it is, over its own transport', async () => {
    for (const [driver, profile] of await shellyProfiles()) {
      expect(profile.discovery.probe, driver).toEqual({
        op: 'call',
        args: { method: 'Shelly.GetDeviceInfo' },
      });
      expect(profile.discovery.identity.externalId, driver).toBe('id');
    }
  });

  it('asks every device for its whole status now and then, and never too often', async () => {
    // The status comes on its own as notifications; the timer is what catches a device that
    // came back, and what keeps the socket busy enough to notice one that went.
    for (const [driver, profile] of await shellyProfiles()) {
      expect(
        profile.subscriptions.map((subscription) => subscription.op),
        driver,
      ).toEqual(['status']);
      expect(Number(profile.subscriptions[0]?.args['everyMs']), driver).toBeGreaterThanOrEqual(
        5000,
      );
    }
  });

  it('turns every relay and light both ways and toggles it', async () => {
    // A switch that can only be turned on is half a switch, and the omission is invisible until
    // somebody tries the other direction.
    for (const [driver, profile] of await shellyProfiles()) {
      for (const entity of profile.entities) {
        if (entity.domain !== 'switch' && entity.domain !== 'light') {
          continue;
        }

        expect(Object.keys(entity.commands), `${driver} ${entity.objectId ?? ''}`).toEqual(
          expect.arrayContaining(['on_off.turn_on', 'on_off.turn_off', 'on_off.toggle']),
        );
      }
    }
  });

  it('reads status keys quoted, since `switch:0` is not a bare identifier', async () => {
    // The quotes are load-bearing: without them the profile does not parse at all.
    const relay = (await shellyProfiles())
      .get('switch-pm')
      ?.entities.find((entity) => entity.objectId === 'switch');

    expect(relay?.state.on_off?.['isOn']).toBe("'switch:0'.output");
  });

  it('asks the same two things of every owner adding a device', async () => {
    const { vendors } = await loadBundles({
      directory: DIRECTORY,
      runtimeVersion: RUNTIME_VERSION,
    });
    const shelly = vendors.find((vendor) => vendor.manifest.id === 'shelly');

    for (const driver of shelly?.drivers ?? []) {
      expect(
        driver.setup.transport.fields.map((field) => field.key),
        driver.driverId,
      ).toEqual(['host', 'password']);
    }
  });
});
