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
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseEntityId, type CapabilityState, type EntityId } from '@nebulahome/contracts';
import {
  driverManifestSchema,
  createDeclarativeIntegration,
  integrationProfileSchema,
  resolveManifest,
  vendorManifestSchema,
  type Claim,
  type Integration,
  type MappingContext,
} from '@nebulahome/package-runtime';

/** The bundle, where the service reads it from. */
const BUNDLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../bundles/bambu-lab');

/** The drivers, one per family of printers. */
const DRIVERS = ['printer', 'printer-p2s-h2s', 'printer-dual-nozzle', 'printer-p1-a1'] as const;

/** One of them. */
type Driver = (typeof DRIVERS)[number];

/** A serial in the shape Bambu prints on the box. */
const SERIAL = '01P00A123456789';

/** The topic the printer reports on, as the scan sees it. */
const REPORT_TOPIC = `device/${SERIAL}/report`;

/**
 * Builds the integration the hub would build from the bundle on disk.
 *
 * @param driver - Which family's driver; the X1's when not said.
 * @returns The integration.
 */
async function bambu(driver: Driver = 'printer'): Promise<Integration> {
  const directory = path.join(BUNDLE, driver);
  const manifest = resolveManifest(
    vendorManifestSchema.parse(
      JSON.parse(await readFile(path.join(BUNDLE, 'manifest.json'), 'utf8')),
    ),
    driverManifestSchema.parse(
      JSON.parse(await readFile(path.join(directory, 'driver.json'), 'utf8')),
    ),
  );
  const profile = integrationProfileSchema.parse(
    JSON.parse(await readFile(path.join(directory, 'profile.json'), 'utf8')),
  );

  return createDeclarativeIntegration(manifest, profile);
}

/**
 * The entity ids the hub would have assigned a driver's entities, keyed by their object ids.
 *
 * @param driver - Which family's driver.
 * @returns The ids.
 */
function entitiesOf(driver: Driver): Map<string, EntityId> {
  const profile = integrationProfileSchema.parse(
    JSON.parse(readFileSync(path.join(BUNDLE, driver, 'profile.json'), 'utf8')),
  );

  return new Map(
    profile.entities.map((entity): [string, EntityId] => [
      entity.objectId ?? entity.domain,
      parseEntityId(`${entity.domain}.printer_${entity.objectId ?? entity.domain}`),
    ]),
  );
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

/** The X1's entity ids. */
const ENTITIES = entitiesOf('printer');

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
 * @param driver - Which family's driver.
 * @returns The context.
 */
function context(driver: Driver = 'printer'): MappingContext {
  return {
    options: {},
    claim: claim(),
    entities: entitiesOf(driver),
    lastState: (): CapabilityState | undefined => undefined,
  };
}

/**
 * Reads the reports an inbound message produces, by object id.
 *
 * Buttons are left out: they are reported, empty, on anything the printer says, which is what
 * makes them available with it, and they say nothing about the message.
 *
 * @param integration - The bundle.
 * @param message - What the printer published.
 * @param driver - Which family's driver it is.
 * @returns Each entity's state, keyed by the profile's object id.
 */
function statesFor(
  integration: Integration,
  message: unknown,
  driver: Driver = 'printer',
): Map<string, CapabilityState> {
  const entities = entitiesOf(driver);
  const byId = new Map([...entities].map(([objectId, entityId]) => [entityId, objectId]));
  const reports = integration.toState(
    { connectionKey: 'mqtt', deviceKey: REPORT_TOPIC, payload: onReportTopic(message) },
    context(driver),
  );

  return new Map(
    reports
      .filter((report) => !report.entityId.startsWith('button.'))
      .map((report) => [byId.get(report.entityId) ?? '?', report.state]),
  );
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

  it('registers duration in the catalogue canonical unit', async () => {
    // The printer speaks minutes; the entity column must say seconds, matching the published number.
    const remaining = (await bambu())
      .describe(claim(), {})
      .entities.find((entity) => entity.objectId === 'remaining_time');

    expect(remaining).toMatchObject({
      deviceClass: 'duration',
      unitOfMeasurement: 's',
      stateClass: 'measurement',
    });
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
    expect(states.get('remaining_time')).toEqual({ sensor_numeric: { value: 5220 } });
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

describe('the families', () => {
  it('reads both nozzles of a dual-nozzle printer out of the numbers they are packed in', async () => {
    // Current temperature in the low 16 bits, target in the high: 220 << 16 | 218, 0 << 16 | 38.
    const report = {
      print: {
        device: {
          extruder: {
            info: [
              { id: 0, temp: (220 << 16) | 218 },
              { id: 1, temp: 38 },
            ],
          },
          bed: { info: { temp: (65 << 16) | 64 } },
          ctc: { info: { temp: (45 << 16) | 41 } },
        },
      },
    };
    const states = statesFor(await bambu('printer-dual-nozzle'), report, 'printer-dual-nozzle');

    expect(states.get('right_nozzle_temperature')).toEqual({ sensor_numeric: { value: 218 } });
    expect(states.get('right_nozzle_target_temperature')).toEqual({
      sensor_numeric: { value: 220 },
    });
    expect(states.get('left_nozzle_temperature')).toEqual({ sensor_numeric: { value: 38 } });
    expect(states.get('left_nozzle_target_temperature')).toEqual({ sensor_numeric: { value: 0 } });
    expect(states.get('bed_temperature')).toEqual({ sensor_numeric: { value: 64 } });
    expect(states.get('bed_target_temperature')).toEqual({ sensor_numeric: { value: 65 } });
    expect(states.get('chamber_temperature')).toEqual({ sensor_numeric: { value: 41 } });
    expect(states.get('chamber_target_temperature')).toEqual({ sensor_numeric: { value: 45 } });
  });

  it('reads the door of an H2 from its status word, and of an X1 from its home flags', async () => {
    const h2 = await bambu('printer-dual-nozzle');
    const x1 = await bambu();
    const doorOf = (message: unknown, driver: Driver): CapabilityState | undefined =>
      statesFor(driver === 'printer' ? x1 : h2, message, driver).get('door');

    expect(doorOf({ print: { stat: '46A58008' } }, 'printer-dual-nozzle')).toEqual({
      sensor_binary: { isOn: true },
    });
    expect(doorOf({ print: { stat: '46258008' } }, 'printer-dual-nozzle')).toEqual({
      sensor_binary: { isOn: false },
    });
    expect(doorOf({ print: { home_flag: -1_058_546_177 } }, 'printer')).toEqual({
      sensor_binary: { isOn: true },
    });
    expect(doorOf({ print: { home_flag: -1_066_934_785 } }, 'printer')).toEqual({
      sensor_binary: { isOn: false },
    });
  });

  it('has no chamber sensor on a P1 or an A1, which report a number there that means nothing', async () => {
    const states = statesFor(await bambu('printer-p1-a1'), FULL_REPORT, 'printer-p1-a1');

    expect(states.has('chamber_temperature')).toBe(false);
    expect(states.get('nozzle_temperature')).toEqual({ sensor_numeric: { value: 219.6 } });
  });

  it('switches both light bars of an H2 or an X2D with one command, one message each', async () => {
    const request = (await bambu('printer-dual-nozzle')).toCommand(
      {
        entityId: parseEntityId('light.printer_chamber_light'),
        capability: 'on_off',
        command: { command: 'turn_on' },
      },
      context('printer-dual-nozzle'),
    );

    expect(request.args['payload']).toBeUndefined();
    expect(request.args['payloads']).toMatchObject([
      { system: { led_node: 'chamber_light', led_mode: 'on' } },
      { system: { led_node: 'chamber_light2', led_mode: 'on' } },
    ]);
  });

  it('maps every model a driver lists to a code discovery reads', async () => {
    for (const driver of DRIVERS) {
      const manifest = driverManifestSchema.parse(
        JSON.parse(await readFile(path.join(BUNDLE, driver, 'driver.json'), 'utf8')),
      );
      const coded = new Set(Object.values(manifest.modelCodes ?? {}).flat());

      expect([...coded].sort(), driver).toEqual([...manifest.models].sort());
    }
  });
});

describe('the print', () => {
  it('says what the printer is doing, in words', async () => {
    const states = statesFor(await bambu(), {
      print: {
        gcode_state: 'PAUSE',
        stg_cur: 16,
        print_type: 'local',
        subtask_name: 'Benchy',
        gcode_file: '/data/Metadata/plate_1.gcode',
        print_error: 0,
        hms: [],
      },
    });

    expect(states.get('print_status')).toEqual({ sensor_text: { value: 'Paused' } });
    expect(states.get('stage')).toEqual({ sensor_text: { value: 'Paused by the user' } });
    expect(states.get('print_source')).toEqual({ sensor_text: { value: 'Local' } });
    expect(states.get('print_name')).toEqual({ sensor_text: { value: 'Benchy' } });
    expect(states.get('gcode_file')).toEqual({
      sensor_text: { value: '/data/Metadata/plate_1.gcode' },
    });
    expect(states.get('print_error')).toEqual({ sensor_binary: { isOn: false } });
    expect(states.get('health_alerts')).toEqual({ sensor_binary: { isOn: false } });
  });

  it('reads an idle printer the way either firmware says it', async () => {
    const x1 = await bambu();

    expect(statesFor(x1, { print: { stg_cur: -1 } }).get('stage')).toEqual({
      sensor_text: { value: 'Idle' },
    });
    expect(statesFor(x1, { print: { stg_cur: 255 } }).get('stage')).toEqual({
      sensor_text: { value: 'Idle' },
    });
  });

  it('raises an alert while the printer lists one, and an error while it reports one', async () => {
    const states = statesFor(await bambu(), {
      print: { print_error: 50_348_044, hms: [{ attr: 50_331_904, code: 131_073 }] },
    });

    expect(states.get('print_error')).toEqual({ sensor_binary: { isOn: true } });
    expect(states.get('health_alerts')).toEqual({ sensor_binary: { isOn: true } });
  });

  it('reads the fans in the tens of per cent the printer shows', async () => {
    const states = statesFor(await bambu(), {
      print: {
        cooling_fan_speed: '15',
        big_fan1_speed: '0',
        big_fan2_speed: '7',
        heatbreak_fan_speed: '10',
      },
    });

    expect(states.get('part_cooling_fan')).toEqual({ sensor_numeric: { value: 100 } });
    expect(states.get('auxiliary_fan')).toEqual({ sensor_numeric: { value: 0 } });
    expect(states.get('chamber_fan')).toEqual({ sensor_numeric: { value: 50 } });
    expect(states.get('heatbreak_fan')).toEqual({ sensor_numeric: { value: 70 } });
  });

  it('says whether the firmware takes commands from the LAN unsigned', async () => {
    const x1 = await bambu();

    expect(statesFor(x1, { print: { fun: '3EC18FFF9CFF' } }).get('developer_mode')).toEqual({
      sensor_binary: { isOn: true },
    });
    expect(statesFor(x1, { print: { fun: '3EC1AFFF9CFF' } }).get('developer_mode')).toEqual({
      sensor_binary: { isOn: false },
    });
  });

  it('reads the first AMS, whose readings arrive as text', async () => {
    const states = statesFor(await bambu(), {
      print: { ams: { ams: [{ id: '0', humidity: '4', humidity_raw: '23', temp: '24.6' }] } },
    });

    expect(states.get('ams_humidity')).toEqual({ sensor_numeric: { value: 23 } });
    expect(states.get('ams_temperature')).toEqual({ sensor_numeric: { value: 24.6 } });
  });

  it('stops a print with the request the firmware expects, and asks first', async () => {
    const integration = await bambu();
    const request = integration.toCommand(
      {
        entityId: parseEntityId('button.printer_stop'),
        capability: 'button',
        command: { command: 'press' },
      },
      context(),
    );

    expect(request.args['topic']).toEqual(['device', SERIAL, 'request']);
    expect(request.args['payload']).toEqual({
      print: { sequence_id: '0', command: 'stop', param: '' },
    });
    expect(
      integration.describe(claim(), {}).entities.find((entity) => entity.objectId === 'stop')
        ?.deviceClass,
    ).toBe('stop');
  });
});

describe('the camera', () => {
  it('streams over RTSP on an X1, an H2 or an X2D, while LAN Mode Liveview is on', async () => {
    const x1 = await bambu();
    const camera = parseEntityId('camera.printer_chamber_camera');

    expect(x1.streamOf?.(camera, context())).toEqual({
      source: 'bambu-lab/camera',
      args: { kind: 'rtsp' },
    });
    expect(
      statesFor(x1, {
        print: { ipcam: { rtsp_url: 'rtsps://192.168.1.60/streaming/live/1' } },
      }).get('chamber_camera'),
    ).toMatchObject({ camera: { isStreamAvailable: true } });
    expect(
      statesFor(x1, { print: { ipcam: { rtsp_url: 'disable' } } }).get('chamber_camera'),
    ).toMatchObject({ camera: { isStreamAvailable: false } });
  });

  it('sends stills on a P1, an A1 or an A2L, from the camera it says it has', async () => {
    const p1 = await bambu('printer-p1-a1');

    expect(
      p1.streamOf?.(parseEntityId('camera.printer_chamber_camera'), context('printer-p1-a1')),
    ).toEqual({ source: 'bambu-lab/camera', args: { kind: 'chamber-image' } });
    expect(
      statesFor(p1, { print: { ipcam: { ipcam_dev: '1' } } }, 'printer-p1-a1').get(
        'chamber_camera',
      ),
    ).toMatchObject({ camera: { isStreamAvailable: true } });
  });

  it('is on every printer', () => {
    for (const driver of DRIVERS) {
      expect(entitiesOf(driver).has('chamber_camera'), driver).toBe(true);
    }
  });
});
