/**
 * The row under the page's header (CAL-Month): back, Today and on in one segmented pill, then
 * what is shown; on the right the four views and the button that hides the side panel. On a
 * narrow window the views are two, Month and Agenda, and there is no panel to hide.
 */
import { useTranslation } from 'react-i18next';

import { AppIcon, cn, IconButton, Segmented } from '@nebulahome/ui';

import { CALENDAR_PAGE_VIEWS, type CalendarPageView } from './calendar-time';

/** One part of the back, Today and on pill: lit on hover, its focus drawn inside the pill. */
const SEGMENT =
  'flex cursor-pointer items-center text-foreground-muted transition-colors hover:bg-surface-high hover:text-foreground focus-visible:bg-surface-high focus-visible:shadow-[inset_0_0_0_2px_var(--color-primary)] focus-visible:outline-none';

/** What the toolbar needs. */
export type CalendarToolbarProps = {
  readonly view: CalendarPageView;
  readonly title: string;
  readonly onStep: (by: -1 | 1) => void;
  readonly onToday: () => void;
  readonly onViewChange: (view: CalendarPageView) => void;

  /** Whether the side panel shows; undefined when there is none to hide. */
  readonly isPanelOpen: boolean | undefined;
  readonly onPanelToggle: () => void;

  /** Whether the window is narrow: two views. */
  readonly isNarrow: boolean;
};

/**
 * Renders the toolbar.
 *
 * @param props - See {@link CalendarToolbarProps}.
 * @returns The row.
 */
export function CalendarToolbar(props: CalendarToolbarProps) {
  const { t } = useTranslation();
  const { view, title, onStep, onToday, onViewChange, isPanelOpen, onPanelToggle, isNarrow } =
    props;
  const names: Readonly<Record<CalendarPageView, string>> = {
    week: t('calendar.views.week', 'Week'),
    month: t('calendar.views.month', 'Month'),
    year: t('calendar.views.year', 'Year'),
    agenda: t('calendar.views.agenda', 'Agenda'),
  };
  const views = isNarrow ? (['month', 'agenda'] as const) : CALENDAR_PAGE_VIEWS;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="flex min-w-0 items-center gap-3.5">
        <div
          role="group"
          aria-label={t('calendar.toolbar.move', 'Move through the calendar')}
          className="flex h-control shrink-0 items-stretch overflow-hidden rounded-pill border border-border-strong bg-surface-raised"
        >
          <button
            type="button"
            aria-label={t('calendar.toolbar.previous', 'Previous')}
            onClick={() => {
              onStep(-1);
            }}
            className={cn(SEGMENT, 'w-9 justify-center')}
          >
            <AppIcon id="chevron-left" size={16} />
          </button>
          <span aria-hidden="true" className="my-auto h-4.5 w-px shrink-0 bg-border-strong" />
          <button
            type="button"
            onClick={onToday}
            // 14 px, as a button's word is: at 13 the capitals' middle fell between two pixels in
            // a 36 px pill and the word stood half a pixel high, where Chrome snaps the baseline.
            className={cn(SEGMENT, 'px-3.5 text-ui font-medium text-foreground')}
          >
            {t('calendar.toolbar.today', 'Today')}
          </button>
          <span aria-hidden="true" className="my-auto h-4.5 w-px shrink-0 bg-border-strong" />
          <button
            type="button"
            aria-label={t('calendar.toolbar.next', 'Next')}
            onClick={() => {
              onStep(1);
            }}
            className={cn(SEGMENT, 'w-9 justify-center')}
          >
            <AppIcon id="chevron-right" size={16} />
          </button>
        </div>
        <h2
          aria-live="polite"
          className={cn(
            'truncate font-medium first-letter:uppercase',
            isNarrow ? 'text-headline-sm' : 'text-headline',
          )}
        >
          {title}
        </h2>
      </div>

      <div className="flex items-center gap-2.5">
        <Segmented
          label={t('calendar.toolbar.view', 'View')}
          options={views.map((value) => ({ value, label: names[value] }))}
          value={view}
          onChange={onViewChange}
        />
        {isPanelOpen === undefined ? null : (
          <IconButton
            variant="raised"
            size="large"
            label={
              isPanelOpen
                ? t('calendar.toolbar.hidePanel', 'Hide the side panel')
                : t('calendar.toolbar.showPanel', 'Show the side panel')
            }
            onClick={onPanelToggle}
            className={isPanelOpen ? undefined : 'text-primary'}
          >
            <AppIcon id={isPanelOpen ? 'panel-right-close' : 'panel-right-open'} size={16} />
          </IconButton>
        )}
      </div>
    </div>
  );
}
