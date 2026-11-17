/**
 * A tile that goes somewhere: a page, a package, a web address (`K-New`, Shortcut).
 */
import type { DashboardShortcutCard } from '@nebulahome/contracts';

import { kindName } from '@/dashboard/card-options';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';

/** What the card needs. */
export type ShortcutCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardShortcutCard;

  /** What the page read for its cards. */
  readonly data: DashboardData;
};

/**
 * Renders the card.
 *
 * @param props - See {@link ShortcutCardProps}.
 * @returns The card.
 */
export function ShortcutCard(props: ShortcutCardProps) {
  const { card } = props;

  return (
    <CardFrame label={card.title ?? kindName(card.type)}>
      <span className="text-caption text-foreground-subtle">{kindName(card.type)}</span>
    </CardFrame>
  );
}
