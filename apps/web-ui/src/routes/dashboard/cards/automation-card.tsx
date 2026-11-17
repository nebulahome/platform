/**
 * An automation: on or off, Run now, its last run and its next (`K-New`, Automation).
 */
import type { DashboardAutomationCard } from '@nebulahome/contracts';

import { kindName } from '@/dashboard/card-options';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';

/** What the card needs. */
export type AutomationCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardAutomationCard;

  /** What the page read for its cards. */
  readonly data: DashboardData;
};

/**
 * Renders the card.
 *
 * @param props - See {@link AutomationCardProps}.
 * @returns The card.
 */
export function AutomationCard(props: AutomationCardProps) {
  const { card } = props;

  return (
    <CardFrame label={card.title ?? kindName(card.type)}>
      <span className="text-caption text-foreground-subtle">{kindName(card.type)}</span>
    </CardFrame>
  );
}
