/**
 * One card that is not a container, by its type, and the words a card is called by.
 */
import type { DashboardCard, DashboardLeafCard } from '@nebulahome/contracts';

import { translate } from '@/i18n/messages';
import { ClockCard } from '@/routes/dashboard/cards/clock-card';
import { EnergyCard } from '@/routes/dashboard/cards/energy/energy-card';
import { EntityCard } from '@/routes/dashboard/cards/entity-card';
import { PackageCard } from '@/routes/dashboard/cards/package-card';
import { SceneCard } from '@/routes/dashboard/cards/scene-card';
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
    case 'container':
      return card.title;
  }
}
