/**
 * The last few changes of an entity's state, newest first, and what caused each.
 *
 * "Why did the light turn on?" is answerable because every change carries its cause, and this is
 * where the answer is read: the person, the automation, the scene by name, or the device itself.
 * As the board draws it: the time in mono, the change, and its cause as a chip on the right. A
 * change made while the device could not be reached says that instead.
 */
import type { EntityView, StateHistoryPoint } from '@nebulahome/contracts';
import { AppIcon } from '@nebulahome/ui';

import { absoluteTime } from '@/lib/format-time';
import { describeState } from '@/library/entity-reading';
import { useCauseNames } from '@/library/use-cause-names';

/** How many changes are listed. */
const SHOWN = 8;

/** A time as the list shows it: hours and minutes, the viewer's own. */
const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/** What the list needs. */
export type RecentChangesProps = {
  /** The entity, for the unit and the class its states are written with. */
  readonly entity: Pick<EntityView, 'unitOfMeasurement' | 'deviceClass'>;

  /** The changes, oldest first. */
  readonly points: readonly StateHistoryPoint[];
};

/**
 * Renders the list.
 *
 * @param props - See {@link RecentChangesProps}.
 * @returns The list, or a line saying there is nothing.
 */
export function RecentChanges(props: RecentChangesProps) {
  const { entity, points } = props;
  const nameOf = useCauseNames();
  const shown = [...points].reverse().slice(0, SHOWN);

  if (shown.length === 0) {
    return (
      <p className="rounded-card border border-border bg-surface px-5 py-4 text-ui text-foreground-subtle">
        No change in this window.
      </p>
    );
  }

  return (
    <ol className="flex flex-col rounded-card border border-border bg-surface px-5">
      {shown.map((point) => {
        const cause = nameOf(point.context);

        return (
          <li
            key={point.time.getTime()}
            className="flex items-center gap-4 border-t border-border py-3 first:border-t-0"
          >
            <time
              dateTime={point.time.toISOString()}
              title={absoluteTime(point.time)}
              className="w-14 shrink-0 font-mono text-mono-caption text-foreground-subtle tabular"
            >
              {CLOCK.format(point.time)}
            </time>
            <span className="min-w-0 grow truncate text-ui text-foreground">
              {point.isAvailable ? describeState(point.state, entity) : 'Unreachable'}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border border-border px-2.5 py-0.5 text-caption text-foreground-muted">
              <AppIcon id={cause.icon} size={12} />
              {cause.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
