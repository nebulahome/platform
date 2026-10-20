/**
 * The last few changes of an entity's state, newest first, and what caused each.
 *
 * "Why did the light turn on?" is answerable because every change carries its cause, and this is
 * where the answer is read: the person, the automation, the scene by name, or the device itself.
 * As the board draws it: the time in mono, the change, and its cause as a chip on the right. A
 * change made while the device could not be reached says that instead.
 */
import { useTranslation } from 'react-i18next';

import type { EntityView, StateHistoryPoint } from '@nebulahome/contracts';
import { AppIcon, type UiIconId } from '@nebulahome/ui';

import { dateTimeFormat } from '@/i18n/formatters';
import { absoluteTime } from '@/lib/format-time';
import { describeState } from '@/library/entity-reading';
import { useCauseNames } from '@/library/use-cause-names';
import type { EntityWays } from '@/routes/library/entity/transport-panel';

/** How many changes are listed. */
const SHOWN = 8;

/**
 * A time as the list shows it: hours and minutes, the viewer's own.
 *
 * @returns The formatter, in the reader's language.
 */
const CLOCK = (): Intl.DateTimeFormat => dateTimeFormat({ hour: '2-digit', minute: '2-digit' });

/** What the list needs. */
export type RecentChangesProps = {
  /** The entity, for the unit and the class its states are written with. */
  readonly entity: Pick<EntityView, 'unitOfMeasurement' | 'deviceClass'>;

  /** The changes, oldest first. */
  readonly points: readonly StateHistoryPoint[];

  /** How it is read, for one read two ways: each change says the way it came in. */
  readonly ways?: EntityWays | null;
};

/**
 * Renders the list.
 *
 * @param props - See {@link RecentChangesProps}.
 * @returns The list, or a line saying there is nothing.
 */
export function RecentChanges(props: RecentChangesProps) {
  const { t } = useTranslation();

  const { entity, points, ways = null } = props;
  const nameOf = useCauseNames();
  const shown = [...points].reverse().slice(0, SHOWN);
  const wayNames = new Map(ways?.sources.map((each) => [each.source.deviceId, each.name]));
  const preferred = ways?.first.source.deviceId;

  /**
   * What a row says, and the cause beside it: for one read two ways, the way it came in, and a
   * change of way as one of its own.
   *
   * @param point - The row.
   * @returns Its words and its cause.
   */
  const wordsOf = (
    point: StateHistoryPoint,
  ): {
    readonly text: string;
    readonly cause: { readonly icon: UiIconId; readonly label: string };
  } => {
    const said = point.isAvailable
      ? describeState(point.state, entity)
      : t('entity.recentChanges.unreachable', 'Unreachable');
    const before = points[points.indexOf(point) - 1];
    const way = wayNames.get(point.source);

    if (ways === null || way === undefined) {
      return { text: said, cause: nameOf(point.context) };
    }

    if (before !== undefined && before.source !== point.source) {
      const isBack = point.source === preferred;
      const was = wayNames.get(before.source) ?? before.source;

      return {
        text: isBack
          ? t('entity.recentChanges.backOn', 'Back on {{way}} · still {{state}}', {
              way,
              state: said,
            })
          : t('entity.recentChanges.throughStill', 'Through {{way}} · still {{state}}', {
              way,
              state: said,
            }),
        cause: {
          icon: 'cpu',
          label: isBack
            ? t('entity.recentChanges.wayBack', '{{way}} back', { way })
            : t('entity.recentChanges.waySilent', '{{way}} silent', { way: was }),
        },
      };
    }

    return {
      text: t('entity.recentChanges.throughWay', '{{state}} · through {{way}}', {
        state: said,
        way,
      }),
      cause: nameOf(point.context),
    };
  };

  if (shown.length === 0) {
    return (
      <p className="rounded-card border border-border bg-surface px-5 py-4 text-ui text-foreground-subtle">
        {t('entity.recentChanges.noChangeInThis', 'No change in this window.')}
      </p>
    );
  }

  return (
    <ol className="flex flex-col rounded-card border border-border bg-surface px-5">
      {shown.map((point) => {
        const { text, cause } = wordsOf(point);

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
              {CLOCK().format(point.time)}
            </time>
            <span className="min-w-0 grow truncate text-ui text-foreground">{text}</span>
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
