/**
 * Plain buttons with no readings: scenes, buttons and switches (`K-Overview`, Quick actions).
 */
import type { DashboardActionsCard } from '@nebulahome/contracts';

import { kindName } from '@/dashboard/card-options';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';

/** What the card needs. */
export type ActionsCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardActionsCard;

  /** What the page read for its cards. */
  readonly data: DashboardData;
};

/**
 * Renders the card.
 *
 * @param props - See {@link ActionsCardProps}.
 * @returns The card.
 */
export function ActionsCard(props: ActionsCardProps) {
  const { card } = props;

  return (
    <CardFrame label={card.title ?? kindName(card.type)}>
      <span className="text-caption text-foreground-subtle">{kindName(card.type)}</span>
    </CardFrame>
  );
}
