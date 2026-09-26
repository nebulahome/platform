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

/**
 * The Shelly families spoken to over RPC - Gen2, Gen3 and Gen4 - one driver per layout of
 * components.
 */
const SHELLY_RPC_DRIVERS = [
  '3em',
  'cover-2pm',
  'cover-pm',
  'dimmer',
  'dimmer-2pm',
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
  'switch-3',
  'switch-4pm',
  'switch-pm',
];

/** The Gen1 families, spoken to over HTTP and heard over CoIoT. */
const SHELLY_GEN1_DRIVERS = [
  'gen1-3em',
  'gen1-cover-pm',
  'gen1-dimmer',
  'gen1-em',
  'gen1-inputs',
  'gen1-plug',
  'gen1-switch',
  'gen1-switch-2pm',
  'gen1-switch-pm',
];

/**
 * Some Shelly profiles, parsed the way the loader parses them, keyed by driver.
 *
 * @param drivers - Which drivers: the RPC families unless said otherwise.
 * @returns The profiles, each having passed the schema the hub applies at startup.
 */
async function shellyProfiles(
  drivers: readonly string[] = SHELLY_RPC_DRIVERS,
): Promise<Map<string, IntegrationProfile>> {
  const profiles = new Map<string, IntegrationProfile>();

  for (const driver of drivers) {
    const text = await readFile(path.join(DIRECTORY, `shelly/${driver}/profile.json`), 'utf8');

    profiles.set(driver, integrationProfileSchema.parse(JSON.parse(text)));
  }

  return profiles;
}

/**
 * Where a Shelly family names the model code it claims: `model` over RPC, `type` on a Gen1.
 *
 * @param driver - The driver.
 * @returns The path of its code condition.
 */
function codePathOf(driver: string): string {
  return SHELLY_GEN1_DRIVERS.includes(driver) ? 'type' : 'model';
}

/**
 * The model codes one profile claims.
 *
 * @param profile - The profile.
 * @param codePath - Where the codes are: `model`, or `type` on a Gen1.
 * @returns The codes in its code condition, in order.
 */
function codesOf(profile: IntegrationProfile, codePath = 'model'): string[] {
  const condition = profile.discovery.claim.find((each) => each.path === codePath);

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
      'solax',
      'sonoff',
    ]);

    for (const vendor of vendors) {
      expect(vendor.logo).toMatch(/^data:image\/svg\+xml;base64,/);
    }
  });

  it('lets the owner choose how often every polled device is read, from the profile interval', async () => {
    // A device that is asked rather than told is read on a timer, and the owner is the one who
    // knows whether every 5 s is too often for it. `polling` puts that on the form; its default
    // must be the interval the profile reads at before anyone chose, or a new device and an old
    // one of the same kind would be read at different rates for no reason.
    const { loaded } = await loadBundles({ directory: DIRECTORY, runtimeVersion: RUNTIME_VERSION });
    const claim = { deviceKey: '192.168.1.40', externalId: 'device', descriptor: {} };

    for (const bundle of loaded) {
      const kind = `${bundle.vendorId}/${bundle.driverId}`;
      const polls = bundle.integration
        .subscriptions([claim], {})
        .filter((subscription) => subscription.op === 'poll');
      const field = bundle.setup.options.fields.find((each) => each.key === 'pollInterval');

      if (polls.length === 0) {
        expect(field, `${kind} is not polled and offers no interval`).toBeUndefined();
        continue;
      }

      expect(field?.type, `${kind} is polled and offers no interval`).toBe('number');

      for (const poll of polls) {
        expect(
          field?.type === 'number' ? (field.default ?? 0) * 1000 : undefined,
          `${kind} reads every ${JSON.stringify(poll.args['everyMs'])} ms`,
        ).toBe(poll.args['everyMs']);
      }
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

  it('offers every Bambu Lab printer as its own choice, one driver per family', async () => {
    // One profile per family - the X1s, the P2S and H2S, the dual-nozzle printers, the P1s and
    // A1s - but the owner adding one is asked which printer, and the answer is what the vendor
    // page shows for the row.
    const { vendors } = await loadBundles({
      directory: DIRECTORY,
      runtimeVersion: RUNTIME_VERSION,
    });
    const bambu = vendors.find((vendor) => vendor.manifest.id === 'bambu-lab');

    expect(
      Object.fromEntries(
        bambu?.drivers.map((driver) => [driver.manifest.id, driver.manifest.models]) ?? [],
      ),
    ).toEqual({
      'bambu-lab/printer': ['X1', 'X1C', 'X1E'],
      'bambu-lab/printer-p2s-h2s': ['P2S', 'H2S'],
      'bambu-lab/printer-dual-nozzle': ['H2D', 'H2D Pro', 'H2C', 'X2D'],
      'bambu-lab/printer-p1-a1': ['P1P', 'P1S', 'A1', 'A1 mini', 'A2L'],
    });
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
  it('ships its own two transports and one declarative driver per family', async () => {
    const { vendors } = await loadBundles({
      directory: DIRECTORY,
      runtimeVersion: RUNTIME_VERSION,
    });
    const shelly = vendors.find((vendor) => vendor.manifest.id === 'shelly');

    expect(shelly?.ownTransports.map((transport) => transport.id)).toEqual([
      'shelly/rpc',
      'shelly/gen1',
    ]);
    expect([...(shelly?.transports ?? [])].sort()).toEqual(['shelly/gen1', 'shelly/rpc']);
    expect(shelly?.drivers.map((driver) => driver.driverId).sort()).toEqual(
      [...SHELLY_RPC_DRIVERS, ...SHELLY_GEN1_DRIVERS].sort(),
    );

    for (const driver of shelly?.drivers ?? []) {
      expect(driver.manifest.transport, driver.driverId).toBe(
        SHELLY_GEN1_DRIVERS.includes(driver.driverId) ? 'shelly/gen1' : 'shelly/rpc',
      );

      // Declarative is a trust boundary as much as a format: the drivers are data. The code the
      // vendor ships is the transports, and they are reviewed as code.
      expect(driver.manifest.kind, driver.driverId).toBe('declarative');
    }
  });

  it('claims every model by its hardware code, each in exactly one family', async () => {
    // `app` is the firmware's word and has changed between releases; the model code is the
    // hardware's. A code claimed by two families would leave the hub picking one by the order
    // the directories were read in - unless the two differ on the profile the device is in (a
    // 2PM over RPC) or the mode it runs in (a Gen1 2.5).
    const profiles = await shellyProfiles([...SHELLY_RPC_DRIVERS, ...SHELLY_GEN1_DRIVERS]);
    const families = new Map<string, string[]>();

    for (const [driver, profile] of profiles) {
      const codes = codesOf(profile, codePathOf(driver));

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
          profiles
            .get(driver)
            ?.discovery.claim.find((each) => each.path === 'profile' || each.path === 'mode'),
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
    const profiles = await shellyProfiles([...SHELLY_RPC_DRIVERS, ...SHELLY_GEN1_DRIVERS]);

    for (const driver of shelly?.drivers ?? []) {
      const profile = profiles.get(driver.driverId);
      const codes = profile === undefined ? [] : codesOf(profile, codePathOf(driver.driverId));

      expect(profile, driver.driverId).toBeDefined();
      expect(driver.manifest.models, driver.driverId).toEqual(
        codes.map((code) => driver.manifest.modelCodes?.[code]),
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

  it('identifies every Gen1 device by GET /shelly, and by its MAC', async () => {
    // A Gen1 has no id of the kind later generations have: its MAC is what it is known by, and
    // `/shelly` answers even with a login switched on.
    for (const [driver, profile] of await shellyProfiles(SHELLY_GEN1_DRIVERS)) {
      expect(profile.discovery.probe, driver).toEqual({ op: 'get', args: { path: '/shelly' } });
      expect(profile.discovery.identity, driver).toEqual({
        externalId: 'mac',
        model: 'type',
        swVersion: 'fw',
      });
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

  it('polls every Gen1 device every 30 s, behind the reads CoIoT asks for', async () => {
    // A Gen1 says it changed over CoIoT, and the transport reads it then; the poll is the safety
    // net for a packet lost, and the owner's to change.
    for (const [driver, profile] of await shellyProfiles(SHELLY_GEN1_DRIVERS)) {
      expect(profile.subscriptions, driver).toEqual([{ op: 'poll', args: { everyMs: 30000 } }]);
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

  it('turns every Gen1 relay and light both ways, and toggles all but the meters', async () => {
    // The EM and the 3EM take only `on` and `off` for their contactor relay; every other Gen1
    // output takes `toggle` too.
    const onOffOnly = ['gen1-em', 'gen1-3em'];

    for (const [driver, profile] of await shellyProfiles(SHELLY_GEN1_DRIVERS)) {
      for (const entity of profile.entities) {
        if (entity.domain !== 'switch' && entity.domain !== 'light') {
          continue;
        }

        const label = `${driver} ${entity.objectId ?? ''}`;
        const commands = Object.keys(entity.commands);

        expect(commands, label).toEqual(
          expect.arrayContaining(['on_off.turn_on', 'on_off.turn_off']),
        );
        expect(commands.includes('on_off.toggle'), label).toBe(!onOffOnly.includes(driver));
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

  it('asks the same things of every owner adding a device of one generation', async () => {
    // Over RPC the user is always admin; a Gen1 login's user can be changed, so it is asked.
    const { vendors } = await loadBundles({
      directory: DIRECTORY,
      runtimeVersion: RUNTIME_VERSION,
    });
    const shelly = vendors.find((vendor) => vendor.manifest.id === 'shelly');

    for (const driver of shelly?.drivers ?? []) {
      expect(
        driver.setup.transport.fields.map((field) => field.key),
        driver.driverId,
      ).toEqual(
        SHELLY_GEN1_DRIVERS.includes(driver.driverId)
          ? ['host', 'username', 'password']
          : ['host', 'password'],
      );
    }
  });

  it('links every device to the web page it serves on port 80', async () => {
    const { vendors } = await loadBundles({
      directory: DIRECTORY,
      runtimeVersion: RUNTIME_VERSION,
    });
    const shelly = vendors.find((vendor) => vendor.manifest.id === 'shelly');

    for (const driver of shelly?.drivers ?? []) {
      expect(driver.manifest.webPagePort, driver.driverId).toBe(80);
    }
  });

  it('keeps its firmware in one update entity, installing and progress included, on every family', async () => {
    for (const [driver, profile] of await shellyProfiles()) {
      const firmware = profile.entities.find((entity) => entity.objectId === 'firmware');

      expect(firmware?.domain, driver).toBe('update');
      expect(firmware?.state.update, driver).toEqual({
        installedVersion: 'device_info.ver',
        latestVersion: 'sys.available_updates.stable.version',
        isInstalling: 'ota.isInstalling',
        progress: 'ota.progress',
      });
      expect(firmware?.commands['update.install'], driver).toEqual({
        op: 'call',
        args: { method: 'Shelly.Update', params: { stage: 'stable' } },
      });
      expect(profile.device, driver).toEqual({ swVersion: 'device_info.ver' });
      expect(
        profile.entities.some((entity) => entity.objectId === 'firmware_install'),
        driver,
      ).toBe(false);
    }
  });

  it('keeps its firmware in one update entity on every Gen1 family, installing from /ota', async () => {
    for (const [driver, profile] of await shellyProfiles(SHELLY_GEN1_DRIVERS)) {
      const firmware = profile.entities.find((entity) => entity.objectId === 'firmware');

      expect(firmware?.domain, driver).toBe('update');
      expect(firmware?.state.update?.['installedVersion'], driver).toBe('update.old_version');
      expect(firmware?.state.update?.['latestVersion'], driver).toBe('update.new_version');
      expect(firmware?.commands['update.install'], driver).toEqual({
        op: 'get',
        args: { path: '/ota', query: { update: true } },
      });
      expect(profile.device, driver).toEqual({ swVersion: 'update.old_version' });
    }
  });
});

describe('the Plex bundle', () => {
  it('links the server to Plex Web, under /web on its own port', async () => {
    const { vendors } = await loadBundles({
      directory: DIRECTORY,
      runtimeVersion: RUNTIME_VERSION,
    });
    const server = vendors
      .find((vendor) => vendor.manifest.id === 'plex')
      ?.drivers.find((driver) => driver.driverId === 'server');

    expect(server?.manifest).toMatchObject({ webPagePort: 32400, webPagePath: '/web' });
  });
});
