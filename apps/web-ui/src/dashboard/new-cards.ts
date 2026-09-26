/**
 * The cards "Add card" makes, each at the size its kind starts at.
 *
 * Where a new card sits is left to the layout, which puts it in the first place it fits; these only
 * say what it is. An entity's card starts at the size its kind is drawn best at - a light as a tall
 * card, a camera as a square - so the first thing on a new dashboard already looks like the mockup.
 */
import type {
  DashboardClockCard,
  DashboardContainerCard,
  DashboardEnergyCard,
  DashboardEntityCard,
  DashboardSceneCard,
  EntityView,
} from '@nebula-home/contracts';

import { CARD_SIZES, cardKindOf } from '@/dashboard/card-sizes';
import { newCardId } from '@/dashboard/dashboard-layout';

/**
 * A card showing an entity.
 *
 * @param entity - The entity.
 * @returns The card, at the size its kind starts at.
 */
export function entityCardFor(
  entity: Pick<EntityView, 'entityId' | 'domain' | 'capabilities'>,
): DashboardEntityCard {
  const size = CARD_SIZES[cardKindOf(entity)].preferred;

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
    ...CARD_SIZES.clock.preferred,
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
