/**
 * Sample cards of Together: lights, switches, covers, locks and climate together, with the members
 * they gather - the board `K-Aggregate`'s Kitchen lights, Garden sockets, Blinds, Doors and
 * Upstairs first, one per kind, then the board's other cases.
 *
 * Members by rule are found by their area key, which no other sample has, so a rule here gathers
 * only the entities written for it.
 */
import {
  entityIdSchema,
  type DashboardLeafCard,
  type DashboardTogetherCard,
  type EntityView,
  type TogetherDomain,
  type TogetherMembers,
} from '@nebulahome/contracts';

import { can, sampleEntity, type SampleEntity } from '@/routes/dashboard/samples/sample-entity';

/**
 * A sample entity in an area the rules can find.
 *
 * @param entityId - Its address.
 * @param areaKey - Its area's key; null for one no rule gathers.
 * @param sample - What it is.
 * @param minutesAgo - When it last changed, when not the samples' 24 minutes.
 * @returns The entity.
 */
function member(
  entityId: string,
  areaKey: string | null,
  sample: SampleEntity,
  minutesAgo?: number,
): EntityView {
  return {
    ...sampleEntity(entityId, sample),
    areaKey,
    ...(minutesAgo === undefined
      ? {}
      : { lastChanged: new Date(Date.now() - minutesAgo * 60_000) }),
  };
}

/** What a lamp of the samples can do: dim and take a white. */
const LAMP = [can('on_off'), can('level'), can('color_temp', { minMireds: 153, maxMireds: 500 })];

/**
 * A lamp, on at a brightness in a warm white, or off.
 *
 * @param entityId - Its address.
 * @param name - Its name.
 * @param area - Its area's key and name.
 * @param level - Its brightness; null for off.
 * @returns The lamp.
 */
function lamp(
  entityId: string,
  name: string,
  area: readonly [key: string | null, name: string],
  level: number | null,
): EntityView {
  return member(entityId, area[0], {
    name,
    area: area[1],
    capabilities: LAMP,
    state:
      level === null
        ? { on_off: { isOn: false }, level: { level: 0 } }
        : { on_off: { isOn: true }, level: { level }, color_temp: { mireds: 370 } },
  });
}

/**
 * Something that only switches.
 *
 * @param entityId - Its address.
 * @param name - Its name.
 * @param area - Its area's key and name.
 * @param isOn - Whether it is on.
 * @returns The entity.
 */
function onOff(
  entityId: string,
  name: string,
  area: readonly [key: string, name: string],
  isOn: boolean,
): EntityView {
  return member(entityId, area[0], {
    name,
    area: area[1],
    capabilities: [can('on_off')],
    state: { on_off: { isOn } },
  });
}

/**
 * A blind that says how far it is open.
 *
 * @param entityId - Its address.
 * @param name - Its name.
 * @param area - Its area's key and name.
 * @param position - How far it is open.
 * @returns The blind.
 */
function blind(
  entityId: string,
  name: string,
  area: readonly [key: string, name: string],
  position: number,
): EntityView {
  return member(entityId, area[0], {
    name,
    area: area[1],
    capabilities: [can('cover', { hasPosition: true })],
    state: { cover: { position, motion: 'stopped' } },
  });
}

/**
 * A lock.
 *
 * @param entityId - Its address.
 * @param name - Its name.
 * @param lockState - Where its bolt is.
 * @param minutesAgo - When it last changed.
 * @returns The lock.
 */
function lock(
  entityId: string,
  name: string,
  lockState: 'locked' | 'unlocked',
  minutesAgo?: number,
): EntityView {
  return member(
    entityId,
    null,
    { name, area: 'Doors', capabilities: [can('lock')], state: { lock: { lockState } } },
    minutesAgo,
  );
}

/** What the samples' thermostats can do, as the Living room's. */
const THERMOSTAT = can('thermostat', {
  supportedModes: ['heat', 'off'],
  minTemperature: 7,
  maxTemperature: 30,
  temperatureStep: 0.5,
});

/**
 * A thermostat in heat mode.
 *
 * @param entityId - Its address.
 * @param name - Its name.
 * @param areaKey - Its area's key.
 * @param now - The room's temperature.
 * @param target - Its target.
 * @param isHeating - Whether it is heating now.
 * @returns The thermostat.
 */
function thermostat(
  entityId: string,
  name: string,
  areaKey: string | null,
  now: number,
  target: number,
  isHeating: boolean,
): EntityView {
  return member(entityId, areaKey, {
    name,
    area: 'Upstairs',
    capabilities: [THERMOSTAT],
    state: {
      thermostat: {
        currentTemperature: now,
        targetTemperature: target,
        mode: 'heat',
        action: isHeating ? 'heating' : 'idle',
      },
    },
  });
}

const KITCHEN = ['kitchen', 'Kitchen'] as const;
const HALLWAY = ['hallway', 'Hallway'] as const;
const GARDEN = ['garden', 'Garden'] as const;
const BEDROOM = ['bedroom', 'Bedroom'] as const;
const GROUND = ['ground_floor', 'Ground floor'] as const;
const FIRST = ['first_floor', 'First floor'] as const;

/** The entities the sample cards read, beside the other samples. */
export const GATHERED_ENTITIES: readonly EntityView[] = [
  // The Kitchen: four lamps on at 72% on average, two off, and the fridge's, left out.
  lamp('light.kitchen_island', 'Island lights', KITCHEN, 80),
  lamp('light.kitchen_ceiling', 'Ceiling', KITCHEN, 72),
  lamp('light.kitchen_under_cabinet', 'Under-cabinet strip', KITCHEN, 60),
  lamp('light.kitchen_table', 'Table lamp', KITCHEN, 75),
  lamp('light.kitchen_pantry', 'Pantry', KITCHEN, null),
  lamp('light.kitchen_hood', 'Hood light', KITCHEN, null),
  lamp('light.kitchen_fridge', 'Fridge light', KITCHEN, null),
  // A pendant that cannot be reached, in no rule's area: picked by hand.
  { ...lamp('light.kitchen_pendant', 'Pendant', [null, 'Kitchen'], 50), isAvailable: false },

  // The Hallway: three of four dim.
  lamp('light.hallway_ceiling', 'Ceiling', HALLWAY, 80),
  lamp('light.hallway_wall', 'Wall lights', HALLWAY, 70),
  lamp('light.hallway_console', 'Console lamp', HALLWAY, 66),
  member('light.hallway_night', HALLWAY[0], {
    name: 'Night light',
    area: HALLWAY[1],
    capabilities: [can('on_off')],
    state: { on_off: { isOn: true } },
  }),

  // The Garden: lights that only switch, and the sockets.
  member('light.garden_path', GARDEN[0], {
    name: 'Path lights',
    area: GARDEN[1],
    capabilities: [can('on_off')],
    state: { on_off: { isOn: true } },
  }),
  member('light.garden_pergola', GARDEN[0], {
    name: 'Pergola',
    area: GARDEN[1],
    capabilities: [can('on_off')],
    state: { on_off: { isOn: true } },
  }),
  member('light.garden_shed', GARDEN[0], {
    name: 'Shed light',
    area: GARDEN[1],
    capabilities: [can('on_off')],
    state: { on_off: { isOn: false } },
  }),
  onOff('switch.garden_fountain', 'Fountain pump', GARDEN, true),
  onOff('switch.garden_path_socket', 'Path lights socket', GARDEN, true),
  onOff('switch.garden_shed', 'Shed', GARDEN, false),
  onOff('switch.garden_greenhouse', 'Greenhouse heater', GARDEN, false),
  onOff('switch.garden_pool', 'Pool cover', GARDEN, false),

  // The Bedroom, all off.
  lamp('light.bedroom_ceiling', 'Ceiling', BEDROOM, null),
  lamp('light.bedroom_left', 'Left bedside', BEDROOM, null),
  lamp('light.bedroom_right', 'Right bedside', BEDROOM, null),

  // The blinds: the ground floor's alike, the first floor's not.
  blind('cover.ground_living', 'Living room', GROUND, 60),
  blind('cover.ground_kitchen', 'Kitchen', GROUND, 60),
  blind('cover.ground_dining', 'Dining room', GROUND, 60),
  blind('cover.ground_study', 'Study', GROUND, 60),
  blind('cover.ground_hall', 'Hallway', GROUND, 60),
  blind('cover.first_bedroom', 'Bedroom', FIRST, 100),
  blind('cover.first_kids', 'Kids room', FIRST, 100),
  blind('cover.first_bath', 'Bathroom', FIRST, 100),
  blind('cover.first_landing', 'Landing', FIRST, 0),
  blind('cover.first_guest', 'Guest room', FIRST, 0),

  // The doors: the back one open for 12 minutes.
  lock('lock.door_front', 'Front door', 'locked'),
  lock('lock.door_back', 'Back door', 'unlocked', 12),
  lock('lock.door_garage', 'Garage', 'locked'),
  lock('lock.door_side', 'Side gate', 'locked'),

  // Upstairs: 20.8 °C on average, two heating; the same target, then three apart.
  thermostat('climate.upstairs_bedroom', 'Bedroom', 'upstairs', 20.1, 21.5, true),
  thermostat('climate.upstairs_kids', 'Kids room', 'upstairs', 21.4, 21.5, true),
  thermostat('climate.upstairs_study', 'Study', 'upstairs', 20.9, 21.5, false),
  thermostat('climate.upper_bedroom', 'Bedroom', null, 20.1, 20, true),
  thermostat('climate.upper_kids', 'Kids room', null, 21.4, 22, true),
  thermostat('climate.upper_study', 'Study', null, 20.9, 21, false),
];

/**
 * Members by rule: every one of the kind in an area, but the ones left out.
 *
 * @param areaKey - The area.
 * @param exclude - The ones left out.
 * @returns The rule.
 */
function byRule(areaKey: string, exclude: readonly string[] = []): TogetherMembers {
  return { mode: 'rule', areaKey, exclude: exclude.map((id) => entityIdSchema.parse(id)) };
}

/**
 * Members by hand.
 *
 * @param entityIds - The ones picked.
 * @returns The list.
 */
function byHand(entityIds: readonly string[]): TogetherMembers {
  return { mode: 'hand', entityIds: entityIds.map((id) => entityIdSchema.parse(id)) };
}

/**
 * A together card at its tall size: the lab draws it at every size of its type.
 *
 * @param id - Its id.
 * @param domain - The kind it stands for.
 * @param title - What it is headed.
 * @param members - Who it stands for.
 * @returns The card.
 */
function together(
  id: string,
  domain: TogetherDomain,
  title: string,
  members: TogetherMembers,
): DashboardTogetherCard {
  return { type: 'together', id, x: 0, y: 0, w: 1, h: 2, domain, members, title, icon: null };
}

/** The Kitchen's lights by rule, the fridge's left out: the board's first card. */
const KITCHEN_LIGHTS = byRule('kitchen', ['light.kitchen_fridge']);

/** The sample cards: one per kind first, the catalogue's, then the board's other cases. */
export const GATHERED_CARDS: readonly DashboardLeafCard[] = [
  together('togetherkitchen', 'light', 'Kitchen lights', KITCHEN_LIGHTS),
  together('togethersockets', 'switch', 'Garden sockets', byRule('garden')),
  together('togetherblinds', 'cover', 'Blinds', byRule('ground_floor')),
  together(
    'togetherdoors',
    'lock',
    'Doors',
    byHand(['lock.door_front', 'lock.door_back', 'lock.door_garage']),
  ),
  together('togetherupstairs', 'thermostat', 'Upstairs', byRule('upstairs')),
  together('togetherbedroom', 'light', 'Bedroom lights', byRule('bedroom')),
  together('togetherhallway', 'light', 'Hallway lights', byRule('hallway')),
  together('togethergarden', 'light', 'Garden lights', byRule('garden')),
  together(
    'togetheroffline',
    'light',
    'Kitchen lights',
    byHand([
      'light.kitchen_island',
      'light.kitchen_ceiling',
      'light.kitchen_table',
      'light.kitchen_pantry',
      'light.kitchen_hood',
      'light.kitchen_pendant',
    ]),
  ),
  together('togetherblindsapart', 'cover', 'Blinds', byRule('first_floor')),
  together(
    'togetherlocked',
    'lock',
    'Doors',
    byHand(['lock.door_front', 'lock.door_garage', 'lock.door_side']),
  ),
  together(
    'togethertargets',
    'thermostat',
    'Upstairs',
    byHand(['climate.upper_bedroom', 'climate.upper_kids', 'climate.upper_study']),
  ),
];

/**
 * Cards of these types on the editor lab's sample dashboard (`gallery-dashboard-editor.tsx`), to
 * see their settings: on the page's rows 7 to 9, so the families never overlap.
 */
export const GATHERED_EDITOR_CARDS: readonly DashboardLeafCard[] = [
  { ...together('labtogether1', 'light', 'Kitchen lights', KITCHEN_LIGHTS), y: 7 },
];
