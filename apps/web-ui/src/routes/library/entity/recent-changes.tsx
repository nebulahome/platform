/**
 * The last few changes of an entity's state, newest first, and what caused each.
 *
 * "Why did the light turn on?" is answerable because every change carries its cause, and this is
 * where the answer is read: a person, an automation, a scene, the device itself. A change made
 * while the device could not be reached says that instead.
 */
import type { EntityView, StateHistoryPoint } from '@nebula-home/contracts';

import { absoluteTime, relativeTime } from '@/lib/format-time';
import { describeState } from '@/library/entity-reading';

/** How many changes are listed. */
const SHOWN = 8;

/** The words for each cause of a change. */
const CAUSES: Readonly<Record<string, string>> = {
  user: 'From the interface',
  automation: 'By an automation',
  scene: 'By a scene',
  device: 'On the device',
  alias: 'Worked out',
  startup: 'At start-up',
};

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
  const shown = [...points].reverse().slice(0, SHOWN);

  if (shown.length === 0) {
    return <p className="text-caption text-foreground-subtle">No change in this window.</p>;
  }

  return (
    <ol className="flex flex-col">
      {shown.map((point) => (
        <li
          key={point.time.getTime()}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-b border-border-soft py-2 last:border-b-0"
        >
          <span className="min-w-0">
            <span className="block truncate font-mono text-ui text-foreground">
              {point.isAvailable ? describeState(point.state, entity) : 'Unreachable'}
            </span>
            <span className="text-caption text-foreground-subtle">
              {CAUSES[point.context?.type ?? 'device'] ?? 'On the device'}
            </span>
          </span>
          <time
            dateTime={point.time.toISOString()}
            title={absoluteTime(point.time)}
            className="text-caption whitespace-nowrap text-foreground-subtle tabular"
          >
            {relativeTime(point.time)}
          </time>
        </li>
      ))}
    </ol>
  );
}
