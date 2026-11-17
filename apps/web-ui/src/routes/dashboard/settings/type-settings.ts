/**
 * What the settings of one type of card get in the floating panel: the card, what the page read,
 * a way to change the card, and a way to say the card now has what it waited for.
 */
import type { DashboardCard, DashboardLayout } from '@nebulahome/contracts';

import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';

/** What a type's settings get. */
export type TypeSettingsProps<TCard extends DashboardCard> = {
  /** The card, as the draft has it. */
  readonly card: TCard;

  /** The layout being edited: what else is on the page. */
  readonly layout: DashboardLayout;

  /** What the page read. */
  readonly data: DashboardData;

  /** Whether the card still waits for what it shows (a room, an automation), from the catalogue. */
  readonly isPending: boolean;

  /** Changes the card; the draft redraws it at once. */
  readonly onChange: (update: (current: DashboardCard) => DashboardCard) => void;

  /** The card now has what it waited for: it is no longer left out at Done. */
  readonly onSettled: () => void;
};
