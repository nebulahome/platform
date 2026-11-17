/**
 * What happened lately, newest first, in the house, an area or a few entities (`K-New`,
 * Activity).
 */
import type { DashboardActivityCard } from '@nebulahome/contracts';

import { kindName } from '@/dashboard/card-options';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';

/** What the card needs. */
export type ActivityCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardActivityCard;

  /** What the page read for its cards. */
  readonly data: DashboardData;
};

/**
 * Renders the card.
 *
 * @param props - See {@link ActivityCardProps}.
 * @returns The card.
 */
export function ActivityCard(props: ActivityCardProps) {
  const { card } = props;

  return (
    <CardFrame label={card.title ?? kindName(card.type)}>
      <span className="text-caption text-foreground-subtle">{kindName(card.type)}</span>
    </CardFrame>
  );
}
