/**
 * Dashboards: the house's pages of cards, laid out on a grid and shown to the people they are for.
 *
 * A dashboard is made and laid out by whoever holds `dashboard:manage`, and assigned to any number
 * of accounts - none, one, or everyone in the house. Each person's Dashboards page shows the ones
 * assigned to them, read-only; a change saved in the editor is what every one of them sees next.
 *
 * The layout is one document, read and written whole: the editor saves what the person sees when
 * they press Done, and a container holds cards of its own, which a set of rows would have to
 * reassemble. Cards name entities by their address (`light.kitchen`) rather than by a row id, so a
 * removed entity leaves a card that says so instead of a hole, and a dashboard could one day travel
 * to another house and be remapped there.
 *
 * The grid is four columns wide. A card sits at a column and a row and spans a number of each; the
 * web interface keeps the cards packed towards the top. What sizes each kind of card may take is
 * the interface's business - here only the bounds the document must respect are checked: a card
 * inside its grid, no two cards on the same cell, no container inside another.
 */
import { z } from 'zod';

import { entityIdSchema } from './entity-id.js';
import type { EntityRequirement } from './entity-requirement.js';
import { iconIdSchema } from './icons.js';
import { timestampSchema } from './timestamp.js';

/** How many columns the dashboard grid has. A container's own grid is as wide as it is. */
export const DASHBOARD_COLUMNS = 4;

/** The furthest row a card may start on: far past any page a person would scroll. */
export const DASHBOARD_ROWS_MAXIMUM = 1000;

/** How many cards one dashboard may hold, counting the ones inside containers. */
export const DASHBOARD_CARDS_MAXIMUM = 200;

/** How many dashboards the house may keep. */
export const DASHBOARDS_MAXIMUM = 100;

/** Which revision of the layout format a stored document is written in. */
export const DASHBOARD_LAYOUT_VERSION = 1;

/** The kinds of card a dashboard holds. */
export const DASHBOARD_CARD_TYPES = ['entity', 'scene', 'clock', 'energy', 'container'] as const;

/** The kind of a card. */
export type DashboardCardType = (typeof DASHBOARD_CARD_TYPES)[number];

/** How far back a card that draws history looks. */
export const DASHBOARD_HISTORY_RANGES = ['1h', '24h', '7d'] as const;

/** How far back a card that draws history looks. */
export type DashboardHistoryRange = (typeof DASHBOARD_HISTORY_RANGES)[number];

/**
 * A card's identifier inside its dashboard.
 *
 * Made by the browser when the card is added, because a card exists in the editor's draft long
 * before anything is saved. Unique within one dashboard only.
 */
export const dashboardCardIdSchema = z
  .string()
  .regex(/^[a-z0-9]{8,32}$/, 'Must be 8 to 32 lower case letters and digits');

/** What a card's title may be: a person's own words, or null for the thing's own name. */
const cardTitleSchema = z.string().trim().min(1).max(60).nullable();

/** Where a card sits and how much of the grid it covers, in cells. */
const placement = {
  id: dashboardCardIdSchema,
  x: z
    .int()
    .min(0)
    .max(DASHBOARD_COLUMNS - 1),
  y: z.int().min(0).max(DASHBOARD_ROWS_MAXIMUM),
  w: z.int().min(1).max(DASHBOARD_COLUMNS),
  h: z.int().min(1).max(DASHBOARD_ROWS_MAXIMUM),
};

/** A card showing one entity, drawn from what that entity can do. */
export const dashboardEntityCardSchema = z.object({
  ...placement,
  type: z.literal('entity'),
  entityId: entityIdSchema,
  title: cardTitleSchema,
  icon: iconIdSchema.nullable(),

  /** How far back its chart looks, when it draws one; null for the card's own default. */
  range: z.enum(DASHBOARD_HISTORY_RANGES).nullable(),
});

/** A card showing one entity. */
export type DashboardEntityCard = z.output<typeof dashboardEntityCardSchema>;

/** A card that applies a scene when pressed. */
export const dashboardSceneCardSchema = z.object({
  ...placement,
  type: z.literal('scene'),
  sceneId: z.uuid(),
  title: cardTitleSchema,
  icon: iconIdSchema.nullable(),
});

/** A card that applies a scene. */
export type DashboardSceneCard = z.output<typeof dashboardSceneCardSchema>;

/** A card showing the time, in the reader's own time zone. */
export const dashboardClockCardSchema = z.object({
  ...placement,
  type: z.literal('clock'),
  showSeconds: z.boolean(),
  showDate: z.boolean(),
});

/** A card showing the time. */
export type DashboardClockCard = z.output<typeof dashboardClockCardSchema>;

/**
 * A card drawing where the house's power comes from and goes to: the solar roof, the battery, the
 * grid and the house itself, with the flow between them.
 *
 * Every entity is optional. A house without panels or without a battery draws no panels and no
 * battery, and the house's own draw, when no meter reports it, is what the others add up to. The
 * two sign switches exist because meters disagree: some report import as positive and some as
 * negative, and a battery may count discharge either way.
 */
export const dashboardEnergyCardSchema = z.object({
  ...placement,
  type: z.literal('energy'),
  title: cardTitleSchema,

  /** What the panels produce now, in W or kW. */
  solarPower: entityIdSchema.nullable(),

  /** What flows in or out of the battery now, in W or kW. */
  batteryPower: entityIdSchema.nullable(),

  /** How full the battery is, in percent. */
  batteryLevel: entityIdSchema.nullable(),

  /** What flows between the house and the grid now, in W or kW. */
  gridPower: entityIdSchema.nullable(),

  /** What the house uses now, in W or kW; computed from the others when null. */
  homePower: entityIdSchema.nullable(),

  /** Whether the grid meter reports power bought from the grid as positive. */
  isGridImportPositive: z.boolean().default(true),

  /** Whether the battery reports discharging as positive. */
  isBatteryDischargePositive: z.boolean().default(true),
});

/** A card drawing where the house's power comes from and goes to. */
export type DashboardEnergyCard = z.output<typeof dashboardEnergyCardSchema>;

/** A power meter: a number in watts, or in a multiple of them. */
const POWER_METER: EntityRequirement = { capability: 'sensor_numeric', deviceClasses: ['power'] };

/**
 * What each meter of an energy card must be: a power meter for the flows, a battery level for the
 * battery's charge. A picker offers only what meets it.
 */
export const ENERGY_CARD_REQUIREMENTS = {
  solarPower: POWER_METER,
  batteryPower: POWER_METER,
  batteryLevel: { capability: 'sensor_numeric', deviceClasses: ['battery'] },
  gridPower: POWER_METER,
  homePower: POWER_METER,
} as const satisfies Record<
  keyof Pick<
    DashboardEnergyCard,
    'solarPower' | 'batteryPower' | 'batteryLevel' | 'gridPower' | 'homePower'
  >,
  EntityRequirement
>;

/** A card that can sit inside a container: anything but another container. */
export const dashboardLeafCardSchema = z.discriminatedUnion('type', [
  dashboardEntityCardSchema,
  dashboardSceneCardSchema,
  dashboardClockCardSchema,
  dashboardEnergyCardSchema,
]);

/** A card that can sit inside a container. */
export type DashboardLeafCard = z.output<typeof dashboardLeafCardSchema>;

/**
 * A titled box holding cards of its own, on a grid as wide as the box.
 *
 * Its first row is its heading; the cards inside start below it, at their own row 0. Its height
 * follows what it holds, so `h` is always at least one more than the rows its cards reach.
 */
export const dashboardContainerCardSchema = z.object({
  ...placement,
  type: z.literal('container'),
  title: z.string().trim().min(1).max(60),
  icon: iconIdSchema.nullable(),
  cards: z.array(dashboardLeafCardSchema).max(DASHBOARD_CARDS_MAXIMUM),
});

/** A titled box holding cards of its own. */
export type DashboardContainerCard = z.output<typeof dashboardContainerCardSchema>;

/** Any card on a dashboard. */
export const dashboardCardSchema = z.discriminatedUnion('type', [
  dashboardEntityCardSchema,
  dashboardSceneCardSchema,
  dashboardClockCardSchema,
  dashboardEnergyCardSchema,
  dashboardContainerCardSchema,
]);

/** Any card on a dashboard. */
export type DashboardCard = z.output<typeof dashboardCardSchema>;

/** The part of a card the grid cares about. */
type Placed = Pick<DashboardCard, 'id' | 'x' | 'y' | 'w' | 'h'>;

/**
 * Says what is wrong with one grid of cards, if anything.
 *
 * @param cards - The cards on the grid.
 * @param width - How many columns it has.
 * @returns A sentence and the index of the card it is about, or null when the grid is sound.
 */
function gridProblem(
  cards: readonly Placed[],
  width: number,
): { readonly message: string; readonly index: number } | null {
  for (const [index, card] of cards.entries()) {
    if (card.x + card.w > width) {
      return {
        message: `Card ${card.id} runs past the ${String(width)} columns it sits in`,
        index,
      };
    }

    for (const other of cards.slice(0, index)) {
      const apart =
        card.x >= other.x + other.w ||
        other.x >= card.x + card.w ||
        card.y >= other.y + other.h ||
        other.y >= card.y + card.h;

      if (!apart) {
        return { message: `Cards ${other.id} and ${card.id} cover the same cells`, index };
      }
    }
  }

  return null;
}

/** The cards on a dashboard, as one document. */
export const dashboardLayoutSchema = z
  .object({
    cards: z.array(dashboardCardSchema).max(DASHBOARD_CARDS_MAXIMUM),
  })
  .superRefine((layout, context) => {
    const seen = new Set<string>();
    let count = 0;

    /**
     * Counts one card and flags its id when another card already has it.
     *
     * @param id - The card's identifier.
     * @param path - Where it is in the document.
     */
    const note = (id: string, path: (string | number)[]): void => {
      count += 1;

      if (seen.has(id)) {
        context.addIssue({ code: 'custom', message: `Card id ${id} is used twice`, path });
      }

      seen.add(id);
    };

    const root = gridProblem(layout.cards, DASHBOARD_COLUMNS);

    if (root !== null) {
      context.addIssue({ code: 'custom', message: root.message, path: ['cards', root.index] });
    }

    for (const [index, card] of layout.cards.entries()) {
      note(card.id, ['cards', index, 'id']);

      if (card.type !== 'container') {
        continue;
      }

      const inner = gridProblem(card.cards, card.w);

      if (inner !== null) {
        context.addIssue({
          code: 'custom',
          message: inner.message,
          path: ['cards', index, 'cards', inner.index],
        });
      }

      const reach = Math.max(0, ...card.cards.map((child) => child.y + child.h));

      if (card.h < reach + 1) {
        context.addIssue({
          code: 'custom',
          message: `Container ${card.id} is shorter than the cards it holds`,
          path: ['cards', index, 'h'],
        });
      }

      for (const [childIndex, child] of card.cards.entries()) {
        note(child.id, ['cards', index, 'cards', childIndex, 'id']);
      }
    }

    if (count > DASHBOARD_CARDS_MAXIMUM) {
      context.addIssue({
        code: 'custom',
        message: `A dashboard holds at most ${String(DASHBOARD_CARDS_MAXIMUM)} cards`,
        path: ['cards'],
      });
    }
  });

/** The cards on a dashboard. */
export type DashboardLayout = z.output<typeof dashboardLayoutSchema>;

/** A dashboard with nothing on it yet. */
export const EMPTY_DASHBOARD_LAYOUT: DashboardLayout = { cards: [] };

/** How many people one dashboard may be assigned to: far past any household. */
export const DASHBOARD_ASSIGNEES_MAXIMUM = 200;

/** The accounts a dashboard is shown to, by id, each once. */
const dashboardUserIdsSchema = z
  .array(z.uuid())
  .max(DASHBOARD_ASSIGNEES_MAXIMUM)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'A person is listed twice' });

/** A dashboard. */
export const dashboardViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  icon: z.string().nullable(),
  layout: dashboardLayoutSchema,

  /** Which revision of the layout format it is written in. */
  layoutVersion: z.int().min(1),

  /** The accounts it is shown to. */
  userIds: z.array(z.uuid()),

  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

/** A dashboard. */
export type DashboardView = z.output<typeof dashboardViewSchema>;

/**
 * Someone a dashboard can be assigned to: every active account, named the way the interface
 * names people. Served to whoever manages dashboards, who need not also hold `user:read`.
 */
export const dashboardAssigneeSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});

/** Someone a dashboard can be assigned to. */
export type DashboardAssignee = z.output<typeof dashboardAssigneeSchema>;

/** What a dashboard's name may be. */
const dashboardNameSchema = z.string().trim().min(1).max(60);

/**
 * What creating a dashboard needs: a name, and optionally an icon, the cards to start with and
 * the people to show it to.
 */
export const dashboardCreateSchema = z.object({
  name: dashboardNameSchema,
  icon: iconIdSchema.nullable().optional(),
  layout: dashboardLayoutSchema.optional(),
  userIds: dashboardUserIdsSchema.optional(),
});

/** What creating a dashboard needs. */
export type DashboardCreate = z.output<typeof dashboardCreateSchema>;

/**
 * What changing a dashboard accepts.
 *
 * When `layout` is present it replaces the whole document: a save from the editor is exactly what
 * ends up stored. When `userIds` is present it replaces who the dashboard is shown to.
 */
export const dashboardUpdateSchema = z
  .object({
    name: dashboardNameSchema,
    icon: iconIdSchema.nullable(),
    layout: dashboardLayoutSchema,
    userIds: dashboardUserIdsSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Nothing to change',
  });

/** What changing a dashboard accepts. */
export type DashboardUpdate = z.output<typeof dashboardUpdateSchema>;

/** What a dashboard file says it is, so a reader can tell it apart from any other JSON. */
export const DASHBOARD_DOCUMENT_FORMAT = 'nebula-home/dashboard';

/** The ending an exported dashboard's file name carries. */
export const DASHBOARD_FILE_EXTENSION = '.dashboard.json';

/**
 * Says a file was written by a newer platform than this one.
 *
 * @param issue - The refused version.
 * @param issue.input - The version the file declares.
 * @returns The message.
 */
function newerFormat(issue: { readonly input: unknown }): string {
  return `Made by a newer NebulaHome (format ${String(issue.input)}): update to import it`;
}

/**
 * A dashboard as a file: the standard it is exported in, imported from, and one day shared as.
 *
 * Only what means the same in any house is in it - the name, the icon and the cards. No id, no
 * owner, no dates: those belong to the installation that stores it. Cards still name entities by
 * address and scenes by id; in another house the ones that match nothing say so, until the
 * Community Hub brings the remapping step (ARCHITECTURE.md 10.1).
 *
 * `version` is the layout format's, the one `layout_version` records on the row. A file from a
 * newer platform is refused by name rather than read half-understood.
 */
export const dashboardDocumentSchema = z.object({
  format: z.literal(DASHBOARD_DOCUMENT_FORMAT),
  version: z
    .int()
    .min(1)
    .refine((version) => version <= DASHBOARD_LAYOUT_VERSION, { error: newerFormat }),
  name: dashboardNameSchema,
  icon: iconIdSchema.nullable(),
  layout: dashboardLayoutSchema,
});

/** A dashboard as a file. */
export type DashboardDocument = z.output<typeof dashboardDocumentSchema>;

/**
 * Writes a dashboard out in the file standard.
 *
 * @param dashboard - The dashboard as the API serves it.
 * @returns What its file holds.
 */
export function toDashboardDocument(dashboard: DashboardView): DashboardDocument {
  return {
    format: DASHBOARD_DOCUMENT_FORMAT,
    version: dashboard.layoutVersion,
    name: dashboard.name,
    icon: dashboard.icon,
    layout: dashboard.layout,
  };
}

/**
 * The file name a dashboard is exported under: its name in lower case letters, digits and dashes.
 *
 * Accents are folded rather than dropped, so "Soggiorno è" is `soggiorno-e`, and a name with no
 * letters left becomes `dashboard`.
 *
 * @param name - The dashboard's name.
 * @returns The file name, ending in {@link DASHBOARD_FILE_EXTENSION}.
 */
export function dashboardFileName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replaceAll(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 60)
    .replaceAll(/-+$/g, '');

  return `${slug === '' ? 'dashboard' : slug}${DASHBOARD_FILE_EXTENSION}`;
}
