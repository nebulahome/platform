/**
 * The Bambu Lab bundle, driven with what a printer actually publishes.
 *
 * None of this touches a printer. What it checks is the mapping: that a report the printer is
 * known to send lands on the entities it should, that a delta - which is all a P1 or an A1 ever
 * sends unasked - changes only what it names, that the answers to our own requests are ignored
 * rather than misread, and that a command is addressed to the printer's own topic with the body
 * its firmware expects. The payloads are shaped after the LAN-mode protocol as it is documented
 * by the people who reverse-engineered it; the one thing a test cannot settle is whether the
 * firmware still speaks that dialect, and the bundle's README says where to look when it does not.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseEntityId, type CapabilityState, type EntityId } from '@nebula-home/contracts';
import {
  driverManifestSchema,
  createDeclarativeIntegration,
  integrationProfileSchema,
  resolveManifest,
  vendorManifestSchema,
  type Claim,
  type Integration,
  type MappingContext,
} from '@nebula-home/package-runtime';

/** The bundle, where the service reads it from. */
const BUNDLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../bundles/bambu-lab');

/** The one driver the vendor ships, where the profile lives. */
const DRIVER = path.join(BUNDLE, 'printer');

/** A serial in the shape Bambu prints on the box. */
const SERIAL = '01P00A123456789';

/** The topic the printer reports on, as the scan sees it. */
const REPORT_TOPIC = `device/${SERIAL}/report`;

/**
 * Builds the integration the hub would build from the bundle on disk.
 *
 * @returns The integration.
 */
async function bambu(): Promise<Integration> {
  const manifest = resolveManifest(
    vendorManifestSchema.parse(
      JSON.parse(await readFile(path.join(BUNDLE, 'manifest.json'), 'utf8')),
    ),
    driverManifestSchema.parse(
      JSON.parse(await readFile(path.join(DRIVER, 'driver.json'), 'utf8')),
    ),
  );
  const profile = integrationProfileSchema.parse(
    JSON.parse(await readFile(path.join(DRIVER, 'profile.json'), 'utf8')),
  );

  return createDeclarativeIntegration(manifest, profile);
}

/**
 * Wraps a message the way the MQTT transport delivers it.
 *
 * @param message - What the printer published.
 * @returns The payload an integration sees.
 */
function onReportTopic(message: unknown): { topic: string; segments: string[]; message: unknown } {
  return { topic: REPORT_TOPIC, segments: ['device', SERIAL, 'report'], message };
}

/** A full status, as an X1 pushes it every second and a P1 answers a `pushall` with. */
const FULL_REPORT = {
  print: {
    bed_target_temper: 60,
    bed_temper: 59.8,
    nozzle_target_temper: 220,
    nozzle_temper: 219.6,
    chamber_temper: 31,
    gcode_state: 'RUNNING',
    mc_percent: 42,
    mc_remaining_time: 87,
    layer_num: 118,
    total_layer_num: 280,
    spd_lvl: 2,
    wifi_signal: '-47dBm',
    cooling_fan_speed: '15',
    lights_report: [{ node: 'chamber_light', mode: 'on' }],
    command: 'push_status',
    msg: 0,
    sequence_id: '2021',
  },
};

/** The entity ids the hub would have assigned, keyed by the profile's object ids. */
const ENTITIES = new Map<string, EntityId>(
  [
    'chamber_light',
    'nozzle_temperature',
    'nozzle_target_temperature',
    'bed_temperature',
    'bed_target_temperature',
    'chamber_temperature',
    'printing',
    'print_progress',
    'remaining_time',
    'layer',
    'total_layers',
    'speed_level',
  ].map((objectId): [string, EntityId] => [
    objectId,
    parseEntityId(
      `${objectId === 'chamber_light' ? 'light' : objectId === 'printing' ? 'binary_sensor' : 'sensor'}.x1c_${objectId}`,
    ),
  ]),
);

/**
 * The claim the integration makes for the printer.
 *
 * @returns The claim.
 */
function claim(): Claim {
  return { deviceKey: REPORT_TOPIC, externalId: SERIAL, descriptor: onReportTopic(FULL_REPORT) };
}

/**
 * A mapping context for the printer.
 *
 * @param lastState - What the entity asked about last reported.
 * @returns The context.
 */
function context(lastState?: CapabilityState): MappingContext {
  return {
    options: {},
    claim: claim(),
    entities: ENTITIES,
    lastState: (): CapabilityState | undefined => lastState,
  };
}

/**
 * Reads the reports an inbound message produces, by object id.
 *
 * @param integration - The bundle.
 * @param message - What the printer published.
 * @returns Each entity's state, keyed by the profile's object id.
 */
function statesFor(integration: Integration, message: unknown): Map<string, CapabilityState> {
  const byId = new Map([...ENTITIES].map(([objectId, entityId]) => [entityId, objectId]));
  const reports = integration.toState(
    { connectionKey: 'mqtt', deviceKey: REPORT_TOPIC, payload: onReportTopic(message) },
    context(),
  );

  return new Map(reports.map((report) => [byId.get(report.entityId) ?? '?', report.state]));
}

describe('finding the printer', () => {
  it('claims it by the serial in its topic', async () => {
    const claimed = (await bambu()).claim(
      { deviceKey: REPORT_TOPIC, payload: onReportTopic(FULL_REPORT) },
      {},
    );

    expect(claimed?.externalId).toBe(SERIAL);
  });

  it('does not claim something else talking on the broker', async () => {
    // The printer answers our own requests on the same topic. A `get_version` reply has no
    // `print` and is not a device.
    const reply = { info: { command: 'get_version', module: [{ name: 'ota', sn: SERIAL }] } };

    expect(
      (await bambu()).claim({ deviceKey: REPORT_TOPIC, payload: onReportTopic(reply) }, {}),
    ).toBeNull();
  });

  it('subscribes to the printer and asks it for everything, on its own topics', async () => {
    const subscriptions = (await bambu()).subscriptions([claim()], {});

    expect(subscriptions.map((s) => s.op)).toEqual(['topic', 'publish']);
    expect(subscriptions[0]?.args['filter']).toEqual(['device', SERIAL, 'report']);
    expect(subscriptions[1]?.args['topic']).toEqual(['device', SERIAL, 'request']);
    expect(subscriptions[1]?.args['payload']).toMatchObject({ pushing: { command: 'pushall' } });
  });

  it('names the maker, since the printer never says', async () => {
    expect((await bambu()).describe(claim(), {}).manufacturer).toBe('Bambu Lab');
  });
});

describe('reading a full report', () => {
  it('maps the temperatures', async () => {
    const states = statesFor(await bambu(), FULL_REPORT);

    expect(states.get('nozzle_temperature')).toEqual({ sensor_numeric: { value: 219.6 } });
    expect(states.get('nozzle_target_temperature')).toEqual({ sensor_numeric: { value: 220 } });
    expect(states.get('bed_temperature')).toEqual({ sensor_numeric: { value: 59.8 } });
    expect(states.get('bed_target_temperature')).toEqual({ sensor_numeric: { value: 60 } });
    expect(states.get('chamber_temperature')).toEqual({ sensor_numeric: { value: 31 } });
  });

  it('maps the print in progress', async () => {
    const states = statesFor(await bambu(), FULL_REPORT);

    expect(states.get('printing')).toEqual({ sensor_binary: { isOn: true } });
    expect(states.get('print_progress')).toEqual({ sensor_numeric: { value: 42 } });
    expect(states.get('remaining_time')).toEqual({ sensor_numeric: { value: 87 } });
    expect(states.get('layer')).toEqual({ sensor_numeric: { value: 118 } });
    expect(states.get('total_layers')).toEqual({ sensor_numeric: { value: 280 } });
    expect(states.get('speed_level')).toEqual({ sensor_numeric: { value: 2 } });
  });

  it('reads the chamber light, which the printer reports as a word', async () => {
    const states = statesFor(await bambu(), FULL_REPORT);

    expect(states.get('chamber_light')).toEqual({ on_off: { isOn: true } });
  });

  it('reads an idle printer as not printing, with the light off', async () => {
    const idle = {
      print: {
        ...FULL_REPORT.print,
        gcode_state: 'IDLE',
        lights_report: [{ node: 'chamber_light', mode: 'off' }],
      },
    };
    const states = statesFor(await bambu(), idle);

    expect(states.get('printing')).toEqual({ sensor_binary: { isOn: false } });
    expect(states.get('chamber_light')).toEqual({ on_off: { isOn: false } });
  });
});

describe('reading a delta', () => {
  it('changes only what the delta names', async () => {
    // A P1 or an A1 sends this and nothing more when the nozzle moves a tenth of a degree.
    // Everything else must be left exactly as it was - the light in particular, which a
    // comparison against a missing field would otherwise switch off.
    const delta = {
      print: { nozzle_temper: 220.1, command: 'push_status', msg: 1, sequence_id: '2022' },
    };
    const states = statesFor(await bambu(), delta);

    expect([...states.keys()]).toEqual(['nozzle_temperature']);
    expect(states.get('nozzle_temperature')).toEqual({ sensor_numeric: { value: 220.1 } });
  });

  it('says nothing about a reply to one of our own requests', async () => {
    const reply = { system: { command: 'ledctrl', sequence_id: '0', result: 'success' } };

    expect(statesFor(await bambu(), reply).size).toBe(0);
  });
});

describe('the chamber light', () => {
  it('is switched on with the request the firmware expects, on the printer topic', async () => {
    const request = (await bambu()).toCommand(
      {
        entityId: ENTITIES.get('chamber_light') ?? parseEntityId('light.x1c_chamber_light'),
        capability: 'on_off',
        command: { command: 'turn_on' },
      },
      context(),
    );

    expect(request.op).toBe('publish');
    expect(request.args['topic']).toEqual(['device', SERIAL, 'request']);
    expect(request.args['payload']).toEqual({
      system: {
        sequence_id: '0',
        command: 'ledctrl',
        led_node: 'chamber_light',
        led_mode: 'on',
        led_on_time: 500,
        led_off_time: 500,
        loop_times: 0,
        interval_time: 0,
      },
    });
  });

  it('is switched off the same way', async () => {
    const request = (await bambu()).toCommand(
      {
        entityId: ENTITIES.get('chamber_light') ?? parseEntityId('light.x1c_chamber_light'),
        capability: 'on_off',
        command: { command: 'turn_off' },
      },
      context(),
    );

    expect(request.args['payload']).toMatchObject({ system: { led_mode: 'off' } });
  });

  it('cannot be toggled, because the firmware has no toggle and a profile cannot compute one', async () => {
    // Deliberate. `core` knows the last state and could send the opposite; a profile that
    // silently sent "on" for a toggle would be worse than one that says it has no such command.
    await expect(async () =>
      (await bambu()).toCommand(
        {
          entityId: ENTITIES.get('chamber_light') ?? parseEntityId('light.x1c_chamber_light'),
          capability: 'on_off',
          command: { command: 'toggle' },
        },
        context(),
      ),
    ).rejects.toThrow(/toggle/);
  });
});
