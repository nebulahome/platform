/**
 * What a card's settings offer beside its entity and its size: the parts a size can do without,
 * which the person may switch off (`Show`), and what a tap on the card does (`When tapped`).
 *
 * Each kind of card names its own optional parts; a part is offered only at the sizes that draw
 * it, so the switches in the settings are always switches for something the card shows.
 */
import type { EntityView } from '@nebulahome/contracts';
import type { UiIconId } from '@nebulahome/ui';

import { cardKindOf, fanOnlySwitches, type CardSize } from '@/dashboard/card-sizes';
import { defineMessage, text, translate, type Message } from '@/i18n/messages';
import { hasCapability, paramsOf } from '@/library/entity-control';

/** A part of a card that may be switched off. */
export type CardPart = {
  /** Its name, as the card reads it from `hide`. */
  readonly id: string;

  /** What the switch says. */
  readonly label: Message;

  /** The sizes that draw it, as cells ("1x2"); every size when absent. */
  readonly sizes?: readonly string[];

  /** Whether the entity has what the part shows; every entity when absent. */
  readonly needs?: (entity: EntityView) => boolean;
};

/** The optional parts of each kind of card. */
const PARTS: Readonly<Record<string, readonly CardPart[]>> = {
  light: [
    {
      id: 'presets',
      label: defineMessage('dashboard.cardOptions.colourPresets', 'Colour presets'),
      sizes: ['1x2', '2x2'],
      /**
       * Whether the entity has `color_hs`.
       *
       * @param entity - The entity.
       * @returns True when the part has something to show.
       */
      needs: (entity) => hasCapability(entity, 'color_hs'),
    },
    {
      id: 'brightness',
      label: defineMessage('dashboard.cardOptions.brightnessSlider', 'Brightness slider'),
      sizes: ['1x2', '2x2'],
      /**
       * Whether the entity has `level`.
       *
       * @param entity - The entity.
       * @returns True when the part has something to show.
       */
      needs: (entity) => hasCapability(entity, 'level'),
    },
    {
      id: 'white',
      label: defineMessage('dashboard.cardOptions.whiteSlider', 'White slider'),
      sizes: ['1x2', '2x2'],
      /**
       * Whether the entity has `color_temp`.
       *
       * @param entity - The entity.
       * @returns True when the part has something to show.
       */
      needs: (entity) => hasCapability(entity, 'color_temp'),
    },
    {
      id: 'day',
      label: defineMessage('dashboard.cardOptions.todaysUse', 'Today’s use'),
      sizes: ['1x2'],
      /**
       * Whether the entity lacks `level`.
       *
       * @param entity - The entity.
       * @returns True when the part has something to show.
       */
      needs: (entity) => !hasCapability(entity, 'level'),
    },
  ],
  switch: [
    {
      id: 'day',
      label: defineMessage('dashboard.cardOptions.todaysUse', 'Today’s use'),
      sizes: ['1x2'],
    },
  ],
  binary: [
    {
      id: 'day',
      label: defineMessage('dashboard.cardOptions.today', 'Today'),
      sizes: ['1x2'],
    },
  ],
  sensor: [
    {
      id: 'chart',
      label: defineMessage('dashboard.cardOptions.chart', 'Chart'),
      sizes: ['2x1', '1x2', '2x2'],
    },
  ],
  fan: [
    {
      id: 'presets',
      label: defineMessage('dashboard.cardOptions.fanPresets', 'Presets'),
      sizes: ['1x2', '2x2'],
      /**
       * Whether the fan has presets.
       *
       * @param entity - The entity.
       * @returns True when the part has something to show.
       */
      needs: (entity) => (paramsOf(entity, 'fan')?.presets.length ?? 0) > 0,
    },
    {
      id: 'day',
      label: defineMessage('dashboard.cardOptions.todaysUse', 'Today’s use'),
      sizes: ['1x2'],
      needs: fanOnlySwitches,
    },
  ],
};

/**
 * The parts an entity's card may switch off at a size: those its kind draws at that size and the
 * entity has something for.
 *
 * @param entity - The entity.
 * @param size - The card's size.
 * @returns The parts, in the order the card draws them.
 */
export function partsOf(entity: EntityView, size: CardSize): readonly CardPart[] {
  const cells = `${String(size.w)}x${String(size.h)}`;

  return (PARTS[cardKindOf(entity)] ?? []).filter(
    (part) =>
      (part.sizes === undefined || part.sizes.includes(cells)) &&
      (part.needs === undefined || part.needs(entity)),
  );
}

/** What a tap on an entity card may do. */
export type TapChoice = { readonly value: 'sheet' | 'toggle' | 'none'; readonly label: string };

/**
 * What a tap on an entity's card may do: open the entity, switch it when it switches, or nothing.
 *
 * @param entity - The entity.
 * @returns The choices, the default first.
 */
export function tapChoices(entity: EntityView): readonly TapChoice[] {
  const thing = kindName(cardKindOf(entity)).toLowerCase();

  return [
    {
      value: 'sheet',
      label: translate('dashboard.cardOptions.openThe', 'Open the {{thing}}', { thing }),
    },
    ...(hasCapability(entity, 'on_off')
      ? [
          {
            value: 'toggle' as const,
            label: text(defineMessage('dashboard.cardOptions.turnOnOrOff', 'Turn on or off')),
          },
        ]
      : []),
    { value: 'none', label: text(defineMessage('dashboard.cardOptions.nothing', 'Nothing')) },
  ];
}

/** What each kind of card is called, and its icon. */
const KIND_LOOKS: Readonly<
  Record<string, { readonly name: Message; readonly icon: UiIconId; readonly description: Message }>
> = {
  light: {
    name: defineMessage('dashboard.cardKinds.light', 'Light'),
    icon: 'lightbulb',
    description: defineMessage(
      'dashboard.cardKinds.lightDescription',
      'On, brightness, white and colour.',
    ),
  },
  switch: {
    name: defineMessage('dashboard.cardKinds.switch', 'Switch'),
    icon: 'power',
    description: defineMessage(
      'dashboard.cardKinds.switchDescription',
      'On and off, with the day’s use.',
    ),
  },
  sensor: {
    name: defineMessage('dashboard.cardKinds.sensor', 'Sensor'),
    icon: 'gauge',
    description: defineMessage(
      'dashboard.cardKinds.sensorDescription',
      'A reading, its trend and its chart.',
    ),
  },
  binary: {
    name: defineMessage('dashboard.cardKinds.binary', 'Door or motion'),
    icon: 'door-open',
    description: defineMessage(
      'dashboard.cardKinds.binaryDescription',
      'Open or closed, seen or clear.',
    ),
  },
  text: {
    name: defineMessage('dashboard.cardKinds.text', 'Text sensor'),
    icon: 'type',
    description: defineMessage(
      'dashboard.cardKinds.textDescription',
      'A word or a line, as the device says it.',
    ),
  },
  thermostat: {
    name: defineMessage('dashboard.cardKinds.thermostat', 'Thermostat'),
    icon: 'thermometer',
    description: defineMessage(
      'dashboard.cardKinds.thermostatDescription',
      'Now, target and mode.',
    ),
  },
  cover: {
    name: defineMessage('dashboard.cardKinds.cover', 'Cover'),
    icon: 'blinds',
    description: defineMessage(
      'dashboard.cardKinds.coverDescription',
      'Blinds, shutters and doors.',
    ),
  },
  lock: {
    name: defineMessage('dashboard.cardKinds.lock', 'Lock'),
    icon: 'lock',
    description: defineMessage(
      'dashboard.cardKinds.lockDescription',
      'Locked or not, with a hold to unlock.',
    ),
  },
  media: {
    name: defineMessage('dashboard.cardKinds.media', 'Media player'),
    icon: 'play',
    description: defineMessage(
      'dashboard.cardKinds.mediaDescription',
      'What plays, and its controls.',
    ),
  },
  camera: {
    name: defineMessage('dashboard.cardKinds.camera', 'Camera'),
    icon: 'video',
    description: defineMessage(
      'dashboard.cardKinds.cameraDescription',
      'The live picture and the last events.',
    ),
  },
  vacuum: {
    name: defineMessage('dashboard.cardKinds.vacuum', 'Robot vacuum'),
    icon: 'bot',
    description: defineMessage(
      'dashboard.cardKinds.vacuumDescription',
      'Where it cleans, and its buttons.',
    ),
  },
  mower: {
    name: defineMessage('dashboard.cardKinds.mower', 'Lawn mower'),
    icon: 'tractor',
    description: defineMessage(
      'dashboard.cardKinds.mowerDescription',
      'Mowing or docked, and its buttons.',
    ),
  },
  select: {
    name: defineMessage('dashboard.cardKinds.select', 'Choice'),
    icon: 'list',
    description: defineMessage('dashboard.cardKinds.selectDescription', 'One of a few choices.'),
  },
  number: {
    name: defineMessage('dashboard.cardKinds.number', 'Number'),
    icon: 'hash',
    description: defineMessage(
      'dashboard.cardKinds.numberDescription',
      'A value to set, in its range.',
    ),
  },
  button: {
    name: defineMessage('dashboard.cardKinds.button', 'Button'),
    icon: 'circle-dot',
    description: defineMessage('dashboard.cardKinds.buttonDescription', 'One press.'),
  },
  update: {
    name: defineMessage('dashboard.cardKinds.update', 'Firmware update'),
    icon: 'circle-arrow-up',
    description: defineMessage(
      'dashboard.cardKinds.updateDescription',
      'A new firmware, and Install.',
    ),
  },
  picture: {
    name: defineMessage('dashboard.cardKinds.picture', 'Picture'),
    icon: 'image',
    description: defineMessage(
      'dashboard.cardKinds.pictureDescription',
      'A picture the device takes.',
    ),
  },
  group: {
    name: defineMessage('dashboard.cardKinds.group', 'Group'),
    icon: 'layout-grid',
    description: defineMessage(
      'dashboard.cardKinds.groupDescription',
      'A titled frame that holds cards.',
    ),
  },
  clock: {
    name: defineMessage('dashboard.cardKinds.clock', 'Clock'),
    icon: 'clock',
    description: defineMessage('dashboard.cardKinds.clockDescription', 'The time and the date.'),
  },
  scene: {
    name: defineMessage('dashboard.cardKinds.scene', 'Scene'),
    icon: 'sparkles',
    description: defineMessage('dashboard.cardKinds.sceneDescription', 'One press sets a scene.'),
  },
  custom: {
    name: defineMessage('dashboard.cardKinds.custom', 'Package entity'),
    icon: 'package',
    description: defineMessage('dashboard.cardKinds.customDescription', 'What a package reports.'),
  },
  'together-light': {
    name: defineMessage('dashboard.cardKinds.togetherLight', 'Lights together'),
    icon: 'lightbulb',
    description: defineMessage(
      'dashboard.cardKinds.togetherLightDescription',
      'How many are on, and all of them at once.',
    ),
  },
  'together-switch': {
    name: defineMessage('dashboard.cardKinds.togetherSwitch', 'Switches together'),
    icon: 'power',
    description: defineMessage(
      'dashboard.cardKinds.togetherSwitchDescription',
      'How many are on, and all of them at once.',
    ),
  },
  'together-cover': {
    name: defineMessage('dashboard.cardKinds.togetherCover', 'Covers together'),
    icon: 'blinds',
    description: defineMessage(
      'dashboard.cardKinds.togetherCoverDescription',
      'Where they stand, and all of them at once.',
    ),
  },
  'together-lock': {
    name: defineMessage('dashboard.cardKinds.togetherLock', 'Locks together'),
    icon: 'lock',
    description: defineMessage(
      'dashboard.cardKinds.togetherLockDescription',
      'Whether all are locked, and Lock all.',
    ),
  },
  'together-thermostat': {
    name: defineMessage('dashboard.cardKinds.togetherThermostat', 'Climate together'),
    icon: 'thermometer',
    description: defineMessage(
      'dashboard.cardKinds.togetherThermostatDescription',
      'Their temperatures, and every target at once.',
    ),
  },
  summary: {
    name: defineMessage('dashboard.cardKinds.summary', 'Summary'),
    icon: 'list-filter',
    description: defineMessage(
      'dashboard.cardKinds.summaryDescription',
      'What needs a look: open doors, batteries, updates.',
    ),
  },
  room: {
    name: defineMessage('dashboard.cardKinds.room', 'Room'),
    icon: 'armchair',
    description: defineMessage(
      'dashboard.cardKinds.roomDescription',
      'One room: its climate and what is on.',
    ),
  },
  list: {
    name: defineMessage('dashboard.cardKinds.list', 'Entity list'),
    icon: 'list',
    description: defineMessage(
      'dashboard.cardKinds.listDescription',
      'Entities of any kind, as rows.',
    ),
  },
  actions: {
    name: defineMessage('dashboard.cardKinds.actions', 'Quick actions'),
    icon: 'zap',
    description: defineMessage(
      'dashboard.cardKinds.actionsDescription',
      'Scenes, buttons and switches, one press each.',
    ),
  },
  compare: {
    name: defineMessage('dashboard.cardKinds.compare', 'Compare'),
    icon: 'chart-line',
    description: defineMessage(
      'dashboard.cardKinds.compareDescription',
      'Up to four readings on one chart.',
    ),
  },
  activity: {
    name: defineMessage('dashboard.cardKinds.activity', 'Activity'),
    icon: 'activity',
    description: defineMessage(
      'dashboard.cardKinds.activityDescription',
      'What happened lately, newest first.',
    ),
  },
  automation: {
    name: defineMessage('dashboard.cardKinds.automation', 'Automation'),
    icon: 'workflow',
    description: defineMessage(
      'dashboard.cardKinds.automationDescription',
      'On or off, Run now, last and next run.',
    ),
  },
  shortcut: {
    name: defineMessage('dashboard.cardKinds.shortcut', 'Shortcut'),
    icon: 'external-link',
    description: defineMessage(
      'dashboard.cardKinds.shortcutDescription',
      'A page, a package or a web address.',
    ),
  },
  time: {
    name: defineMessage('dashboard.cardKinds.time', 'Time · Date'),
    icon: 'calendar-clock',
    description: defineMessage(
      'dashboard.cardKinds.timeDescription',
      'A time or a date, and how far away it is.',
    ),
  },
  person: {
    name: defineMessage('dashboard.cardKinds.person', 'Person'),
    icon: 'user-round',
    description: defineMessage('dashboard.cardKinds.personDescription', 'Home, away, or where.'),
  },
  fan: {
    name: defineMessage('dashboard.cardKinds.fan', 'Fan'),
    icon: 'fan',
    description: defineMessage('dashboard.cardKinds.fanDescription', 'Speed, presets and swing.'),
  },
};

/**
 * What a kind of card is called.
 *
 * @param kind - The kind.
 * @returns Its name, "Light".
 */
export function kindName(kind: string): string {
  const look = KIND_LOOKS[kind];

  return look === undefined ? kind : text(look.name);
}

/**
 * A kind of card's icon.
 *
 * @param kind - The kind.
 * @returns Its icon.
 */
export function kindIcon(kind: string): UiIconId {
  return KIND_LOOKS[kind]?.icon ?? 'layout-dashboard';
}

/**
 * What a kind of card shows, in a line, for the catalogue.
 *
 * @param kind - The kind.
 * @returns The line.
 */
export function kindDescription(kind: string): string {
  const look = KIND_LOOKS[kind];

  return look === undefined ? '' : text(look.description);
}
