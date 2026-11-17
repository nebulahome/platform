/**
 * What needs a look, counted across the house or one area: doors open, lights on, batteries low,
 * updates ready, entities out of reach (`K-Overview`, Summary).
 */
import type { DashboardSummaryCard } from '@nebulahome/contracts';

import { kindName } from '@/dashboard/card-options';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';

/** What the card needs. */
export type SummaryCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardSummaryCard;

  /** What the page read for its cards. */
  readonly data: DashboardData;
};

/**
 * Renders the card.
 *
 * @param props - See {@link SummaryCardProps}.
 * @returns The card.
 */
export function SummaryCard(props: SummaryCardProps) {
  const { card } = props;

  return (
    <CardFrame label={card.title ?? kindName(card.type)}>
      <span className="text-caption text-foreground-subtle">{kindName(card.type)}</span>
    </CardFrame>
  );
}
