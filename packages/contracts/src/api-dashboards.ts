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
import { jsonObjectSchema } from './json.js';
import { packageIdSchema } from './package-manifest.js';
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
export const DASHBOARD_CARD_TYPES = [
  'entity',
  'scene',
  'clock',
  'energy',
  'package',
  'together',
  'summary',
  'room',
  'list',
  'actions',
  'compare',
  'activity',
  'automation',
  'shortcut',
  'agenda',
  'container',
] as const;

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

/** What a tap on an entity card does: open the entity, switch it on or off, or nothing. */
export const DASHBOARD_CARD_TAPS = ['sheet', 'toggle', 'none'] as const;

/** What a tap on an entity card does. */
export type DashboardCardTap = (typeof DASHBOARD_CARD_TAPS)[number];

/** How an entity card draws a reading's past. */
export const DASHBOARD_CHART_STYLES = ['line', 'bars'] as const;

/** How an entity card draws a reading's past. */
export type DashboardChartStyle = (typeof DASHBOARD_CHART_STYLES)[number];

/** A part of a card that its settings may switch off, by the card's own name for it. */
const cardPartSchema = z.string().regex(/^[a-z][a-z-]{0,31}$/);

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

  /**
   * The parts of the card switched off in its settings, by the names each kind of card gives its
   * parts ("presets", "brightness", "chart"). Absent, every part its size can hold is drawn.
   */
  hide: z.array(cardPartSchema).max(16).optional(),

  /** What a tap on the card does; absent, it opens the entity. */
  tap: z.enum(DASHBOARD_CARD_TAPS).optional(),

  /** How a reading's past is drawn: a line, or one bar an hour or a day for totals and prices. */
  chart: z.enum(DASHBOARD_CHART_STYLES).optional(),
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
 * The houses the energy card can draw: a European one under a gabled roof, an American one whose
 * garage wing stands in front of the house, and an Arabic one under a flat roof behind a parapet.
 * They differ in shape and detail only: every one is drawn in the same colours.
 */
export const HOUSE_STYLES = ['european', 'american', 'arabic'] as const;

/** A house the energy card can draw. */
export type HouseStyle = (typeof HOUSE_STYLES)[number];

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

  /** Which house the card draws; the European one unless the owner picks another. */
  houseStyle: z.enum(HOUSE_STYLES).default('european'),
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

/**
 * A card a package draws: which package, which of the cards its manifest declares
 * (`ui.cards[].id`), and the options its inspector asked, in the card's own grammar.
 *
 * The layout keeps it whether or not the package is installed: a package removed or stopped
 * leaves a card that says so and offers to put it back, rather than a hole in the grid.
 */
export const dashboardPackageCardSchema = z.object({
  ...placement,
  type: z.literal('package'),
  packageId: packageIdSchema,
  cardId: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/, 'Must be a card of the package'),
  title: cardTitleSchema,
  options: jsonObjectSchema.default({}),
});

/** A card a package draws. */
export type DashboardPackageCard = z.output<typeof dashboardPackageCardSchema>;

/** Where a card that reads many entities looks: one area, by its key, or the whole house. */
const areaKeySchema = z.string().trim().min(1).max(64).nullable();

/** The kinds of entity a card that gathers them can stand for. */
export const TOGETHER_DOMAINS = ['light', 'switch', 'cover', 'lock', 'thermostat'] as const;

/** The kind of entity a card that gathers them stands for. */
export type TogetherDomain = (typeof TOGETHER_DOMAINS)[number];

/**
 * Which entities a gathering card stands for: by rule - every one of its kind in an area, or in
 * the house, but the ones left out, so a new light in the Kitchen joins by itself - or by hand.
 */
export const togetherMembersSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('rule'),
    areaKey: areaKeySchema,
    exclude: z.array(entityIdSchema).max(64),
  }),
  z.object({ mode: z.literal('hand'), entityIds: z.array(entityIdSchema).max(64) }),
]);

/** Which entities a gathering card stands for. */
export type TogetherMembers = z.output<typeof togetherMembersSchema>;

/**
 * One card that stands for many entities of a kind - every light of the Kitchen - with one state:
 * how many are on, their average, and controls that act on all of them at once.
 */
export const dashboardTogetherCardSchema = z.object({
  ...placement,
  type: z.literal('together'),
  domain: z.enum(TOGETHER_DOMAINS),
  members: togetherMembersSchema,
  title: cardTitleSchema,
  icon: iconIdSchema.nullable(),
});

/** One card for many entities of a kind. */
export type DashboardTogetherCard = z.output<typeof dashboardTogetherCardSchema>;

/** What a summary counts. `glance` is the house at a glance: every count side by side. */
export const SUMMARY_SUBJECTS = [
  'openings',
  'lights',
  'batteries',
  'updates',
  'offline',
  'glance',
] as const;

/** What a summary counts. */
export type SummarySubject = (typeof SUMMARY_SUBJECTS)[number];

/** A card counting what needs a look - doors open, lights on, batteries low - in an area or all. */
export const dashboardSummaryCardSchema = z.object({
  ...placement,
  type: z.literal('summary'),
  what: z.enum(SUMMARY_SUBJECTS),
  areaKey: areaKeySchema,
  title: cardTitleSchema,
});

/** A card counting what needs a look. */
export type DashboardSummaryCard = z.output<typeof dashboardSummaryCardSchema>;

/** One area in one card: its climate, then a row for each kind of thing it has. */
export const dashboardRoomCardSchema = z.object({
  ...placement,
  type: z.literal('room'),
  areaKey: z.string().trim().min(1).max(64),
  title: cardTitleSchema,
  icon: iconIdSchema.nullable(),
});

/** One area in one card. */
export type DashboardRoomCard = z.output<typeof dashboardRoomCardSchema>;

/** Entities of any kind as rows, each with its value or its one main control. */
export const dashboardListCardSchema = z.object({
  ...placement,
  type: z.literal('list'),
  entityIds: z.array(entityIdSchema).max(12),
  title: cardTitleSchema,
  icon: iconIdSchema.nullable(),
});

/** Entities as rows. */
export type DashboardListCard = z.output<typeof dashboardListCardSchema>;

/** One button of a quick-actions card: a scene to apply, or a button or a switch to press. */
export const quickActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('scene'), sceneId: z.uuid() }),
  z.object({ kind: z.literal('entity'), entityId: entityIdSchema }),
]);

/** One button of a quick-actions card. */
export type QuickAction = z.output<typeof quickActionSchema>;

/** Plain buttons with no readings: scenes, buttons and switches. */
export const dashboardActionsCardSchema = z.object({
  ...placement,
  type: z.literal('actions'),
  items: z.array(quickActionSchema).max(6),
  title: cardTitleSchema,
});

/** Plain buttons. */
export type DashboardActionsCard = z.output<typeof dashboardActionsCardSchema>;

/** Up to four readings of the same unit, drawn on one chart. */
export const dashboardCompareCardSchema = z.object({
  ...placement,
  type: z.literal('compare'),
  entityIds: z.array(entityIdSchema).max(4),
  range: z.enum(DASHBOARD_HISTORY_RANGES).nullable(),
  title: cardTitleSchema,
});

/** Readings compared. */
export type DashboardCompareCard = z.output<typeof dashboardCompareCardSchema>;

/** What an activity card follows: the house, one area, or entities picked by hand. */
export const activityScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('house') }),
  z.object({ kind: z.literal('area'), areaKey: z.string().trim().min(1).max(64) }),
  z.object({ kind: z.literal('entities'), entityIds: z.array(entityIdSchema).max(32) }),
]);

/** What an activity card follows. */
export type ActivityScope = z.output<typeof activityScopeSchema>;

/** What happened lately, newest first, from the history the house keeps. Read only. */
export const dashboardActivityCardSchema = z.object({
  ...placement,
  type: z.literal('activity'),
  scope: activityScopeSchema,
  title: cardTitleSchema,
});

/** What happened lately. */
export type DashboardActivityCard = z.output<typeof dashboardActivityCardSchema>;

/** An automation: on or off, Run now, its last run and its next. */
export const dashboardAutomationCardSchema = z.object({
  ...placement,
  type: z.literal('automation'),
  automationId: z.uuid(),
  title: cardTitleSchema,
  icon: iconIdSchema.nullable(),
});

/** An automation's card. */
export type DashboardAutomationCard = z.output<typeof dashboardAutomationCardSchema>;

/** Where a shortcut goes: a page of the platform, a package's page, or a web address. */
export const shortcutTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('page'), path: z.string().regex(/^\/[^\s]{0,255}$/) }),
  z.object({ kind: z.literal('package'), packageId: packageIdSchema }),
  z.object({
    kind: z.literal('url'),
    url: z.url({ protocol: /^https?$/ }).max(1024),
  }),
]);

/** Where a shortcut goes. */
export type ShortcutTarget = z.output<typeof shortcutTargetSchema>;

/** A tile that goes somewhere: a page, a package, a web address. */
export const dashboardShortcutCardSchema = z.object({
  ...placement,
  type: z.literal('shortcut'),
  target: shortcutTargetSchema,
  title: cardTitleSchema,
  icon: iconIdSchema.nullable(),
});

/** A tile that goes somewhere. */
export type DashboardShortcutCard = z.output<typeof dashboardShortcutCardSchema>;

/** The coming events of some calendars, by day. Read only. */
export const dashboardAgendaCardSchema = z.object({
  ...placement,
  type: z.literal('agenda'),

  /** The calendars it shows; none means every calendar. */
  calendarIds: z.array(z.uuid()).max(100),
  title: cardTitleSchema,
});

/** The coming events of some calendars. */
export type DashboardAgendaCard = z.output<typeof dashboardAgendaCardSchema>;

/** A card that can sit inside a container: anything but another container. */
export const dashboardLeafCardSchema = z.discriminatedUnion('type', [
  dashboardEntityCardSchema,
  dashboardSceneCardSchema,
  dashboardClockCardSchema,
  dashboardEnergyCardSchema,
  dashboardPackageCardSchema,
  dashboardTogetherCardSchema,
  dashboardSummaryCardSchema,
  dashboardRoomCardSchema,
  dashboardListCardSchema,
  dashboardActionsCardSchema,
  dashboardCompareCardSchema,
  dashboardActivityCardSchema,
  dashboardAutomationCardSchema,
  dashboardShortcutCardSchema,
  dashboardAgendaCardSchema,
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
  dashboardPackageCardSchema,
  dashboardTogetherCardSchema,
  dashboardSummaryCardSchema,
  dashboardRoomCardSchema,
  dashboardListCardSchema,
  dashboardActionsCardSchema,
  dashboardCompareCardSchema,
  dashboardActivityCardSchema,
  dashboardAutomationCardSchema,
  dashboardShortcutCardSchema,
  dashboardAgendaCardSchema,
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
