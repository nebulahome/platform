/**
 * What happened to an entity, in words: each change of its state in the window, newest first -
 * what it became, what made it so, and when - scrolling back through the window.
 *
 * Who or what caused a change is said here, not under the value: the person, the automation or
 * the scene by name, or the device itself.
 */
import { useTranslation } from 'react-i18next';

import type { EntityView, StateHistoryPoint } from '@nebulahome/contracts';
import { AppIcon, cn } from '@nebulahome/ui';

import { absoluteTime } from '@/lib/format-time';
import { describeState } from '@/library/entity-reading';
import type { TimeWindow } from '@/library/history-series';
import { useCauseNames } from '@/library/use-cause-names';
import { momentText } from '@/routes/library/entity/sheet/history';

/** What the list needs. */
export type ActivityListProps = {
  /** The entity, for the unit and the class its states are written with. */
  readonly entity: Pick<EntityView, 'unitOfMeasurement' | 'deviceClass'>;

  /** Its changes in the window, oldest first. */
  readonly points: readonly StateHistoryPoint[];

  /** The window, for how precisely a time is written. */
  readonly window: TimeWindow;
};

/**
 * The changes, newest first, in a list that scrolls back in time.
 *
 * @param props - See {@link ActivityListProps}.
 * @returns The list, or a line saying nothing changed.
 */
export function ActivityList(props: ActivityListProps) {
  const { t } = useTranslation();
  const { entity, points, window } = props;
  const nameOf = useCauseNames();
  const newest = [...points].reverse();

  if (newest.length === 0) {
    return (
      <p className="py-3 text-ui-sm text-foreground-subtle">
        {t('entity.recentChanges.noChangeInThis', 'No change in this window.')}
      </p>
    );
  }

  return (
    <ol className="entity-stagger -mr-2 flex min-h-0 grow flex-col overflow-auto pr-2">
      {newest.map((point) => {
        const cause = nameOf(point.context);

        return (
          <li
            key={point.time.getTime()}
            className="flex shrink-0 items-center gap-3 border-t border-border py-2.5 first:border-t-0"
          >
            <span
              aria-hidden="true"
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                point.isAvailable ? 'bg-foreground-subtle' : 'bg-danger',
              )}
            />
            <span className="flex min-w-0 grow flex-col gap-0.5">
              <span className="truncate text-ui-sm text-foreground select-text">
                {point.isAvailable
                  ? describeState(point.state, entity)
                  : t('entity.recentChanges.unreachable', 'Unreachable')}
              </span>
              <span className="inline-flex min-w-0 items-center gap-1.25 text-caption text-foreground-subtle">
                <AppIcon id={cause.icon} size={11} />
                <span className="truncate select-text">{cause.label}</span>
              </span>
            </span>
            <time
              dateTime={point.time.toISOString()}
              title={absoluteTime(point.time)}
              className="shrink-0 font-mono text-[11px] text-foreground-subtle tabular select-text"
            >
              {momentText(point.time.getTime(), window)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
