/**
 * The samples of the robots, the choices and numbers, the buttons, updates and pictures, the fan, times and people.
 *
 * `MORE_SAMPLES` holds one entity per kind of card, the one the Add card catalogue draws (the
 * first of each kind); `MORE_VARIANTS` the ones the lab draws besides: what the boards
 * `K-Capabilities` and `K-States` draw for these kinds. `SAMPLE_SCENES` are the scenes a scene
 * card is drawn with.
 */
import { entityIdSchema, type EntityView, type SceneView } from '@nebulahome/contracts';

import { can, sampleEntity } from '@/routes/dashboard/samples/sample-entity';

/** The rooms of Robbie's map. */
const ROOMS = ['Kitchen', 'Living room', 'Hallway', 'Office', 'Bathroom', 'Bedroom'].map(
  (name, index) => ({ id: String(index + 1), name }),
);

/** The boards' ceiling fan: a speed in percent, three presets, swing and direction. */
const CEILING_FAN = {
  speedCount: 100,
  presets: ['Normal', 'Breeze', 'Sleep'],
  canOscillate: true,
  canReverse: true,
};

/**
 * A day this many days from today, as a date entity keeps it.
 *
 * @param days - How many.
 * @param at - The time of day, `HH:MM`, for a moment rather than a day.
 * @returns `YYYY-MM-DD`, or the moment in ISO 8601.
 */
function daysOn(days: number, at?: string): string {
  const when = new Date();

  when.setDate(when.getDate() + days);

  if (at === undefined) {
    return `${String(when.getFullYear())}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`;
  }

  const [hours = 0, minutes = 0] = at.split(':').map(Number);

  when.setHours(hours, minutes, 0, 0);

  return when.toISOString();
}

/** One entity per kind of card. */
export const MORE_SAMPLES: readonly EntityView[] = [
  sampleEntity('vacuum.robbie', {
    name: 'Robbie',
    area: 'Ground floor',
    capabilities: [can('vacuum', { canLocate: true, canCleanRooms: true })],
    state: { vacuum: { activity: 'cleaning', rooms: ROOMS, isResumable: false } },
  }),
  sampleEntity('fan.ceiling', {
    name: 'Ceiling fan',
    area: 'Bedroom',
    capabilities: [can('on_off'), can('fan', CEILING_FAN)],
    state: {
      on_off: { isOn: true },
      fan: { percentage: 60, preset: 'Breeze', isOscillating: true, direction: 'forward' },
    },
  }),
  sampleEntity('time.wake_up', {
    name: 'Wake-up',
    area: 'Bedroom',
    capabilities: [can('time_of_day', { canSet: true, step: 60 })],
    state: { time_of_day: { value: '06:45' } },
  }),
  sampleEntity('device_tracker.giulia', {
    name: 'Giulia',
    area: null,
    capabilities: [can('location', { source: 'gps' })],
    state: {
      location: {
        zone: 'Work',
        latitude: 45.4842,
        longitude: 9.2041,
        accuracyMeters: 18,
        distanceKm: 14,
      },
    },
  }),
  sampleEntity('lawn_mower.garden', {
    name: 'Mower',
    area: 'Garden',
    capabilities: [can('lawn_mower')],
    state: { lawn_mower: { activity: 'mowing', isResumable: false } },
  }),
  sampleEntity('select.bathroom_fan_speed', {
    name: 'Fan speed',
    area: 'Bathroom',
    capabilities: [
      can('select', {
        options: ['Off', 'Low', 'Medium', 'High', 'Auto'].map((label) => ({
          value: label.toLowerCase(),
          label,
        })),
      }),
    ],
    state: { select: { option: 'medium' } },
  }),
  sampleEntity('number.hallway_light_timer', {
    name: 'Light timer',
    area: 'Hallway',
    unit: 'min',
    capabilities: [can('number', { min: 5, max: 45, step: 5 })],
    state: { number: { value: 30 } },
  }),
  sampleEntity('button.restart_router', {
    name: 'Restart router',
    area: 'Network',
    deviceClass: 'restart',
    capabilities: [can('button')],
    state: {},
  }),
  sampleEntity('update.kitchen_relay', {
    name: 'Kitchen relay',
    area: 'Firmware',
    capabilities: [can('update')],
    state: { update: { installedVersion: '1.4.2', latestVersion: '1.4.4' } },
  }),
  sampleEntity('image.printer_camera', {
    name: 'Printer camera',
    area: null,
    capabilities: [can('image')],
    state: { image: { contentType: 'image/svg+xml', revision: 'sample' } },
  }),
  sampleEntity('custom.x1_carbon', {
    name: 'X1 Carbon',
    area: 'Bambu Lab',
    capabilities: [can('custom', { packageId: 'bambu-lab', type: 'print' })],
    state: {
      custom: {
        values: {
          status: 'Printing',
          progress: '62%',
          nozzle: '220 °C',
          ends: '15:48',
          layer: '120 / 300',
          bed: '60 °C',
          speed: 'Standard',
          filament: 'PLA · black',
        },
      },
    },
  }),
];

/** What the lab draws besides. */
export const MORE_VARIANTS: readonly EntityView[] = [
  // K-Capabilities: no battery and no locate; the square without rooms.
  sampleEntity('vacuum.robbie_basic', {
    name: 'Robbie',
    area: 'Ground floor',
    capabilities: [can('vacuum')],
    state: { vacuum: { activity: 'cleaning' } },
  }),
  sampleEntity('vacuum.robbie_docked', {
    name: 'Robbie',
    area: 'Ground floor',
    capabilities: [can('vacuum', { canLocate: true })],
    state: { vacuum: { activity: 'docked' } },
  }),
  sampleEntity('lawn_mower.garden_docked', {
    name: 'Mower',
    area: 'Garden',
    capabilities: [can('lawn_mower')],
    state: { lawn_mower: { activity: 'docked' } },
  }),
  sampleEntity('update.zigbee_bridge', {
    name: 'Zigbee bridge',
    area: 'Firmware',
    capabilities: [can('update', { hasProgress: true })],
    state: {
      update: {
        installedVersion: '20240410',
        latestVersion: '20240710',
        isInstalling: true,
        progress: 62,
      },
    },
  }),

  // K-New: a fan that only switches, one off, and one with three speeds.
  sampleEntity('fan.bathroom', {
    name: 'Bathroom fan',
    area: 'Bathroom',
    capabilities: [can('on_off'), can('fan')],
    state: { on_off: { isOn: true }, fan: {} },
  }),
  sampleEntity('fan.ceiling_off', {
    name: 'Ceiling fan',
    area: 'Bedroom',
    capabilities: [can('on_off'), can('fan', CEILING_FAN)],
    state: {
      on_off: { isOn: false },
      fan: { percentage: 60, preset: 'Breeze', isOscillating: false, direction: 'forward' },
    },
  }),
  sampleEntity('fan.kitchen_hood', {
    name: 'Kitchen hood',
    area: 'Kitchen',
    capabilities: [can('on_off'), can('fan', { speedCount: 3 })],
    state: { on_off: { isOn: true }, fan: { percentage: 67 } },
  }),

  // K-New: a day, and a moment read only and one that may be set.
  sampleEntity('time.filter_change', {
    name: 'Filter change',
    area: 'Ventilation',
    capabilities: [can('date', { canSet: true })],
    state: { date: { value: daysOn(26) } },
  }),
  sampleEntity('time.next_watering', {
    name: 'Next watering',
    area: 'Garden',
    capabilities: [can('datetime')],
    state: { datetime: { value: daysOn(1, '06:30') } },
  }),
  sampleEntity('time.next_watering_set', {
    name: 'Next watering',
    area: 'Garden',
    capabilities: [can('datetime', { canSet: true })],
    state: { datetime: { value: daysOn(1, '06:30') } },
  }),

  // K-New: a person at home, and one away.
  sampleEntity('device_tracker.roberto', {
    name: 'Roberto',
    area: null,
    capabilities: [can('location', { source: 'gps' })],
    state: { location: { zone: 'home', latitude: 45.5412, longitude: 9.1503, accuracyMeters: 12 } },
  }),
  sampleEntity('device_tracker.luca', {
    name: 'Luca',
    area: null,
    capabilities: [can('location', { source: 'gps' })],
    state: {
      location: { zone: 'away', latitude: 45.5301, longitude: 9.1789, distanceKm: 2.4 },
    },
  }),

  // K-States: out of reach, and for someone who may only look.
  sampleEntity('fan.ceiling_offline', {
    name: 'Ceiling fan',
    area: 'Bedroom',
    capabilities: [can('on_off'), can('fan', CEILING_FAN)],
    state: { on_off: { isOn: true }, fan: { percentage: 60, preset: 'Breeze' } },
    isAvailable: false,
  }),
  sampleEntity('fan.ceiling_view_only', {
    name: 'Ceiling fan',
    area: 'Bedroom',
    capabilities: [can('on_off'), can('fan', CEILING_FAN)],
    state: { on_off: { isOn: true }, fan: { percentage: 60, preset: 'Breeze' } },
    isViewOnly: true,
  }),
  sampleEntity('time.wake_up_view_only', {
    name: 'Wake-up',
    area: 'Bedroom',
    capabilities: [can('time_of_day', { canSet: true })],
    state: { time_of_day: { value: '06:45' } },
    isViewOnly: true,
  }),
  sampleEntity('time.wake_up_no_value', {
    name: 'Wake-up',
    area: 'Bedroom',
    capabilities: [can('time_of_day', { canSet: true })],
    state: { time_of_day: { value: null } },
  }),
  sampleEntity('device_tracker.giulia_offline', {
    name: 'Giulia',
    area: null,
    capabilities: [can('location', { source: 'gps' })],
    state: { location: { zone: 'Work', distanceKm: 14 } },
    isAvailable: false,
  }),
  sampleEntity('select.fan_speed_offline', {
    name: 'Fan speed',
    area: 'Bathroom',
    capabilities: [
      can('select', {
        options: ['Low', 'Medium', 'High'].map((label) => ({ value: label.toLowerCase(), label })),
      }),
    ],
    state: { select: { option: 'medium' } },
    isAvailable: false,
  }),
  sampleEntity('vacuum.robbie_view_only', {
    name: 'Robbie',
    area: 'Ground floor',
    capabilities: [can('vacuum', { canLocate: true })],
    state: { vacuum: { activity: 'cleaning' } },
    isViewOnly: true,
  }),
];

/**
 * A scene of the sample house.
 *
 * @param id - Its id.
 * @param name - What it is called.
 * @param members - The entities it sets, by address.
 * @returns The scene.
 */
function sampleScene(id: string, name: string, members: readonly string[]): SceneView {
  return {
    id,
    key: name.toLowerCase(),
    name,
    icon: name === 'Evening' ? 'moon' : 'house',
    areaKey: null,
    rollbackOnPartialFailure: false,
    members: members.map((address) => ({
      entityId: entityIdSchema.parse(address),
      entityName: address,
      targetState: {},
    })),
    unresolvedMembers: [],
  };
}

/** The scenes a scene card is drawn with: the boards' Evening and Away. */
export const SAMPLE_SCENES: readonly SceneView[] = [
  sampleScene('00000000-0000-4000-8000-00000000e001', 'Evening', [
    'light.island',
    'cover.living_blinds',
    'light.desk_strip',
    'light.reading_lamp',
    'light.porch',
    'light.study',
    'cover.bedroom_blinds',
    'light.hallway',
  ]),
  sampleScene('00000000-0000-4000-8000-00000000e002', 'Away', [
    'light.island',
    'climate.living',
    'cover.living_blinds',
    'lock.front_door',
    'media_player.living_speaker',
    'switch.coffee',
    'light.porch',
    'light.study',
    'light.desk_strip',
    'light.reading_lamp',
    'cover.bedroom_blinds',
    'light.hallway',
  ]),
];
