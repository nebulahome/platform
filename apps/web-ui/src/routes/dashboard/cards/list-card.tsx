/**
 * Entities of any kind as rows, each with its value or its one main control (`K-Overview`,
 * Entity list).
 */
import type { DashboardListCard } from '@nebulahome/contracts';

import { kindName } from '@/dashboard/card-options';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';

/** What the card needs. */
export type ListCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardListCard;

  /** What the page read for its cards. */
  readonly data: DashboardData;
};

/**
 * Renders the card.
 *
 * @param props - See {@link ListCardProps}.
 * @returns The card.
 */
export function ListCard(props: ListCardProps) {
  const { card } = props;

  return (
    <CardFrame label={card.title ?? kindName(card.type)}>
      <span className="text-caption text-foreground-subtle">{kindName(card.type)}</span>
    </CardFrame>
  );
}
