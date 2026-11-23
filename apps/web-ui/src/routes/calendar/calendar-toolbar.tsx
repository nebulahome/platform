/**
 * The row under the page's header (CAL-Month): back and on, what is shown, Today; on the right
 * the four views and the button that hides the side panel. On a narrow window the views are two,
 * Month and Agenda, and there is no panel to hide.
 */
import { useTranslation } from 'react-i18next';

import { AppIcon, Button, cn, IconButton, Segmented } from '@nebulahome/ui';

import { CALENDAR_PAGE_VIEWS, type CalendarPageView } from './calendar-time';

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
      <div className="flex min-w-0 items-center gap-2">
        <IconButton
          variant="raised"
          label={t('calendar.toolbar.previous', 'Previous')}
          onClick={() => {
            onStep(-1);
          }}
        >
          <AppIcon id="chevron-left" size={16} />
        </IconButton>
        <IconButton
          variant="raised"
          label={t('calendar.toolbar.next', 'Next')}
          onClick={() => {
            onStep(1);
          }}
        >
          <AppIcon id="chevron-right" size={16} />
        </IconButton>
        <h2
          aria-live="polite"
          className={cn(
            'mx-1.5 truncate font-medium first-letter:uppercase',
            isNarrow ? 'text-headline-sm' : 'text-headline',
          )}
        >
          {title}
        </h2>
        <Button variant="ghost" size="compact" onClick={onToday}>
          {t('calendar.toolbar.today', 'Today')}
        </Button>
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
