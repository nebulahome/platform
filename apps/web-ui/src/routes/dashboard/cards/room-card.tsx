/**
 * One area in one card: its climate on top, then a row for each kind of thing it has
 * (`K-Overview`, Room).
 */
import type { DashboardRoomCard } from '@nebulahome/contracts';

import { kindName } from '@/dashboard/card-options';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';

/** What the card needs. */
export type RoomCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardRoomCard;

  /** What the page read for its cards. */
  readonly data: DashboardData;
};

/**
 * Renders the card.
 *
 * @param props - See {@link RoomCardProps}.
 * @returns The card.
 */
export function RoomCard(props: RoomCardProps) {
  const { card } = props;

  return (
    <CardFrame label={card.title ?? kindName(card.type)}>
      <span className="text-caption text-foreground-subtle">{kindName(card.type)}</span>
    </CardFrame>
  );
}
