/**
 * What happened lately (`K-New`, Activity): the newest changes of the house, an area or a few
 * entities, one row each, read only. The tall card writes a dot and a line per change; the large
 * card gives each its chip and a second line. A row opens its entity.
 *
 * Read from the hub's history (`GET /activity`), worded as the device page's activity is
 * (`device-activity.ts`), and read again every half minute.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { DashboardActivityCard } from '@nebulahome/contracts';
import { AppIcon, cn, type UiIconId } from '@nebulahome/ui';

import { kindName } from '@/dashboard/card-options';
import { dateTimeFormat } from '@/i18n/formatters';
import { activityLinesOf, type ActivityLine, type ActivityTone } from '@/library/device-activity';
import { Caption } from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import { useActivityEntries } from '@/routes/dashboard/cards/timeline-data';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';
import { entityPath } from '@/routes/library/entity/entity-path';

/** What the card needs. */
export type ActivityCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardActivityCard;

  /** What the page read for its cards. */
  readonly data: DashboardData;
};

/** How each kind of change is marked: its dot, its chip, its glyph. */
const MARKS: Readonly<
  Record<ActivityTone, { readonly dot: string; readonly chip: string; readonly icon: UiIconId }>
> = {
  on: { dot: 'bg-primary', chip: 'bg-primary/14 text-primary', icon: 'power' },
  off: {
    dot: 'bg-foreground-subtle',
    chip: 'bg-surface-raised text-foreground-subtle',
    icon: 'power',
  },
  change: { dot: 'bg-cyan', chip: 'bg-cyan/14 text-cyan', icon: 'activity' },
  offline: { dot: 'bg-warning', chip: 'bg-warning/14 text-warning', icon: 'wifi-off' },
  online: { dot: 'bg-success', chip: 'bg-success/14 text-success', icon: 'wifi' },
};

/**
 * The time of day a change happened at.
 *
 * @returns The formatter.
 */
const CLOCK = (): Intl.DateTimeFormat => dateTimeFormat({ hour: '2-digit', minute: '2-digit' });

/**
 * What a change came to, briefly: what it turned into, or "turned on" for a switch.
 *
 * @param line - The change, as the device page words it.
 * @returns "open", "turned on", "locked".
 */
function happenedOf(line: ActivityLine): string {
  const only = line.changes.length === 1 ? line.changes[0] : undefined;

  return (
    line.tone === 'on' || line.tone === 'off' || only === undefined ? line.summary : only.after
  ).toLowerCase();
}

/**
 * Renders what happened lately.
 *
 * @param props - See {@link ActivityCardProps}.
 * @returns The card.
 */
export function ActivityCard(props: ActivityCardProps) {
  const { t } = useTranslation();

  const { card, data } = props;
  const isLarge = card.h >= 3;
  const limit = isLarge ? 6 : 5;
  const scope = card.scope;
  const followed =
    scope.kind === 'entities'
      ? scope.entityIds.flatMap((id) => data.entityById.get(id) ?? [])
      : [...data.entityById.values()].filter(
          (entity) => scope.kind === 'house' || entity.areaKey === scope.areaKey,
        );
  const canRead = followed.some((entity) => data.canReadHistory(entity));
  // A few more than shown: a change several entities share becomes one line.
  const entries = useActivityEntries(scope, limit * 2, canRead);
  const lines =
    entries === undefined
      ? undefined
      : activityLinesOf(entries, data.entityById, '').slice(0, limit);
  const title = card.title ?? kindName('activity');
  const where =
    scope.kind === 'house'
      ? t('dashboard.cards.activityCard.wholeHouse', 'Whole house')
      : scope.kind === 'area'
        ? (followed[0]?.areaName ?? scope.areaKey)
        : t('dashboard.cards.activityCard.entities', {
            count: scope.entityIds.length,
            defaultValue_one: '{{count}} entity',
            defaultValue_other: '{{count}} entities',
          });

  return (
    <CardFrame label={title}>
      <div className="flex h-8 shrink-0 items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-field bg-primary/14 text-primary"
        >
          <AppIcon id="activity" size={16} />
        </span>
        <span className="flex min-w-0 grow flex-col">
          <span className="truncate text-ui leading-[18px] font-medium">{title}</span>
          <span className="truncate text-caption leading-4 text-foreground-subtle">{where}</span>
        </span>
        <Caption>{t('dashboard.cards.activityCard.today', 'Today')}</Caption>
      </div>

      {!canRead ? (
        <div className="flex grow items-center justify-center text-center text-caption text-foreground-subtle">
          {t('dashboard.cards.activityCard.cannotRead', 'You may not read what happened here')}
        </div>
      ) : lines === undefined ? (
        <div className="mt-3 flex flex-col gap-2.5" aria-hidden="true">
          {Array.from({ length: limit }, (unused, index) => (
            <span key={index} className="h-4 animate-pulse rounded-chip bg-surface-raised" />
          ))}
        </div>
      ) : lines.length === 0 ? (
        <div className="flex grow items-center justify-center text-caption text-foreground-subtle">
          {t('dashboard.cards.activityCard.quiet', 'Nothing happened yet')}
        </div>
      ) : (
        <ul className={cn('flex min-h-0 flex-col', isLarge ? 'mt-2.5' : 'mt-3 gap-0.5')}>
          {lines.map((line, index) => {
            const mark = MARKS[line.tone];
            const entityId = line.entries[0]?.entityId;
            const area = entityId === undefined ? null : data.entityById.get(entityId)?.areaName;
            const time = CLOCK().format(line.time);

            return (
              <li
                key={line.key}
                className="animate-rise"
                /* eslint-disable-next-line react/forbid-dom-props -- the rows arrive in order. */
                style={{ animationDelay: `${String(index * 30)}ms`, animationFillMode: 'both' }}
              >
                <Link
                  to={entityId === undefined ? '' : entityPath(entityId)}
                  className={cn(
                    'flex min-w-0 items-center gap-2.5 rounded-chip transition-colors duration-150 hover:bg-foreground/[0.03]',
                    isLarge ? 'h-[42px] border-t border-border' : 'h-[26px]',
                  )}
                >
                  {isLarge ? (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-field',
                        mark.chip,
                      )}
                    >
                      <AppIcon id={mark.icon} size={14} />
                    </span>
                  ) : (
                    <span
                      aria-hidden="true"
                      className={cn('size-1.5 shrink-0 rounded-full', mark.dot)}
                    />
                  )}
                  {isLarge ? (
                    <span className="flex min-w-0 grow flex-col">
                      <span className="truncate text-ui-sm">
                        {t('dashboard.cards.activityCard.line', '{{what}} {{happened}}', {
                          what: line.title,
                          happened: happenedOf(line),
                        })}
                      </span>
                      <span className="truncate text-label text-foreground-subtle">
                        {area ?? line.summary}
                      </span>
                    </span>
                  ) : (
                    <span className="min-w-0 grow truncate text-caption">
                      <span className="text-foreground">
                        {t('dashboard.cards.activityCard.line', '{{what}} {{happened}}', {
                          what: line.title,
                          happened: happenedOf(line),
                        })}
                      </span>
                      {area === null || area === undefined ? null : (
                        <span className="text-foreground-subtle"> · {area}</span>
                      )}
                    </span>
                  )}
                  <span className="shrink-0 font-mono text-label text-foreground-subtle tabular-nums">
                    {time}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </CardFrame>
  );
}
