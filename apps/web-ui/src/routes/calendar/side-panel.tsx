/**
 * The panel on the right of the page (CAL-Month): Today over the calendars. The toolbar's button
 * hides it, and whether it is shown is remembered for whoever is in front of this browser.
 */
import type { CalendarOccurrence } from '@nebulahome/contracts';

import { CalendarList } from './calendar-list';
import { TodayCard } from './today-card';
import type { CalendarBook } from './use-calendars';

/** What the panel needs. */
export type SidePanelProps = {
  readonly book: CalendarBook;

  /** Every occurrence from today on, for the Today card. */
  readonly ahead: readonly CalendarOccurrence[];
  readonly onOpen: (occurrence: CalendarOccurrence, anchor: HTMLElement) => void;
  readonly onShowDay: (day: string) => void;
  readonly onHiddenChange: (hidden: readonly string[]) => void;
};

/**
 * Renders the side panel.
 *
 * @param props - See {@link SidePanelProps}.
 * @returns The panel.
 */
export function SidePanel(props: SidePanelProps) {
  const { book, ahead, onOpen, onShowDay, onHiddenChange } = props;

  return (
    <aside className="flex w-70 shrink-0 flex-col gap-4">
      <TodayCard book={book} occurrences={ahead} onOpen={onOpen} onShowDay={onShowDay} />
      <CalendarList book={book} onHiddenChange={onHiddenChange} />
    </aside>
  );
}
