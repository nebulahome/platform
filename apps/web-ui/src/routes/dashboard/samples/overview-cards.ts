/**
 * Sample cards of Summary, Room, the entity list and quick actions, with the house the board
 * `K-Overview` draws: the Living room at 21.4 °C heating to 21.5 °C with two of its four lights
 * on, its blinds at 60% and Midnight City on its speaker; the Garage with nothing on; the
 * bathroom window open for two hours; three batteries low; updates ready; the hallway sensor out
 * of reach. The whole-house counts also read every other sample of the lab.
 */
import { entityIdSchema, type DashboardLeafCard, type EntityView } from '@nebulahome/contracts';

import { can, sampleEntity, type SampleEntity } from '@/routes/dashboard/samples/sample-entity';

/** The device the living room's thermometer and hygrometer share: one sensor, two readings. */
const LIVING_SENSOR = '00000000-0000-4000-8000-0000000000c1';

/** Two hours before the page opened: when the bathroom window was opened. */
const TWO_HOURS_AGO = new Date(Date.now() - 2 * 3_600_000);

/**
 * A sample entity in an area of the sample house.
 *
 * @param entityId - Its address.
 * @param areaKey - Its area's key, or null for none.
 * @param sample - What it is; `area` is the area's name.
 * @param more - What else differs from a plain sample: its device, when it last changed.
 * @returns The entity.
 */
function placed(
  entityId: string,
  areaKey: string | null,
  sample: SampleEntity,
  more: Partial<EntityView> = {},
): EntityView {
  return { ...sampleEntity(entityId, sample), areaKey, ...more };
}

/** A light of the sample house, on at a level or off. */
const DIMMABLE = [can('on_off'), can('level')];

/**
 * An update of the sample house's firmware.
 *
 * @param entityId - Its address.
 * @param name - What it updates.
 * @param latestVersion - The version offered; the installed one when there is nothing new.
 * @returns The entity.
 */
function firmware(entityId: string, name: string, latestVersion: string): EntityView {
  return placed(entityId, null, {
    name,
    area: 'Firmware',
    capabilities: [can('update')],
    state: { update: { installedVersion: '2.1.0', latestVersion } },
  });
}

/** The entities the sample cards read, beside the other samples. */
export const OVERVIEW_ENTITIES: readonly EntityView[] = [
  // The Living room: climate, four lights, the blinds, the speaker - eight devices.
  placed(
    'sensor.living_room_temperature',
    'living_room',
    {
      name: 'Temperature',
      area: 'Living room',
      capabilities: [can('sensor_numeric')],
      state: { sensor_numeric: { value: 21.4 } },
      unit: '°C',
      deviceClass: 'temperature',
    },
    { deviceId: LIVING_SENSOR },
  ),
  placed(
    'sensor.living_room_humidity',
    'living_room',
    {
      name: 'Humidity',
      area: 'Living room',
      capabilities: [can('sensor_numeric')],
      state: { sensor_numeric: { value: 48 } },
      unit: '%',
      deviceClass: 'humidity',
    },
    { deviceId: LIVING_SENSOR },
  ),
  placed('climate.living_room', 'living_room', {
    name: 'Heating',
    area: 'Living room',
    capabilities: [
      can('thermostat', {
        supportedModes: ['heat', 'off'],
        minTemperature: 7,
        maxTemperature: 30,
        temperatureStep: 0.5,
      }),
    ],
    state: {
      thermostat: {
        currentTemperature: 21.4,
        targetTemperature: 21.5,
        mode: 'heat',
        action: 'heating',
        humidity: 48,
      },
    },
  }),
  placed('light.living_room_ceiling', 'living_room', {
    name: 'Ceiling',
    area: 'Living room',
    capabilities: DIMMABLE,
    state: { on_off: { isOn: true }, level: { level: 70 } },
  }),
  placed('light.living_room_floor', 'living_room', {
    name: 'Floor lamp',
    area: 'Living room',
    capabilities: DIMMABLE,
    state: { on_off: { isOn: true }, level: { level: 40 } },
  }),
  placed('light.living_room_shelf', 'living_room', {
    name: 'Shelf',
    area: 'Living room',
    capabilities: [can('on_off')],
    state: { on_off: { isOn: false } },
  }),
  placed('light.living_room_reading', 'living_room', {
    name: 'Reading lamp',
    area: 'Living room',
    capabilities: DIMMABLE,
    state: { on_off: { isOn: false }, level: { level: 0 } },
  }),
  placed('cover.living_room_blinds', 'living_room', {
    name: 'Blinds',
    area: 'Living room',
    capabilities: [can('cover', { hasPosition: true })],
    state: { cover: { position: 60, motion: 'stopped' } },
  }),
  placed('media_player.living_room_speaker', 'living_room', {
    name: 'Speaker',
    area: 'Living room',
    capabilities: [can('media_player')],
    state: {
      media_player: {
        playback: 'playing',
        volume: 40,
        isMuted: false,
        mediaTitle: 'Midnight City',
        mediaArtist: 'M83',
      },
    },
  }),
  placed('binary_sensor.kitchen_window', 'kitchen', {
    name: 'Kitchen window',
    area: 'Kitchen',
    capabilities: [can('sensor_binary')],
    state: { sensor_binary: { isOn: false } },
    deviceClass: 'window',
  }),

  // The Garage: no thermometer, nothing on.
  placed('light.garage', 'garage', {
    name: 'Garage light',
    area: 'Garage',
    capabilities: [can('on_off')],
    state: { on_off: { isOn: false } },
  }),
  placed('cover.garage_main_door', 'garage', {
    name: 'Garage door',
    area: 'Garage',
    capabilities: [can('cover', { hasPosition: true })],
    state: { cover: { position: 0, motion: 'stopped' } },
    deviceClass: 'garage',
  }),
  placed('lock.garage_side_door', 'garage', {
    name: 'Side door',
    area: 'Garage',
    capabilities: [can('lock')],
    state: { lock: { lockState: 'locked' } },
  }),

  // The rest of the house: the night check's entities, the windows, the batteries.
  placed('lock.hallway_front_door', 'hallway', {
    name: 'Front door',
    area: 'Hallway',
    capabilities: [can('lock')],
    state: { lock: { lockState: 'locked' } },
  }),
  placed('light.outside_porch', 'outside', {
    name: 'Porch light',
    area: 'Outside',
    capabilities: DIMMABLE,
    state: { on_off: { isOn: true }, level: { level: 40 } },
  }),
  placed(
    'binary_sensor.bathroom_window',
    'bathroom',
    {
      name: 'Bathroom window',
      area: 'Bathroom',
      capabilities: [can('sensor_binary')],
      state: { sensor_binary: { isOn: true } },
      deviceClass: 'window',
    },
    { lastChanged: TWO_HOURS_AGO, lastUpdated: TWO_HOURS_AGO },
  ),
  placed('climate.bedroom', 'bedroom', {
    name: 'Bedroom',
    area: 'Bedroom',
    capabilities: [
      can('thermostat', {
        supportedModes: ['heat', 'off'],
        minTemperature: 7,
        maxTemperature: 30,
        temperatureStep: 0.5,
      }),
    ],
    state: {
      thermostat: {
        currentTemperature: 19.8,
        targetTemperature: 20.5,
        mode: 'heat',
        action: 'heating',
      },
    },
  }),
  placed('binary_sensor.bedroom_window_left', 'bedroom', {
    name: 'Bedroom window left',
    area: 'Bedroom',
    capabilities: [can('sensor_binary')],
    state: { sensor_binary: { isOn: false } },
    deviceClass: 'window',
  }),
  placed('binary_sensor.bedroom_window_right', 'bedroom', {
    name: 'Bedroom window right',
    area: 'Bedroom',
    capabilities: [can('sensor_binary')],
    state: { sensor_binary: { isOn: false } },
    deviceClass: 'window',
  }),
  placed('switch.kitchen_coffee', 'kitchen', {
    name: 'Coffee machine',
    area: 'Kitchen',
    capabilities: [can('on_off')],
    state: { on_off: { isOn: false } },
  }),
  placed('sensor.hallway_motion_battery', 'hallway', {
    name: 'Hallway motion',
    area: 'Hallway',
    capabilities: [can('sensor_numeric')],
    state: { sensor_numeric: { value: 14 } },
    unit: '%',
    deviceClass: 'battery',
  }),
  placed('sensor.garden_sensor_battery', 'garden', {
    name: 'Garden sensor',
    area: 'Garden',
    capabilities: [can('sensor_numeric')],
    state: { sensor_numeric: { value: 8 } },
    unit: '%',
    deviceClass: 'battery',
  }),
  placed('sensor.kitchen_remote_battery', 'kitchen', {
    name: 'Kitchen remote',
    area: 'Kitchen',
    capabilities: [can('sensor_numeric')],
    state: { sensor_numeric: { value: 76 } },
    unit: '%',
    deviceClass: 'battery',
  }),
  placed('sensor.hallway_sensor', 'hallway', {
    name: 'Hallway sensor',
    area: 'Hallway',
    capabilities: [can('sensor_numeric')],
    state: { sensor_numeric: { value: 19.6 } },
    unit: '°C',
    deviceClass: 'temperature',
    isAvailable: false,
  }),
  firmware('update.living_room_speaker', 'Living room speaker', '2.2.0'),
  firmware('update.garage_door', 'Garage door', '2.1.4'),
  firmware('update.outside_porch', 'Porch light', '2.1.0'),

  // The quick actions' buttons.
  placed('button.living_room_movie', null, {
    name: 'Movie',
    area: 'Living room',
    capabilities: [can('button')],
    state: {},
  }),
  placed('button.hallway_router_restart', 'hallway', {
    name: 'Restart router',
    area: 'Hallway',
    capabilities: [can('button')],
    state: {},
  }),
  placed('button.hallway_lock_all', 'hallway', {
    name: 'Lock all',
    area: 'Hallway',
    capabilities: [can('button')],
    state: {},
  }),
];

/** Where a sample card sits: the lab and the catalogue place it themselves. */
const AT = { x: 0, y: 0 } as const;

/**
 * A summary card of the board.
 *
 * @param id - Its id.
 * @param what - What it counts.
 * @param areaKey - Where, or null for the whole house.
 * @param size - Its size.
 * @param size.w - Its columns.
 * @param size.h - Its rows.
 * @returns The card.
 */
function summary(
  id: string,
  what: Extract<DashboardLeafCard, { type: 'summary' }>['what'],
  areaKey: string | null,
  size: { readonly w: number; readonly h: number } = { w: 1, h: 1 },
): DashboardLeafCard {
  return { type: 'summary', id, ...AT, ...size, what, areaKey, title: null };
}

/** The night check: the list the board draws, six entities. */
const NIGHT_CHECK: DashboardLeafCard = {
  type: 'list',
  id: 'overviewlist01',
  ...AT,
  w: 1,
  h: 2,
  entityIds: [
    'lock.hallway_front_door',
    'cover.garage_main_door',
    'light.outside_porch',
    'binary_sensor.bathroom_window',
    'climate.bedroom',
    'switch.kitchen_coffee',
  ].map((entityId) => entityIdSchema.parse(entityId)),
  title: 'Night check',
  icon: null,
};

/** The board's quick actions: two scenes, a button that plays, the porch light, two more. */
const QUICK_ACTIONS: DashboardLeafCard = {
  type: 'actions',
  id: 'overviewactions01',
  ...AT,
  w: 2,
  h: 1,
  items: [
    { kind: 'scene', sceneId: '00000000-0000-4000-8000-00000000e001' },
    { kind: 'scene', sceneId: '00000000-0000-4000-8000-00000000e002' },
    { kind: 'entity', entityId: entityIdSchema.parse('button.living_room_movie') },
    { kind: 'entity', entityId: entityIdSchema.parse('light.outside_porch') },
    { kind: 'entity', entityId: entityIdSchema.parse('button.hallway_router_restart') },
    { kind: 'entity', entityId: entityIdSchema.parse('button.hallway_lock_all') },
  ],
  title: null,
};

/** The sample cards: one of each type first, the one the catalogue draws, then the board's others. */
export const OVERVIEW_CARDS: readonly DashboardLeafCard[] = [
  summary('overviewopenings', 'openings', null),
  {
    type: 'room',
    id: 'overviewroomliving',
    ...AT,
    w: 1,
    h: 2,
    areaKey: 'living_room',
    title: null,
    icon: null,
  },
  NIGHT_CHECK,
  QUICK_ACTIONS,
  summary('overviewbedroom', 'openings', 'bedroom'),
  summary('overviewlights', 'lights', null),
  summary('overviewbatteries', 'batteries', null),
  summary('overviewupdates', 'updates', null),
  summary('overviewoffline', 'offline', null),
  summary('overviewglance', 'glance', null, { w: 2, h: 1 }),
  {
    type: 'room',
    id: 'overviewroomgarage',
    ...AT,
    w: 1,
    h: 1,
    areaKey: 'garage',
    title: null,
    icon: null,
  },
];

/**
 * Cards of these types on the editor lab's sample dashboard (`gallery-dashboard-editor.tsx`), to
 * see their settings: on the page's rows 10 to 13, so the families never overlap.
 */
export const OVERVIEW_EDITOR_CARDS: readonly DashboardLeafCard[] = [
  { ...summary('labsummary01', 'batteries', null), x: 0, y: 10 },
  { ...QUICK_ACTIONS, id: 'labactions01', x: 1, y: 10, w: 2, h: 1 },
  {
    type: 'room',
    id: 'labroom00001',
    x: 0,
    y: 11,
    w: 2,
    h: 2,
    areaKey: 'living_room',
    title: null,
    icon: null,
  },
  { ...NIGHT_CHECK, id: 'lablist00001', x: 2, y: 11, w: 1, h: 2 },
];
