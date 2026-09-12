/**
 * The bundles that ship with the hub.
 *
 * They are loaded at startup from `HUB_BUNDLE_DIR`, which means a typo in one of them is not a
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

import { integrationProfileSchema } from '@nebula-home/package-runtime';

import { RUNTIME_VERSION } from '../config.js';

import { loadBundles } from './bundles.js';

/** The `bundles/` directory beside the application, as the service reads it. */
const DIRECTORY = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../bundles');

/**
 * The Shelly's profile, parsed the way the loader parses it.
 *
 * @returns The profile, having passed the same schema the hub applies at startup.
 */
async function shellyProfile() {
  const text = await readFile(path.join(DIRECTORY, 'shelly/1pm-mini-g3/profile.json'), 'utf8');

  return integrationProfileSchema.parse(JSON.parse(text));
}

describe('the bundles that ship', () => {
  it('all load, with nothing skipped', async () => {
    const result = await loadBundles({ directory: DIRECTORY, runtimeVersion: RUNTIME_VERSION });

    // The assertion that matters. A bundle this repository ships and the hub silently skips is
    // the failure this file exists to prevent.
    expect(result.failures).toEqual([]);
    expect(result.loaded.length).toBeGreaterThan(0);
  });

  it('ships Shelly and Bambu Lab as vendors, each with a logo the interface can show', async () => {
    const { vendors } = await loadBundles({
      directory: DIRECTORY,
      runtimeVersion: RUNTIME_VERSION,
    });

    expect(vendors.map((vendor) => vendor.manifest.id).sort()).toEqual(['bambu-lab', 'shelly']);

    for (const vendor of vendors) {
      expect(vendor.logo).toMatch(/^data:image\/svg\+xml;base64,/);
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

  it('includes the Shelly 1PM Mini, over HTTP and declarative', async () => {
    const { loaded } = await loadBundles({
      directory: DIRECTORY,
      runtimeVersion: RUNTIME_VERSION,
    });

    const shelly = loaded.find((one) => one.manifest.id === 'shelly/1pm-mini-g3');

    expect(shelly).toBeDefined();
    expect(shelly?.manifest.transport).toBe('http');

    // Declarative is a trust boundary as much as a format: this bundle is data, and data cannot
    // run anything.
    expect(shelly?.manifest.kind).toBe('declarative');
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

  it('describes the relay and the five readings a 1PM reports', async () => {
    const profile = await shellyProfile();

    expect(profile.entities.map((entity) => entity.objectId)).toEqual([
      'switch',
      'power',
      'energy',
      'voltage',
      'current',
      'temperature',
    ]);
  });

  it('reads Shelly status keys, which are not bare identifiers', async () => {
    const profile = await shellyProfile();
    const relay = profile.entities.find((entity) => entity.objectId === 'switch');

    // Shelly names the key `switch:0`, and a colon is not an identifier in the path grammar. The
    // quotes are load-bearing; without them the profile does not parse at all.
    expect(relay?.state.on_off?.['isOn']).toBe("'switch:0'.output");
  });

  it('can turn the relay both ways and toggle it', async () => {
    const profile = await shellyProfile();
    const relay = profile.entities.find((entity) => entity.objectId === 'switch');

    // A switch that can only be turned on is half a switch, and the omission is invisible until
    // somebody tries the other direction.
    expect(Object.keys(relay?.commands ?? {}).sort()).toEqual([
      'on_off.toggle',
      'on_off.turn_off',
      'on_off.turn_on',
    ]);
  });

  it('polls slowly enough not to sit on the device', async () => {
    const profile = await shellyProfile();
    const [poll] = profile.subscriptions;

    expect(poll?.op).toBe('poll');
    expect(Number(poll?.args['everyMs'])).toBeGreaterThanOrEqual(1000);
  });

  it('claims a device by what its firmware calls itself', async () => {
    const profile = await shellyProfile();

    // The one fact here not checked against hardware. If a real 1PM Mini is not adopted, this is
    // the line to compare against `/rpc/Shelly.GetDeviceInfo`.
    expect(profile.discovery.claim).toContainEqual({ path: 'app', equals: 'Mini1PMG3' });
  });
});
