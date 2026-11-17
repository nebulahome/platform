/**
 * One card for many entities of a kind - every light of a room - with one state and controls
 * that act on all of them at once (`K-Aggregate`).
 */
import type { DashboardTogetherCard } from '@nebulahome/contracts';

import { kindName } from '@/dashboard/card-options';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';

/** What the card needs. */
export type TogetherCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardTogetherCard;

  /** What the page read for its cards. */
  readonly data: DashboardData;
};

/**
 * Renders the card.
 *
 * @param props - See {@link TogetherCardProps}.
 * @returns The card.
 */
export function TogetherCard(props: TogetherCardProps) {
  const { card } = props;

  return (
    <CardFrame label={card.title ?? kindName(card.type)}>
      <span className="text-caption text-foreground-subtle">{kindName(card.type)}</span>
    </CardFrame>
  );
}
