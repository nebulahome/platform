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
    capabilities: [
      can('on_off'),
      can('fan', { speedCount: 0, presets: ['Normal', 'Breeze', 'Sleep'], canOscillate: true }),
    ],
    state: {
      on_off: { isOn: true },
      fan: { percentage: 60, preset: 'Breeze', isOscillating: true, direction: 'forward' },
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

  // K-States: out of reach, and for someone who may only look.
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
