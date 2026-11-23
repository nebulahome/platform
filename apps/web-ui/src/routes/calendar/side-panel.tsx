/**
 * The panel on the right of the page (CAL-Month): Today over the calendars. The toolbar's button
 * hides it, and whether it is shown is remembered for whoever is in front of this browser. It
 * glides shut and open as the sidebar does (`PanelSlot`), the year's own panel too.
 */
import type { ReactNode } from 'react';

import type { CalendarOccurrence } from '@nebulahome/contracts';
import { cn } from '@nebulahome/ui';

import { useReducedMotion } from '@/lib/use-reduced-motion';

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
    <aside className="flex w-70 flex-col gap-4">
      <TodayCard book={book} occurrences={ahead} onOpen={onOpen} onShowDay={onShowDay} />
      <CalendarList book={book} onHiddenChange={onHiddenChange} />
    </aside>
  );
}

/** What the slot needs. */
export type PanelSlotProps = {
  readonly isOpen: boolean;
  readonly children: ReactNode;
};

/**
 * Holds a side panel, 280 px wide, and folds it to nothing: its width, the row's gap and its
 * opacity glide with the sidebar's timing, so the view beside it widens rather than jumps. The
 * panel stays drawn while shut, out of reach (`inert`), so it can glide back.
 *
 * @param props - See {@link PanelSlotProps}.
 * @returns The slot.
 */
export function PanelSlot(props: PanelSlotProps) {
  const { isOpen, children } = props;
  const isReduced = useReducedMotion();

  return (
    <div
      inert={!isOpen}
      aria-hidden={isOpen ? undefined : true}
      className={cn(
        'shrink-0 overflow-hidden',
        isReduced
          ? undefined
          : 'transition-[width,margin-left,opacity] duration-220 ease-[cubic-bezier(0.22,1,0.36,1)]',
        // The row's gap is 20 px: shut, the slot gives it back.
        isOpen ? 'w-70 opacity-100' : '-ml-5 w-0 opacity-0',
      )}
    >
      <div className="w-70">{children}</div>
    </div>
  );
}
