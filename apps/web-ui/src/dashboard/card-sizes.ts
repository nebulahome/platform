/**
 * What sizes a card may take, and which one a drag of its corner lands on.
 *
 * Each kind of card is drawn for a few sizes and no others: a light is a tile, a tall card or a
 * square, never a thin strip, because nobody designed a thin strip of a light. Resizing is free
 * under the pointer and settles on the permitted size nearest to where the corner is let go, so the
 * grid never holds a card at a size it has no drawing for.
 */
import type { CapabilityName, EntityView, PackageCardSize } from '@nebulahome/contracts';

import type { GridSize } from '@/dashboard/grid-engine';
import { translate } from '@/i18n/messages';
import { hasCapability } from '@/library/entity-control';

/** A size a card is drawn for. */
export type CardSize = GridSize;

/** The kinds of card an entity is drawn as, chosen from what it can do. */
export const ENTITY_CARD_KINDS = [
  'thermostat',
  'media',
  'camera',
  'cover',
  'lock',
  'light',
  'switch',
  'sensor',
  'binary',
  'vacuum',
  'mower',
  'select',
  'number',
  'button',
  'update',
  'picture',
  'custom',
  'text',
] as const;

/** The kind of card an entity is drawn as. */
export type EntityCardKind = (typeof ENTITY_CARD_KINDS)[number];

/** Every kind of card that is not a container, with `missing` for an entity that is not there. */
export type LeafCardKind =
  | EntityCardKind
  | 'scene'
  | 'clock'
  | 'energy'
  | 'package'
  | 'together'
  | 'summary'
  | 'room'
  | 'list'
  | 'actions'
  | 'compare'
  | 'activity'
  | 'automation'
  | 'shortcut'
  | 'missing';

/** The sizes a kind of card is drawn for, and the one it starts at. */
type SizeRule = { readonly sizes: readonly CardSize[]; readonly preferred: CardSize };

const TILE: CardSize = { w: 1, h: 1 };
const STRIP: CardSize = { w: 2, h: 1 };
const CARD: CardSize = { w: 1, h: 2 };
const SQUARE: CardSize = { w: 2, h: 2 };
const LARGE: CardSize = { w: 2, h: 3 };
const TALL: CardSize = { w: 2, h: 4 };

/** Every size any card is drawn for. */
export const ALL_CARD_SIZES: readonly CardSize[] = [TILE, STRIP, CARD, SQUARE, LARGE, TALL];

/** What each kind of card may be. */
export const CARD_SIZES: Readonly<Record<LeafCardKind, SizeRule>> = {
  light: { sizes: [TILE, CARD, SQUARE], preferred: CARD },
  switch: { sizes: [TILE, CARD], preferred: TILE },
  sensor: { sizes: [TILE, STRIP, CARD, SQUARE], preferred: TILE },
  binary: { sizes: [TILE, CARD], preferred: TILE },
  text: { sizes: [TILE, STRIP], preferred: TILE },

  // What is told rather than switched: a robot's status and its buttons, the rooms on the square;
  // a choice, a number, a button and a firmware update in a tile or a strip; a picture full bleed.
  vacuum: { sizes: [TILE, CARD, SQUARE], preferred: CARD },
  mower: { sizes: [TILE, CARD], preferred: CARD },
  select: { sizes: [TILE, STRIP], preferred: TILE },
  number: { sizes: [TILE, STRIP], preferred: TILE },
  button: { sizes: [TILE], preferred: TILE },
  update: { sizes: [TILE, STRIP], preferred: TILE },
  picture: { sizes: [SQUARE, LARGE], preferred: SQUARE },

  // An entity of a kind a package defines: its fields as a grid of figures.
  custom: { sizes: [STRIP, SQUARE], preferred: STRIP },
  thermostat: { sizes: [CARD, SQUARE], preferred: CARD },
  cover: { sizes: [TILE, CARD], preferred: CARD },
  lock: { sizes: [TILE, CARD], preferred: CARD },
  media: { sizes: [STRIP, SQUARE], preferred: SQUARE },
  camera: { sizes: [SQUARE, LARGE], preferred: SQUARE },
  scene: { sizes: [TILE, STRIP], preferred: TILE },
  clock: { sizes: [TILE, STRIP, SQUARE], preferred: STRIP },

  // The house needs a square to be read; the day's figures under it need a large card, and the
  // two read best together at the tall one.
  energy: { sizes: [SQUARE, LARGE, TALL], preferred: TALL },

  // A package's card at the sizes its manifest may name: small, wide, medium, large.
  package: { sizes: [TILE, STRIP, SQUARE, LARGE], preferred: SQUARE },

  // Many entities of a kind as one: the count, the bars, and at 2×3 every member.
  together: { sizes: [TILE, CARD, SQUARE, LARGE], preferred: CARD },
  // What needs a look: one count, the house at a glance, or a count and its first three.
  summary: { sizes: [TILE, STRIP, CARD], preferred: TILE },
  room: { sizes: [TILE, CARD, SQUARE], preferred: CARD },
  list: { sizes: [CARD, LARGE], preferred: CARD },
  actions: { sizes: [TILE, STRIP, CARD], preferred: STRIP },
  compare: { sizes: [SQUARE, LARGE], preferred: SQUARE },
  activity: { sizes: [CARD, LARGE], preferred: CARD },
  automation: { sizes: [TILE, STRIP], preferred: TILE },
  shortcut: { sizes: [TILE], preferred: TILE },

  // An entity that is not there may keep whatever size it had, and take any other.
  missing: { sizes: ALL_CARD_SIZES, preferred: TILE },
};

/** The cells each size a package's manifest may name covers. */
const PACKAGE_SIZE_CELLS: Readonly<Record<PackageCardSize, CardSize>> = {
  small: TILE,
  wide: STRIP,
  medium: SQUARE,
  large: LARGE,
};

/**
 * The sizes a package's card is drawn for, as its manifest names them.
 *
 * @param sizes - The manifest's sizes, the one it is added at first.
 * @returns Their cells, in the same order.
 */
export function packageCardSizes(sizes: readonly PackageCardSize[]): CardSize[] {
  return sizes.map((size) => PACKAGE_SIZE_CELLS[size]);
}

/** How wide a container may be, in columns; its height follows what it holds. */
export const CONTAINER_WIDTHS: readonly number[] = [1, 2, 3, 4];

/**
 * What the size picker shows for a size: its columns by its rows, the way the grid counts them.
 *
 * @param size - The size.
 * @returns Its cells, as `2×1`.
 */
export function sizeName(size: CardSize): string {
  return `${String(size.w)}×${String(size.h)}`;
}

/**
 * Whether two sizes are the same.
 *
 * @param a - One size.
 * @param b - The other.
 * @returns True when they cover the same cells.
 */
export function sameSize(a: CardSize, b: CardSize): boolean {
  return a.w === b.w && a.h === b.h;
}

/**
 * The permitted size nearest to the cells a corner was dragged to.
 *
 * Nearest by how many columns and rows it is off, added together; between two as near, the
 * smaller wins, so a card never grows further than the hand asked.
 *
 * @param allowed - The sizes the card is drawn for.
 * @param w - The columns under the pointer.
 * @param h - The rows under the pointer.
 * @param columns - How many columns the grid it sits on has.
 * @returns The size it settles on.
 */
export function snapSize(
  allowed: readonly CardSize[],
  w: number,
  h: number,
  columns: number,
): CardSize {
  const fitting = allowed.filter((size) => size.w <= columns);
  const candidates = fitting.length === 0 ? allowed : fitting;

  return (
    [...candidates].sort(
      (a, b) =>
        Math.abs(a.w - w) + Math.abs(a.h - h) - (Math.abs(b.w - w) + Math.abs(b.h - h)) ||
        a.w * a.h - b.w * b.h ||
        a.w - b.w,
    )[0] ?? TILE
  );
}

/**
 * The next size up or down from where a card is, for resizing from the keyboard.
 *
 * Sizes are ordered by how many cells they cover, the narrower first between two as large.
 *
 * @param allowed - The sizes the card is drawn for.
 * @param current - Its size now.
 * @param direction - Larger or smaller.
 * @param columns - How many columns the grid it sits on has.
 * @returns The next size, or the same one at either end.
 */
export function stepSize(
  allowed: readonly CardSize[],
  current: CardSize,
  direction: 1 | -1,
  columns: number,
): CardSize {
  const ordered = allowed
    .filter((size) => size.w <= columns)
    .sort((a, b) => a.w * a.h - b.w * b.h || a.w - b.w);
  const index = ordered.findIndex((size) => sameSize(size, current));
  const next = ordered[index === -1 ? 0 : index + direction];

  return next ?? current;
}

/** What an entity can do that decides its card, richest first. */
const RICHEST_FIRST: readonly (readonly [CapabilityName, EntityCardKind])[] = [
  ['thermostat', 'thermostat'],
  ['media_player', 'media'],
  ['camera', 'camera'],
  ['vacuum', 'vacuum'],
  ['lawn_mower', 'mower'],
  ['image', 'picture'],
  ['cover', 'cover'],
  ['lock', 'lock'],
  ['level', 'light'],
  ['color_hs', 'light'],
  ['color_temp', 'light'],
  ['on_off', 'switch'],
  ['sensor_numeric', 'sensor'],
  ['sensor_binary', 'binary'],
  ['select', 'select'],
  ['number', 'number'],
  ['button', 'button'],
  ['update', 'update'],
  ['custom', 'custom'],
];

/**
 * The kind of card an entity is drawn as, from what it can do.
 *
 * The richest control wins: a thermostat that also switches is a thermostat, a lamp that dims is a
 * light, and a light that only switches is still a light. An entity with none of these is drawn by
 * its reading.
 *
 * @param entity - Its domain and capabilities.
 * @returns The kind.
 */
export function cardKindOf(entity: Pick<EntityView, 'domain' | 'capabilities'>): EntityCardKind {
  const found = RICHEST_FIRST.find(([capability]) => hasCapability(entity, capability));
  const kind = found?.[1] ?? 'text';

  return entity.domain === 'light' && (kind === 'switch' || kind === 'text') ? 'light' : kind;
}

/** A size of an entity's kind that this entity cannot fill, and why, in a few words. */
export type MissingSize = { readonly size: CardSize; readonly reason: string };

/**
 * The sizes of its kind an entity cannot fill: a size with nothing left to show once the controls
 * it lacks are left out is not offered. The settings panel names them under its size choice.
 *
 * @param entity - Its domain and capabilities.
 * @returns Each size it cannot take, with why.
 */
export function missingSizes(
  entity: Pick<EntityView, 'domain' | 'capabilities'>,
): readonly MissingSize[] {
  const kind = cardKindOf(entity);

  // A light that only switches is drawn as a switch: its square would be a switch with a hole.
  if (kind === 'light' && !hasCapability(entity, 'level')) {
    return [
      {
        size: SQUARE,
        reason: translate(
          'dashboard.cardSizes.lightWithoutBrightness',
          'this light has no brightness',
        ),
      },
    ];
  }

  return [];
}

/**
 * The sizes an entity's card may take: those of its kind, less the ones it cannot fill.
 *
 * @param entity - Its domain and capabilities.
 * @returns The sizes, smallest first as its kind lists them.
 */
export function allowedSizes(
  entity: Pick<EntityView, 'domain' | 'capabilities'>,
): readonly CardSize[] {
  const missing = missingSizes(entity);

  return CARD_SIZES[cardKindOf(entity)].sizes.filter(
    (size) => !missing.some((each) => sameSize(each.size, size)),
  );
}
