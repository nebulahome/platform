/**
 * The Shelly families, driven with what a device actually answers.
 *
 * None of this touches a device. What it checks is the mapping of one family per kind of
 * component - a light, a cover, two relays, the meters, the inputs - from a `Shelly.GetStatus`
 * shaped after the examples in Shelly's API docs, and the request a command becomes. The one
 * thing a test cannot settle is the model codes themselves; the bundle's README says how to
 * read the one a device answers with.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseEntityId, type CapabilityState, type EntityId } from '@nebula-home/contracts';
import {
  associateModel,
  createDeclarativeIntegration,
  driverManifestSchema,
  identifySighting,
  integrationProfileSchema,
  resolveManifest,
  vendorManifestSchema,
  type Claim,
  type Integration,
  type MappingContext,
} from '@nebula-home/package-runtime';

import { loadBundles } from './bundles.js';

/** The bundle, where the service reads it from. */
const BUNDLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../bundles/shelly');

/** The address the owner typed. */
const HOST = '192.168.1.40';

/** A family, built the way the hub builds it, with the entity ids the hub would assign. */
type Family = {
  readonly integration: Integration;
  readonly entities: ReadonlyMap<string, EntityId>;
};

/**
 * Builds one family's integration as the hub would.
 *
 * @param driver - The driver directory.
 * @returns The integration and the ids of its entities, keyed by object id.
 */
async function family(driver: string): Promise<Family> {
  const vendor = vendorManifestSchema.parse(
    JSON.parse(await readFile(path.join(BUNDLE, 'manifest.json'), 'utf8')),
  );
  const manifest = resolveManifest(
    vendor,
    driverManifestSchema.parse(
      JSON.parse(await readFile(path.join(BUNDLE, driver, 'driver.json'), 'utf8')),
    ),
  );
  const profile = integrationProfileSchema.parse(
    JSON.parse(await readFile(path.join(BUNDLE, driver, 'profile.json'), 'utf8')),
  );
  const entities = new Map<string, EntityId>(
    profile.entities.map((entity): [string, EntityId] => [
      entity.objectId ?? '',
      parseEntityId(`${entity.domain}.lab_${entity.objectId ?? 'device'}`),
    ]),
  );

  return { integration: createDeclarativeIntegration(manifest, profile), entities };
}

/**
 * A mapping context for a claimed device.
 *
 * @param entities - The ids the hub assigned.
 * @param info - What `Shelly.GetDeviceInfo` answered.
 * @returns The context.
 */
function context(
  entities: ReadonlyMap<string, EntityId>,
  info: Record<string, unknown>,
): MappingContext {
  const claim: Claim = { deviceKey: HOST, externalId: String(info['id']), descriptor: info };

  return { options: {}, claim, entities, lastState: (): CapabilityState | undefined => undefined };
}

/**
 * Reads the states a status produces, by object id.
 *
 * @param built - The family.
 * @param status - What `Shelly.GetStatus` answered, as the transport delivers it.
 * @returns Each entity's state, keyed by object id.
 */
function statesFor(built: Family, status: unknown): Map<string, CapabilityState> {
  const byId = new Map([...built.entities].map(([objectId, entityId]) => [entityId, objectId]));
  const reports = built.integration.toState(
    { connectionKey: `shelly/rpc:${HOST}`, deviceKey: HOST, payload: status },
    context(built.entities, { id: 'shelly-lab' }),
  );

  return new Map(reports.map((report) => [byId.get(report.entityId) ?? '?', report.state]));
}

/**
 * The id of one of a family's entities.
 *
 * @param built - The family.
 * @param objectId - Which entity.
 * @returns Its id.
 * @throws {Error} When the family has no such entity, which is a mistake in the test.
 */
function entityOf(built: Family, objectId: string): EntityId {
  const found = built.entities.get(objectId);

  if (found === undefined) {
    throw new Error(`The family has no ${objectId}`);
  }

  return found;
}

/** What a Dimmer 0/1-10V PM Gen3 says of itself. */
const DIMMER_INFO = {
  id: 'shelly0110dimg3-aabbccddeeff',
  name: 'Studio',
  model: 'S3DM-0010WW',
  gen: 3,
  ver: '1.5.0',
  app: 'Dimmer0110VPMG3',
  auth_en: false,
};

/** A dimmer that is on at 62%, drawing 18.4 W. */
const DIMMER_STATUS = {
  sys: { mac: 'AABBCCDDEEFF' },
  'input:0': { id: 0, state: null },
  'input:1': { id: 1, state: null },
  'light:0': {
    id: 0,
    source: 'init',
    output: true,
    brightness: 62,
    apower: 18.4,
    voltage: 231.1,
    current: 0.09,
    aenergy: { total: 1234.5, by_minute: [0, 0, 0], minute_ts: 1 },
    temperature: { tC: 38.6, tF: 101.5 },
  },
};

describe('the dimmer family', () => {
  it('claims a Dimmer 0/1-10V PM Gen3 by its model code, and not a 1PM', async () => {
    const { integration } = await family('dimmer-pm');

    expect(integration.claim({ deviceKey: HOST, payload: DIMMER_INFO }, {})?.externalId).toBe(
      DIMMER_INFO.id,
    );
    expect(
      integration.claim(
        { deviceKey: HOST, payload: { ...DIMMER_INFO, model: 'S3SW-001P16EU' } },
        {},
      ),
    ).toBeNull();
  });

  it('describes the device by what it said of itself', async () => {
    const { integration } = await family('dimmer-pm');
    const claim: Claim = { deviceKey: HOST, externalId: DIMMER_INFO.id, descriptor: DIMMER_INFO };

    expect(integration.describe(claim, {})).toMatchObject({
      name: 'Studio',
      manufacturer: 'Shelly',
      model: 'S3DM-0010WW',
      swVersion: '1.5.0',
    });
  });

  it('reads the light and its five readings out of a status', async () => {
    const states = statesFor(await family('dimmer-pm'), DIMMER_STATUS);

    expect(states.get('light')).toEqual({ on_off: { isOn: true }, level: { level: 62 } });
    expect(states.get('power')).toEqual({ sensor_numeric: { value: 18.4 } });
    expect(states.get('energy')).toEqual({ sensor_numeric: { value: 1234.5 } });
    expect(states.get('voltage')).toEqual({ sensor_numeric: { value: 231.1 } });
    expect(states.get('current')).toEqual({ sensor_numeric: { value: 0.09 } });
    expect(states.get('temperature')).toEqual({ sensor_numeric: { value: 38.6 } });
  });

  it('sets a level by switching the light on at that brightness', async () => {
    // A level is what the lamp shows; a lamp that is off shows none. Setting 30% switches it on.
    const built = await family('dimmer-pm');

    expect(
      built.integration.toCommand(
        {
          entityId: entityOf(built, 'light'),
          capability: 'level',
          command: { command: 'set_level', level: 30 },
        },
        context(built.entities, DIMMER_INFO),
      ),
    ).toEqual({
      deviceKey: HOST,
      op: 'call',
      args: { method: 'Light.Set', params: { id: 0, on: true, brightness: 30 } },
    });
  });

  it('asks the transport for the status of the one device it drives', async () => {
    const { integration } = await family('dimmer-pm');
    const claim: Claim = { deviceKey: HOST, externalId: DIMMER_INFO.id, descriptor: DIMMER_INFO };

    expect(integration.subscriptions([claim], {})).toEqual([
      { op: 'status', args: { deviceKey: HOST, everyMs: 60000 } },
    ]);
  });

  it('claims the plain Dimmer Gen3 too, whose readings need a neutral wire', async () => {
    const { integration } = await family('dimmer-pm');

    expect(
      integration.claim(
        { deviceKey: HOST, payload: { ...DIMMER_INFO, model: 'S3DM-0A101WWL' } },
        {},
      ),
    ).not.toBeNull();
  });
});

describe('the cover family', () => {
  /** A 2PM Gen3 in its cover profile. */
  const INFO = { id: 'shelly2pmg3-aabbccddeeff', model: 'S3SW-002P16EU', gen: 3, profile: 'cover' };

  /** A cover opening, at 40%, as the docs' example has it. */
  const COVER = {
    id: 0,
    source: 'limit_switch',
    state: 'opening',
    apower: 60,
    voltage: 233,
    current: 0.3,
    aenergy: { total: 48.996 },
    temperature: { tC: 55.4 },
    pos_control: true,
    current_pos: 40,
  };

  it('claims a 2PM only in its cover profile', async () => {
    const { integration } = await family('cover-pm');

    expect(integration.claim({ deviceKey: HOST, payload: INFO }, {})).not.toBeNull();
    expect(
      integration.claim({ deviceKey: HOST, payload: { ...INFO, profile: 'switch' } }, {}),
    ).toBeNull();
  });

  it('reads the position and turns the state word into a motion', async () => {
    const built = await family('cover-pm');

    expect(statesFor(built, { 'cover:0': COVER }).get('cover')).toEqual({
      cover: { position: 40, motion: 'opening' },
    });
    // `closed`, `open`, `stopped` and `calibrating` are all a cover that is not moving.
    expect(statesFor(built, { 'cover:0': { ...COVER, state: 'closed' } }).get('cover')).toEqual({
      cover: { position: 40, motion: 'stopped' },
    });
  });

  it('says nothing of a cover that has never been calibrated', async () => {
    // Without calibration there is no position, and `position` is required: a cover that
    // reported a motion and no position would be a state the capability cannot hold.
    const built = await family('cover-pm');
    const uncalibrated = Object.fromEntries(
      Object.entries(COVER).filter(([key]) => key !== 'current_pos'),
    );

    expect(statesFor(built, { 'cover:0': uncalibrated }).get('cover')).toBeUndefined();
  });

  it('moves the cover to a position', async () => {
    const built = await family('cover-pm');

    expect(
      built.integration.toCommand(
        {
          entityId: entityOf(built, 'cover'),
          capability: 'cover',
          command: { command: 'set_position', position: 75 },
        },
        context(built.entities, INFO),
      ).args,
    ).toEqual({ method: 'Cover.GoToPosition', params: { id: 0, pos: 75 } });
  });
});

describe('the two-relay family', () => {
  /** A 2PM Gen3 in its switch profile. */
  const INFO = { id: 'shelly2pmg3-aabbccddeeff', model: 'S3SW-002P16EU', profile: 'switch' };

  it('claims the same 2PM only in its switch profile', async () => {
    const { integration } = await family('switch-2pm');

    expect(integration.claim({ deviceKey: HOST, payload: INFO }, {})).not.toBeNull();
    expect(
      integration.claim({ deviceKey: HOST, payload: { ...INFO, profile: 'cover' } }, {}),
    ).toBeNull();
  });

  it('numbers the relays and their readings from one', async () => {
    const states = statesFor(await family('switch-2pm'), {
      'switch:0': {
        id: 0,
        output: true,
        apower: 5,
        voltage: 230,
        current: 0.02,
        aenergy: { total: 1 },
        temperature: { tC: 40 },
      },
      'switch:1': {
        id: 1,
        output: false,
        apower: 0,
        voltage: 230,
        current: 0,
        aenergy: { total: 2 },
      },
    });

    expect(states.get('switch_1')).toEqual({ on_off: { isOn: true } });
    expect(states.get('switch_2')).toEqual({ on_off: { isOn: false } });
    expect(states.get('energy_2')).toEqual({ sensor_numeric: { value: 2 } });
    expect(states.get('temperature')).toEqual({ sensor_numeric: { value: 40 } });
  });

  it('addresses the second relay by its component id', async () => {
    const built = await family('switch-2pm');

    expect(
      built.integration.toCommand(
        {
          entityId: entityOf(built, 'switch_2'),
          capability: 'on_off',
          command: { command: 'turn_off' },
        },
        context(built.entities, INFO),
      ).args,
    ).toEqual({ method: 'Switch.Set', params: { id: 1, on: false } });
  });
});

describe('the meters and the inputs', () => {
  it('reads a three-phase meter per phase and in total', async () => {
    const states = statesFor(await family('3em'), {
      'em:0': {
        id: 0,
        a_current: 4.029,
        a_voltage: 236.1,
        a_act_power: 951.2,
        b_current: 4.027,
        b_voltage: 236.201,
        b_act_power: -951.1,
        c_current: 3.03,
        c_voltage: 236.402,
        c_act_power: 715.4,
        total_current: 11.083,
        total_act_power: 2484.782,
      },
      'emdata:0': {
        id: 0,
        a_total_act_energy: 10,
        b_total_act_energy: 20,
        c_total_act_energy: 30,
        total_act: 60,
        total_act_ret: 1,
      },
    });

    // A phase feeding the grid reads negative, and stays negative.
    expect(states.get('power_b')).toEqual({ sensor_numeric: { value: -951.1 } });
    expect(states.get('power_total')).toEqual({ sensor_numeric: { value: 2484.782 } });
    expect(states.get('energy_total')).toEqual({ sensor_numeric: { value: 60 } });
    expect(states.get('energy_returned_total')).toEqual({ sensor_numeric: { value: 1 } });
  });

  it('claims a 3EM only in its three-phase profile', async () => {
    const { integration } = await family('3em');
    const info = { id: 'shelly3emg3-aabbccddeeff', model: 'S3EM-003CXCEU63', profile: 'triphase' };

    expect(integration.claim({ deviceKey: HOST, payload: info }, {})).not.toBeNull();
    expect(
      integration.claim({ deviceKey: HOST, payload: { ...info, profile: 'monophase' } }, {}),
    ).toBeNull();
  });

  it('reads a PM Mini, returned energy included', async () => {
    const states = statesFor(await family('pm'), {
      'pm1:0': {
        id: 0,
        voltage: 225.9,
        current: 0,
        apower: 0,
        freq: 50,
        aenergy: { total: 11.679 },
        ret_aenergy: { total: 4.126 },
      },
    });

    expect(states.get('frequency')).toEqual({ sensor_numeric: { value: 50 } });
    expect(states.get('energy_returned')).toEqual({ sensor_numeric: { value: 4.126 } });
  });

  it('reads an EM channel, its power factor a bare ratio', async () => {
    const states = statesFor(await family('em-2'), {
      'switch:0': { id: 0, output: false },
      'em1:0': { id: 0, voltage: 236.1, current: 4.029, act_power: 951.2, pf: 0.98, freq: 50 },
      'em1:1': { id: 1, voltage: 236.1, current: 0, act_power: 0, pf: 0, freq: 50 },
      'em1data:0': { id: 0, total_act_energy: 1500, total_act_ret_energy: 0 },
      'em1data:1': { id: 1, total_act_energy: 20, total_act_ret_energy: 5 },
    });

    expect(states.get('switch')).toEqual({ on_off: { isOn: false } });
    expect(states.get('power_1')).toEqual({ sensor_numeric: { value: 951.2 } });
    expect(states.get('power_factor_1')).toEqual({ sensor_numeric: { value: 0.98 } });
    expect(states.get('energy_returned_2')).toEqual({ sensor_numeric: { value: 5 } });
    expect(states.get('frequency')).toEqual({ sensor_numeric: { value: 50 } });
  });

  it('reads an input in switch mode, and says nothing of one in button mode', async () => {
    // A button reports presses as events, which are not state; its `state` is null.
    const states = statesFor(await family('inputs'), {
      'input:0': { id: 0, state: true },
      'input:1': { id: 1, state: null },
    });

    expect(states.get('input_1')).toEqual({ sensor_binary: { isOn: true } });
    expect(states.get('input_2')).toBeUndefined();
  });
});

describe('discovering a Shelly', () => {
  /**
   * Loads the Shelly vendor as the hub does, and answers what discovery would for one device.
   *
   * @param info - What `Shelly.GetDeviceInfo` answered.
   * @returns The driver and the model the device is taken as, or null when none takes it.
   */
  async function discovered(info: Record<string, unknown>) {
    const { vendors, failures } = await loadBundles({
      directory: path.dirname(BUNDLE),
      runtimeVersion: '1.1.0',
    });
    const shelly = vendors.find((vendor) => vendor.manifest.id === 'shelly');
    const plan = shelly?.discovery?.plan;

    expect(failures.filter((failure) => failure.directory.includes('shelly'))).toEqual([]);

    if (shelly === undefined || plan === undefined) {
      throw new Error('The Shelly vendor declares no discovery');
    }

    const identity = identifySighting(plan, info);

    return {
      identity,
      association: associateModel(plan, identity.modelCode, (driverId) =>
        shelly.drivers
          .filter((driver) => driver.driverId === driverId)
          .some(
            (driver) => driver.integration.claim({ deviceKey: HOST, payload: info }, {}) !== null,
          ),
      ),
    };
  }

  it('listens for _shelly._tcp and asks the device who it is', async () => {
    const { vendors } = await loadBundles({
      directory: path.dirname(BUNDLE),
      runtimeVersion: '1.1.0',
    });
    const shelly = vendors.find((vendor) => vendor.manifest.id === 'shelly');

    expect(shelly?.discovery?.sources).toEqual([{ kind: 'mdns', service: '_shelly._tcp' }]);
    expect(shelly?.discovery?.plan.discovery.probe).toEqual({
      transport: 'shelly/rpc',
      op: 'call',
      args: { method: 'Shelly.GetDeviceInfo' },
    });
  });

  it('takes a 1PM Mini Gen3 as the metered relay, by its model code, and names it', async () => {
    const { identity, association } = await discovered({
      id: 'shelly1pmminig3-84fce63bd1a0',
      name: 'Hall light',
      model: 'S3SW-001P8EU',
      gen: 3,
      ver: '1.4.4',
    });

    expect(identity).toEqual({
      externalId: 'shelly1pmminig3-84fce63bd1a0',
      name: 'Hall light',
      modelCode: 'S3SW-001P8EU',
      swVersion: '1.4.4',
    });
    expect(association).toEqual({
      driverId: 'switch-pm',
      model: '1PM Mini Gen3',
      modelChoices: ['1PM Mini Gen3'],
    });
  });

  it('tells a 2PM running as a cover from one running as two relays, by its profile', async () => {
    const cover = await discovered({
      id: 'shelly2pmg3-1',
      model: 'S3SW-002P16EU',
      profile: 'cover',
    });
    const relays = await discovered({
      id: 'shelly2pmg3-2',
      model: 'S4SW-002P16EU',
      profile: 'switch',
    });

    expect(cover.association).toMatchObject({ driverId: 'cover-pm', model: '2PM Gen3 (cover)' });
    expect(relays.association).toMatchObject({
      driverId: 'switch-2pm',
      model: '2PM Gen4 (relays)',
    });
  });

  it('maps every code a driver claims onto one of its models', async () => {
    // A code a claim accepts but no model is named for would be adopted with a model the form
    // then has to ask for: every one the bundle knows should say which it is.
    const { vendors } = await loadBundles({
      directory: path.dirname(BUNDLE),
      runtimeVersion: '1.1.0',
    });
    const shelly = vendors.find((vendor) => vendor.manifest.id === 'shelly');

    for (const driver of shelly?.drivers ?? []) {
      const profile = integrationProfileSchema.parse(
        JSON.parse(await readFile(path.join(driver.directory, 'profile.json'), 'utf8')),
      );
      const codes = profile.discovery.claim.flatMap((condition) =>
        'oneOf' in condition && condition.path === 'model' ? condition.oneOf : [],
      );

      expect(Object.keys(driver.manifest.modelCodes ?? {}).sort()).toEqual(
        codes.map(String).sort(),
      );
    }
  });

  it('proposes nothing for a Shelly of a family the bundle does not drive', async () => {
    const { association } = await discovered({ id: 'shellyplusht-1', model: 'SNSN-0013A' });

    expect(association).toBeNull();
  });
});
