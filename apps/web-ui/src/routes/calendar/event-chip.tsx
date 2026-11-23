/**
 * An occurrence as a line of a day (CAL-Month): a timed one is a dot of its calendar's colour, its
 * time and its title; an all-day one a filled chip of that colour. One that runs over several
 * days is a bar across them ({@link EventBar}), squared where it carries on into the next week.
 *
 * A press opens what it is (`event-popover.tsx`), beside it.
 */
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import type { CalendarOccurrence } from '@nebulahome/contracts';
import { AppIcon, CatalogueIcon, cn } from '@nebulahome/ui';

import { clockText } from './calendar-time';
import { LANE_CLASSES } from './model-token';
import { lookOf, type CalendarBook } from './use-calendars';

/** What a line needs. */
export type EventChipProps = {
  readonly occurrence: CalendarOccurrence;
  readonly book: CalendarBook;

  /** Whether it is over: drawn faded. */
  readonly isPast?: boolean;

  /** Called with the line pressed, to hang the event's details off. */
  readonly onOpen: (occurrence: CalendarOccurrence, anchor: HTMLElement) => void;
  readonly className?: string;
};

/**
 * Where an occurrence comes from, as a small mark after its title: a link for a source, a chip
 * for an entity, and in a list two arrows for a repeating event of the house's own.
 *
 * @param props - The occurrence and the mark's side.
 * @param props.occurrence - The occurrence.
 * @param props.size - The side, in pixels.
 * @param props.className - The mark's colour.
 * @param props.hasRepeat - Whether a repeating event of the house's own is marked too: in a list,
 *   not on the grid.
 * @returns The mark, or nothing for a one-off event.
 */
export function SourceMark(props: {
  readonly occurrence: CalendarOccurrence;
  readonly size?: number;
  readonly className?: string;
  readonly hasRepeat?: boolean;
}) {
  const { occurrence, size = 11, className, hasRepeat = false } = props;
  const id =
    occurrence.source === 'ics'
      ? 'link'
      : occurrence.source === 'entity'
        ? 'cpu'
        : occurrence.isRepeating && hasRepeat
          ? 'repeat'
          : null;

  return id === null ? null : (
    <AppIcon id={id} size={size} aria-hidden="true" className={cn('shrink-0', className)} />
  );
}

/**
 * Renders an occurrence as a line of a day.
 *
 * @param props - See {@link EventChipProps}.
 * @returns The line.
 */
export function EventChip(props: EventChipProps) {
  const { t } = useTranslation();
  const { occurrence, book, isPast = false, onOpen, className } = props;
  const look = lookOf(occurrence, book);
  const time =
    occurrence.isAllDay || occurrence.startsAt === null
      ? null
      : clockText(occurrence.startsAt, book.zone);

  return (
    <button
      type="button"
      title={occurrence.title}
      aria-label={
        time === null
          ? occurrence.title
          : t('calendar.chip.atTime', '{{time}}, {{title}}', { time, title: occurrence.title })
      }
      onClick={(event) => {
        onOpen(occurrence, event.currentTarget);
      }}
      className={cn(
        'flex h-5 w-full min-w-0 shrink-0 cursor-pointer items-center gap-1.5 text-left text-caption whitespace-nowrap',
        'focus-visible:shadow-focus focus-visible:outline-none',
        time === null
          ? 'rounded-check bg-[color-mix(in_srgb,var(--lane)_16%,transparent)] px-1.75 font-medium text-[var(--lane)] hover:bg-[color-mix(in_srgb,var(--lane)_24%,transparent)]'
          : 'rounded-check px-0.5 text-foreground hover:bg-surface-high',
        (isPast || occurrence.isStale) && 'opacity-55',
        LANE_CLASSES[look.color],
        className,
      )}
    >
      {time === null ? null : (
        <>
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[var(--lane)]" />
          <span className="shrink-0 font-mono text-label text-foreground-subtle">{time}</span>
        </>
      )}
      {look.icon === undefined ? null : (
        <CatalogueIcon
          node={look.icon.node}
          frame={look.icon.frame}
          size={11}
          className="shrink-0 text-[var(--lane)]"
        />
      )}
      {time === null ? <SourceMark occurrence={occurrence} /> : null}
      <span className="min-w-0 truncate">{occurrence.title}</span>
      {time === null ? null : (
        <SourceMark occurrence={occurrence} size={10} className="text-foreground-subtle" />
      )}
    </button>
  );
}

/** What a bar needs. */
export type EventBarProps = EventChipProps & {
  /** Whether it started before the first day of the row: no rounded start. */
  readonly startsBefore: boolean;

  /** Whether it carries on after the last day of the row: no rounded end, an arrow. */
  readonly endsAfter: boolean;

  /** Where it sits in the row's grid: its days and lane, measured by the caller. */
  readonly style?: CSSProperties;
};

/**
 * Renders an occurrence that runs over several days as a bar across them. Where it sits in the
 * row is the caller's.
 *
 * @param props - See {@link EventBarProps}.
 * @returns The bar.
 */
export function EventBar(props: EventBarProps) {
  const { occurrence, book, onOpen, startsBefore, endsAfter, className, style } = props;
  const look = lookOf(occurrence, book);

  return (
    <button
      type="button"
      title={occurrence.title}
      onClick={(event) => {
        onOpen(occurrence, event.currentTarget);
      }}
      // eslint-disable-next-line react/forbid-dom-props -- the caller's measured grid place.
      style={style}
      className={cn(
        'pointer-events-auto flex h-5 min-w-0 cursor-pointer items-center gap-1.5 px-2 text-left text-caption font-medium whitespace-nowrap',
        'bg-[color-mix(in_srgb,var(--lane)_20%,transparent)] text-[var(--lane)] hover:bg-[color-mix(in_srgb,var(--lane)_28%,transparent)]',
        'focus-visible:shadow-focus focus-visible:outline-none',
        startsBefore ? 'rounded-l-none' : 'ml-1.75 rounded-l-check',
        endsAfter ? 'rounded-r-none' : 'mr-1.75 rounded-r-check',
        occurrence.isStale && 'opacity-45',
        LANE_CLASSES[look.color],
        className,
      )}
    >
      {look.icon === undefined ? (
        <SourceMark occurrence={occurrence} />
      ) : (
        <CatalogueIcon
          node={look.icon.node}
          frame={look.icon.frame}
          size={11}
          className="shrink-0"
        />
      )}
      <span className="min-w-0 truncate">{occurrence.title}</span>
      {endsAfter ? <AppIcon id="arrow-right" size={12} className="ml-auto shrink-0" /> : null}
    </button>
  );
}
