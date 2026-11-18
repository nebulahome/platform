/**
 * One card that is not a container, by its type, and the words a card is called by.
 */
import type { DashboardCard, DashboardLeafCard } from '@nebulahome/contracts';

import { kindName } from '@/dashboard/card-options';
import { translate } from '@/i18n/messages';
import { ActionsCard } from '@/routes/dashboard/cards/actions-card';
import { ActivityCard } from '@/routes/dashboard/cards/activity-card';
import { AutomationCard } from '@/routes/dashboard/cards/automation-card';
import { ClockCard } from '@/routes/dashboard/cards/clock-card';
import { CompareCard } from '@/routes/dashboard/cards/compare-card';
import { EnergyCard } from '@/routes/dashboard/cards/energy/energy-card';
import { EntityCard } from '@/routes/dashboard/cards/entity-card';
import { ListCard } from '@/routes/dashboard/cards/list-card';
import { PackageCard } from '@/routes/dashboard/cards/package-card';
import { RoomCard } from '@/routes/dashboard/cards/room-card';
import { SceneCard } from '@/routes/dashboard/cards/scene-card';
import { ShortcutCard } from '@/routes/dashboard/cards/shortcut-card';
import { SummaryCard, summaryName } from '@/routes/dashboard/cards/summary-card';
import { TogetherCard } from '@/routes/dashboard/cards/together-card';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';

/** What drawing a card needs. */
export type CardViewProps = {
  readonly card: DashboardLeafCard;
  readonly data: DashboardData;

  /** Whether the dashboard is being edited. */
  readonly isEditing?: boolean;
};

/**
 * Renders a card that is not a container.
 *
 * @param props - See {@link CardViewProps}.
 * @returns The card.
 */
export function CardView(props: CardViewProps) {
  const { card, data, isEditing = false } = props;

  switch (card.type) {
    case 'entity':
      return <EntityCard card={card} data={data} />;
    case 'scene':
      return <SceneCard card={card} data={data} />;
    case 'clock':
      return <ClockCard card={card} />;
    case 'energy':
      return <EnergyCard card={card} data={data} />;
    case 'package':
      return <PackageCard card={card} isEditing={isEditing} />;
    case 'together':
      return <TogetherCard card={card} data={data} />;
    case 'summary':
      return <SummaryCard card={card} data={data} />;
    case 'room':
      return <RoomCard card={card} data={data} />;
    case 'list':
      return <ListCard card={card} data={data} />;
    case 'actions':
      return <ActionsCard card={card} data={data} />;
    case 'compare':
      return <CompareCard card={card} data={data} />;
    case 'activity':
      return <ActivityCard card={card} data={data} />;
    case 'automation':
      return <AutomationCard card={card} data={data} />;
    case 'shortcut':
      return <ShortcutCard card={card} data={data} />;
  }
}

/**
 * What a card is called: its own title, or the name of what it shows.
 *
 * @param card - The card.
 * @param data - What the page read, for the names.
 * @returns The name.
 */
export function cardTitle(card: DashboardCard, data: DashboardData): string {
  switch (card.type) {
    case 'entity': {
      const entity = data.entityById.get(card.entityId);

      return card.title ?? (entity === undefined ? card.entityId : data.entityTitleOf(entity));
    }
    case 'scene':
      return card.title ?? data.sceneById.get(card.sceneId)?.name ?? 'Scene';
    case 'clock':
      return translate('dashboard.cardView.clock', 'Clock');
    case 'energy':
      return card.title ?? 'Energy';
    case 'package':
      return (
        card.title ??
        data.packageById.get(card.packageId)?.ui?.cards.find((each) => each.id === card.cardId)
          ?.name ??
        `${card.packageId} · ${card.cardId}`
      );
    case 'together':
      return (
        card.title ??
        (card.members.mode === 'rule' ? areaNameOf(card.members.areaKey, data) : null) ??
        kindName(`together-${card.domain}`)
      );
    case 'summary':
      return card.title ?? summaryName(card.what);
    case 'room':
      return card.title ?? areaNameOf(card.areaKey, data) ?? kindName('room');
    case 'list':
    case 'actions':
    case 'compare':
    case 'activity':
    case 'automation':
    case 'shortcut':
      return card.title ?? kindName(card.type);
    case 'container':
      return card.title;
  }
}

/**
 * An area's name, read off the entities placed in it.
 *
 * @param areaKey - The area, or none.
 * @param data - What the page read.
 * @returns Its name; null when no entity sits there.
 */
function areaNameOf(areaKey: string | null, data: DashboardData): string | null {
  if (areaKey === null) {
    return null;
  }

  for (const entity of data.entityById.values()) {
    if (entity.areaKey === areaKey && entity.areaName !== null) {
      return entity.areaName;
    }
  }

  return null;
}
