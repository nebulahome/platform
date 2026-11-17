/**
 * Up to four readings of the same unit on one chart, each in the colour of its row (`K-New`,
 * Compare).
 */
import type { DashboardCompareCard } from '@nebulahome/contracts';

import { kindName } from '@/dashboard/card-options';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';

/** What the card needs. */
export type CompareCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardCompareCard;

  /** What the page read for its cards. */
  readonly data: DashboardData;
};

/**
 * Renders the card.
 *
 * @param props - See {@link CompareCardProps}.
 * @returns The card.
 */
export function CompareCard(props: CompareCardProps) {
  const { card } = props;

  return (
    <CardFrame label={card.title ?? kindName(card.type)}>
      <span className="text-caption text-foreground-subtle">{kindName(card.type)}</span>
    </CardFrame>
  );
}
