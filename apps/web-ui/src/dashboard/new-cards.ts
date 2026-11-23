/**
 * The cards "Add card" makes, each at the smallest size its kind is drawn at.
 *
 * Where a new card sits is left to the editor - the empty space chosen, or the first place it
 * fits; these only say what it is. A card starts small and is made larger in its settings, with
 * the card itself in sight, rather than in a choice of sizes before it is seen.
 */
import {
  entityIdSchema,
  type DashboardClockCard,
  type DashboardContainerCard,
  type DashboardEnergyCard,
  type DashboardEntityCard,
  type DashboardPackageCard,
  type DashboardSceneCard,
  type EntityView,
  type PackageCard,
  type DashboardActionsCard,
  type DashboardActivityCard,
  type DashboardAgendaCard,
  type DashboardAutomationCard,
  type DashboardCompareCard,
  type DashboardListCard,
  type DashboardRoomCard,
  type DashboardShortcutCard,
  type DashboardSummaryCard,
  type DashboardTogetherCard,
  type SummarySubject,
  type TogetherDomain,
} from '@nebulahome/contracts';

import {
  allowedSizes,
  CARD_SIZES,
  cardKindOf,
  packageCardSizes,
  type EntityCardKind,
} from '@/dashboard/card-sizes';
import { newCardId } from '@/dashboard/dashboard-layout';

/**
 * A card showing an entity.
 *
 * @param entity - The entity.
 * @returns The card, at the smallest size the entity's card takes: the rest is set in its settings.
 */
export function entityCardFor(
  entity: Pick<EntityView, 'entityId' | 'domain' | 'capabilities'>,
): DashboardEntityCard {
  const size = allowedSizes(entity)[0] ?? CARD_SIZES[cardKindOf(entity)].preferred;

  return {
    id: newCardId(),
    type: 'entity',
    x: 0,
    y: 0,
    ...size,
    entityId: entity.entityId,
    title: null,
    icon: null,
    range: null,
  };
}

/**
 * A card of a kind added from the catalogue before its entity is chosen: it points at no entity
 * (`pending.<its id>`), is drawn dashed while the layout is edited, and is left out when it is
 * saved without one.
 *
 * @param kind - The kind of card it will be.
 * @returns The card, at the smallest size of its kind.
 */
export function pendingCardFor(kind: EntityCardKind): DashboardEntityCard {
  const id = newCardId();
  const [size = CARD_SIZES[kind].preferred] = CARD_SIZES[kind].sizes;

  return {
    id,
    type: 'entity',
    x: 0,
    y: 0,
    ...size,
    entityId: entityIdSchema.parse(`pending.${id}`),
    title: null,
    icon: null,
    range: null,
  };
}

/**
 * A card applying a scene.
 *
 * @param sceneId - The scene.
 * @returns The card.
 */
export function sceneCardFor(sceneId: string): DashboardSceneCard {
  return {
    id: newCardId(),
    type: 'scene',
    x: 0,
    y: 0,
    ...CARD_SIZES.scene.preferred,
    sceneId,
    title: null,
    icon: null,
  };
}

/**
 * A clock showing the date as well.
 *
 * @returns The card.
 */
export function clockCard(): DashboardClockCard {
  return {
    id: newCardId(),
    type: 'clock',
    x: 0,
    y: 0,
    ...(CARD_SIZES.clock.sizes[0] ?? CARD_SIZES.clock.preferred),
    showSeconds: false,
    showDate: true,
  };
}

/**
 * An energy card with no meters yet: its settings say which entities are the panels, the battery
 * and the grid.
 *
 * @returns The card.
 */
export function energyCard(): DashboardEnergyCard {
  return {
    id: newCardId(),
    type: 'energy',
    x: 0,
    y: 0,
    ...CARD_SIZES.energy.preferred,
    title: null,
    solarPower: null,
    batteryPower: null,
    batteryLevel: null,
    gridPower: null,
    homePower: null,
    isGridImportPositive: true,
    isBatteryDischargePositive: true,
    houseStyle: 'european',
  };
}

/**
 * An empty container, as wide as the page.
 *
 * @param title - What it is headed.
 * @returns The card.
 */
export function containerCard(title: string): DashboardContainerCard {
  return {
    id: newCardId(),
    type: 'container',
    x: 0,
    y: 0,
    w: 4,
    h: 2,
    title,
    icon: null,
    cards: [],
  };
}

/**
 * A new card of a package's, at the size its manifest adds it at.
 *
 * @param packageId - The package.
 * @param declared - The card, as its manifest declares it.
 * @returns The card, with the defaults its options declare.
 */
export function packageCardFor(packageId: string, declared: PackageCard): DashboardPackageCard {
  const [size = CARD_SIZES.package.preferred] = packageCardSizes(declared.sizes);
  const options: DashboardPackageCard['options'] = {};

  for (const field of declared.options) {
    if ('default' in field && field.default !== undefined) {
      options[field.key] = field.default;
    }
  }

  return {
    id: newCardId(),
    type: 'package',
    x: 0,
    y: 0,
    ...size,
    packageId,
    cardId: declared.id,
    title: null,
    options,
  };
}

/** What a card of a new type starts as: the parts every card has, at its smallest size. */
type Start = {
  readonly id: string;
  readonly x: 0;
  readonly y: 0;
  readonly w: number;
  readonly h: number;
};

/**
 * Where a new card of a type starts: a fresh id, at the smallest size of its type.
 *
 * @param type - The type.
 * @returns Its id and its cells.
 */
function startOf(type: keyof typeof CARD_SIZES): Start {
  const [size = CARD_SIZES[type].preferred] = CARD_SIZES[type].sizes;

  return { id: newCardId(), x: 0, y: 0, ...size };
}

/**
 * A card for every entity of a kind in the house - by rule, so new ones join by themselves.
 *
 * @param domain - The kind it stands for.
 * @returns The card.
 */
export function togetherCardFor(domain: TogetherDomain): DashboardTogetherCard {
  return {
    ...startOf('together'),
    type: 'together',
    domain,
    members: { mode: 'rule', areaKey: null, exclude: [] },
    title: null,
    icon: null,
  };
}

/**
 * A card counting one thing that needs a look, across the house.
 *
 * @param what - What it counts.
 * @returns The card.
 */
export function summaryCardFor(what: SummarySubject): DashboardSummaryCard {
  return { ...startOf('summary'), type: 'summary', what, areaKey: null, title: null };
}

/**
 * A room's card, before its room is chosen (`pending` until then).
 *
 * @param areaKey - The room, when it is known.
 * @returns The card.
 */
export function roomCardFor(areaKey = 'pending'): DashboardRoomCard {
  return { ...startOf('room'), type: 'room', areaKey, title: null, icon: null };
}

/**
 * An entity list with nothing on it yet.
 *
 * @returns The card.
 */
export function listCard(): DashboardListCard {
  return { ...startOf('list'), type: 'list', entityIds: [], title: null, icon: null };
}

/**
 * A quick-actions card with no button yet.
 *
 * @returns The card.
 */
export function actionsCard(): DashboardActionsCard {
  return { ...startOf('actions'), type: 'actions', items: [], title: null };
}

/**
 * A comparison with no reading yet.
 *
 * @returns The card.
 */
export function compareCard(): DashboardCompareCard {
  return { ...startOf('compare'), type: 'compare', entityIds: [], range: null, title: null };
}

/**
 * What happened lately in the whole house.
 *
 * @returns The card.
 */
export function activityCard(): DashboardActivityCard {
  return { ...startOf('activity'), type: 'activity', scope: { kind: 'house' }, title: null };
}

/**
 * The coming events of every calendar.
 *
 * @returns The card.
 */
export function agendaCard(): DashboardAgendaCard {
  return { ...startOf('agenda'), type: 'agenda', calendarIds: [], title: null };
}

/** The automation a new automation card points at until one is chosen. */
export const NO_AUTOMATION = '00000000-0000-4000-8000-000000000000';

/**
 * An automation's card, before its automation is chosen.
 *
 * @returns The card.
 */
export function automationCard(): DashboardAutomationCard {
  return {
    ...startOf('automation'),
    type: 'automation',
    automationId: NO_AUTOMATION,
    title: null,
    icon: null,
  };
}

/**
 * A shortcut, to the dashboards until somewhere else is chosen.
 *
 * @returns The card.
 */
export function shortcutCard(): DashboardShortcutCard {
  return {
    ...startOf('shortcut'),
    type: 'shortcut',
    target: { kind: 'page', path: '/dashboards' },
    title: null,
    icon: null,
  };
}
