/**
 * The calendars, under Today in the side panel (CAL-Month): each one's mark turns it on and off,
 * grouped by whose it is - the house's, the people's, and the ones read from outside. With some
 * off, the foot says how many are on and offers them all back.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { CalendarView } from '@nebulahome/contracts';
import { AppIcon, cn } from '@nebulahome/ui';

import { CalendarMark } from './model-token';
import type { CalendarBook } from './use-calendars';

/** The groups of the list, in order. */
const GROUPS = ['house', 'people', 'outside'] as const;

/**
 * Which group a calendar is in.
 *
 * @param calendar - The calendar.
 * @returns The people's for a person's, outside for one with a source, else the house's.
 */
function groupOf(calendar: CalendarView): (typeof GROUPS)[number] {
  if (calendar.kind === 'personal') {
    return 'people';
  }

  return calendar.icsUrl !== null || calendar.icsFile !== null ? 'outside' : 'house';
}

/** What the list needs. */
export type CalendarListProps = {
  readonly book: CalendarBook;

  /** Called with the calendars to keep off. */
  readonly onHiddenChange: (hidden: readonly string[]) => void;
};

/**
 * Renders the calendars.
 *
 * @param props - See {@link CalendarListProps}.
 * @returns The card.
 */
export function CalendarList(props: CalendarListProps) {
  const { t } = useTranslation();
  const { book, onHiddenChange } = props;
  const { calendars, hidden } = book;
  const offCount = calendars.filter((calendar) => hidden.has(calendar.id)).length;
  const titles = {
    house: t('calendar.list.house', 'House'),
    people: t('calendar.list.people', 'People'),
    outside: t('calendar.list.outside', 'From outside'),
  };

  return (
    <section
      aria-label={t('calendar.list.label', 'Calendars')}
      className="flex flex-col gap-1.5 rounded-panel border border-border bg-surface px-2.5 pt-3.5 pb-2.5"
    >
      <div className="flex items-center justify-between px-2 pb-0.5">
        <span className="text-title font-medium">{t('calendar.list.label', 'Calendars')}</span>
        <Link
          to="/calendar/settings"
          className="rounded-check text-ui-sm text-primary hover:text-primary-hover focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t('calendar.list.manage', 'Manage')}
        </Link>
      </div>

      {GROUPS.map((group) => {
        const items = calendars.filter((calendar) => groupOf(calendar) === group);

        return items.length === 0 ? null : (
          <div key={group} role="group" aria-label={titles[group]} className="flex flex-col">
            <span className="flex h-6.5 items-center px-2 font-mono text-label text-foreground-disabled uppercase">
              {titles[group]}
            </span>
            {items.map((calendar) => {
              const isOn = !hidden.has(calendar.id);

              return (
                <button
                  key={calendar.id}
                  type="button"
                  aria-pressed={isOn}
                  onClick={() => {
                    onHiddenChange(
                      isOn
                        ? [...hidden, calendar.id]
                        : [...hidden].filter((id) => id !== calendar.id),
                    );
                  }}
                  className={cn(
                    'flex h-8.5 w-full cursor-pointer items-center gap-2.75 rounded-field px-2 text-left text-ui-sm',
                    'hover:bg-surface-raised focus-visible:shadow-focus focus-visible:outline-none',
                    isOn ? 'text-foreground' : 'text-foreground-subtle',
                  )}
                >
                  <CalendarMark
                    name={calendar.name}
                    color={calendar.color}
                    icon={calendar.icon === null ? undefined : book.icons.get(calendar.icon)}
                    isPerson={calendar.kind === 'personal'}
                    isOn={isOn}
                  />
                  <span className="min-w-0 grow truncate">{calendar.name}</span>
                  {calendar.icsState?.error ? (
                    <AppIcon
                      id="triangle-alert"
                      size={14}
                      className="shrink-0 text-warning"
                      aria-label={t('calendar.list.sourceFailed', 'Its source could not be read')}
                    />
                  ) : group === 'outside' ? (
                    <AppIcon id="link" size={13} className="shrink-0 text-foreground-subtle" />
                  ) : null}
                </button>
              );
            })}
          </div>
        );
      })}

      {offCount === 0 ? null : (
        <div className="mt-1 flex items-center justify-between border-t border-border px-2 pt-2 pb-0.5">
          <span className="font-mono text-caption text-foreground-subtle">
            {t('calendar.list.shownOf', '{{shown}} of {{count}}', {
              shown: calendars.length - offCount,
              count: calendars.length,
            })}
          </span>
          <button
            type="button"
            onClick={() => {
              onHiddenChange([]);
            }}
            className="cursor-pointer rounded-check text-ui-sm text-primary hover:text-primary-hover focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t('calendar.list.showAll', 'Show all')}
          </button>
        </div>
      )}
    </section>
  );
}
