/**
 * How an entity read two ways is read: the Transport section of its page, and the words the
 * rest of the page says it in.
 *
 * Each source on the left - the way's mark and name, its key in that transport (`switch:0`,
 * "EP1 · On/Off"), what it says now, and whether it is in use or standing by - and a line from
 * each to the entity on the right: solid from the one read, dashed from the one listening. Under
 * them, whether the two agree, and when the fallback last carried the reading and for how long.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type {
  DeviceView,
  EntitySource,
  EntityView,
  MatterReference,
  StateHistoryPoint,
} from '@nebulahome/contracts';
import { AppIcon, cn, Section } from '@nebulahome/ui';

import { dateTimeFormat } from '@/i18n/formatters';
import { durationText } from '@/lib/format-time';
import { fetchStateHistory, LIBRARY_QUERY_KEYS } from '@/library/api';
import { describeState } from '@/library/entity-reading';
import { windowOfChoice } from '@/library/history-series';
import {
  TransportMark,
  useVendorsById,
  wayName,
  type TransportWay,
} from '@/routes/library/transport-marks';

/** The clusters a Matter reading is named by, as people say them. */
const CLUSTER_NAMES: Readonly<Record<number, string>> = {
  0x00_06: 'On/Off',
  0x00_08: 'Level',
  0x01_02: 'Window covering',
  0x02_01: 'Thermostat',
  0x03_00: 'Colour',
  0x04_02: 'Temperature',
  0x04_05: 'Humidity',
  0x04_06: 'Occupancy',
  0x00_90: 'Power',
  0x00_91: 'Energy',
};

/**
 * A Matter reading's place: "EP1 · On/Off".
 *
 * @param reference - Where it sits.
 * @returns The words.
 */
export function matterKeyOf(reference: MatterReference): string {
  const cluster =
    CLUSTER_NAMES[reference.cluster] ??
    `0x${reference.cluster.toString(16).toUpperCase().padStart(4, '0')}`;

  return `EP${String(reference.endpoint)} · ${cluster}`;
}

/** One source, with what the page says of it. */
export type EntityWay = {
  readonly source: EntitySource;
  readonly way: TransportWay;
  readonly name: string;

  /** Its key in its transport, or where it sits in Matter. */
  readonly key: string | null;
};

/** How an entity read two ways is read. */
export type EntityWays = {
  readonly sources: readonly EntityWay[];

  /** The source read first: the entity's own choice, else its device's. */
  readonly first: EntityWay;
  readonly second: EntityWay;

  /** The one read now, or null when none answers. */
  readonly active: EntityWay | null;

  /** Whether the entity chose its own way rather than follow the device. */
  readonly isOwnChoice: boolean;
};

/**
 * Reads how an entity read two ways is read.
 *
 * @param entity - The entity, once it is read.
 * @returns How, or null for an entity read one way, or not read yet.
 */
export function useEntityWays(entity: Pick<EntityView, 'linked'> | undefined): EntityWays | null {
  const { t } = useTranslation();
  const vendors = useVendorsById();
  const linked = entity?.linked;

  if (linked == null) {
    return null;
  }

  const sources = linked.sources.map((source) => {
    const way = { vendorId: source.vendorId, transport: source.transport };

    return {
      source,
      way,
      name: wayName(way, vendors, t('library.matterTag', 'Matter')),
      key: source.matter === null ? source.key : matterKeyOf(source.matter),
    };
  });
  const firstId = linked.transport ?? linked.preferred;
  const first = sources.find((each) => each.source.deviceId === firstId) ?? sources[0];
  const second = sources.find((each) => each !== first) ?? sources[1];

  if (first === undefined || second === undefined) {
    return null;
  }

  return {
    sources,
    first,
    second,
    active: sources.find((each) => each.source.isActive) ?? null,
    isOwnChoice: linked.transport !== null,
  };
}

/**
 * How the entity's choice reads, as the strip and the section's corner say it: "From the device ·
 * Matter as fallback".
 *
 * @param ways - How it is read.
 * @param t - The translator.
 * @returns The words.
 */
export function choiceWords(ways: EntityWays, t: ReturnType<typeof useTranslation>['t']): string {
  return t('entity.transport.choice', '{{choice}} · {{second}} as fallback', {
    choice: ways.isOwnChoice
      ? t('entity.transport.forThisEntity', 'For this entity')
      : t('entity.transport.fromTheDevice', 'From the device'),
    second: ways.second.name,
  });
}

/** When the fallback last carried the reading, and for how long. */
type Fallback = { readonly at: Date; readonly ms: number };

/**
 * The stretches of a window each source carried, from the history's rows.
 *
 * @param points - The rows, oldest first.
 * @param to - Where the window ends.
 * @returns Each stretch, by the source that carried it.
 */
export function sourceStretches(
  points: readonly StateHistoryPoint[],
  to: number,
): { readonly source: string; readonly from: number; readonly to: number }[] {
  const stretches: { source: string; from: number; to: number }[] = [];

  for (const point of points) {
    const last = stretches.at(-1);

    // A row from the same source as the one before carries on its stretch.
    if (last?.source === point.source) {
      continue;
    }

    if (last !== undefined) {
      last.to = point.time.getTime();
    }

    stretches.push({ source: point.source, from: point.time.getTime(), to });
  }

  return stretches;
}

/**
 * The last stretch the fallback carried, from the history's rows.
 *
 * @param points - The rows, oldest first.
 * @param fallback - The fallback source.
 * @param now - The window's end.
 * @returns When and how long, or null when it did not in the window.
 */
function lastFallbackOf(
  points: readonly StateHistoryPoint[],
  fallback: string,
  now: number,
): Fallback | null {
  const stretch = sourceStretches(points, now)
    .filter((each) => each.source === fallback)
    .at(-1);

  return stretch === undefined
    ? null
    : { at: new Date(stretch.from), ms: stretch.to - stretch.from };
}

/** What the section needs. */
export type TransportPanelProps = {
  readonly entity: EntityView;
  readonly ways: EntityWays;
  readonly device: DeviceView | undefined;
};

/**
 * Renders the Transport section.
 *
 * @param props - See {@link TransportPanelProps}.
 * @returns The section.
 */
export function TransportPanel(props: TransportPanelProps) {
  const { t } = useTranslation();
  const { entity, ways, device } = props;
  const vendors = useVendorsById();
  const shown = [ways.first, ways.second];

  // The same window, under the same key, as the strip and the History read.
  const changes = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.history, entity.entityId, 'state', '24h'],

    /**
     * Reads the last day's rows, for the fallback's last stretch.
     *
     * @param context - The abort signal.
     * @param context.signal - Cancels the read.
     * @returns The window and its rows.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const window = windowOfChoice({ kind: 'preset', range: '24h' }, Date.now());
      const points = await fetchStateHistory(
        { entityId: entity.entityId, from: new Date(window.from), to: new Date(window.to) },
        signal,
      );

      return { window, points };
    },
  });
  const fallback =
    changes.data === undefined
      ? null
      : lastFallbackOf(changes.data.points, ways.second.source.deviceId, changes.data.window.to);
  const said = shown.map((each) =>
    each.source.state === null ? null : describeState(each.source.state, entity),
  );
  const isAgreed = said[0] !== null && said[0] === said[1];
  const active = ways.active ?? ways.first;
  /**
   * A moment, as the line says it: "Tuesday 22:14".
   *
   * @param date - The moment.
   * @returns The words.
   */
  const at = (date: Date): string =>
    dateTimeFormat({ weekday: 'long', hour: '2-digit', minute: '2-digit' }).format(date);

  return (
    <Section
      title={t('entity.transport.transport', 'Transport')}
      actions={<span className="text-caption text-foreground-subtle">{choiceWords(ways, t)}</span>}
    >
      <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center gap-y-4">
          <div className="flex min-w-0 grow basis-0 flex-col gap-3">
            {shown.map((each, index) => {
              const isUsed = each === active && ways.active !== null;

              return (
                <div
                  key={each.source.deviceId}
                  className={cn(
                    'flex min-w-0 items-center gap-3 rounded-tile border px-3 py-2.5',
                    isUsed ? 'border-primary/45 bg-primary/8' : 'border-border bg-rail',
                  )}
                >
                  <TransportMark way={each.way} vendors={vendors} size={28} />
                  <span className="flex min-w-0 grow flex-col gap-0.5">
                    <span className="truncate text-ui font-medium text-foreground">
                      {each.name}
                    </span>
                    {each.key === null ? null : (
                      <span className="truncate font-mono text-label tracking-normal text-foreground-subtle">
                        {each.key}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="text-ui text-foreground">
                      {said[index] ?? t('entity.transport.nothingYet', 'Nothing yet')}
                    </span>
                    <span
                      className={cn(
                        'text-caption',
                        isUsed
                          ? 'text-success'
                          : each.source.isAvailable
                            ? 'text-foreground-subtle'
                            : 'text-warning',
                      )}
                    >
                      {isUsed
                        ? t('entity.transport.inUse', 'In use')
                        : each.source.isAvailable
                          ? t('entity.transport.standingBy', 'Standing by')
                          : t('entity.transport.silent', 'Silent')}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>

          {/* From each source to the entity: solid from the one read, dashed from the other. */}
          <svg
            aria-hidden="true"
            viewBox="0 0 112 132"
            preserveAspectRatio="none"
            className="h-33 w-28 shrink-0 max-md:hidden"
          >
            <path
              d="M0 33 C 56 33, 56 66, 112 66"
              fill="none"
              className={active === ways.first ? 'stroke-tag-blue' : 'stroke-border-strong'}
              strokeWidth="1.75"
              strokeDasharray={active === ways.first ? undefined : '4 4'}
            />
            <path
              d="M0 99 C 56 99, 56 66, 112 66"
              fill="none"
              className={active === ways.second ? 'stroke-violet' : 'stroke-border-strong'}
              strokeWidth="1.75"
              strokeDasharray={active === ways.second ? undefined : '4 4'}
            />
          </svg>

          <div className="flex min-w-0 grow basis-0 items-center gap-3.5 rounded-inner border border-primary/45 bg-linear-to-r from-tag-blue/8 to-violet/8 px-5 py-6">
            <AppIcon id="plug" size={20} className="shrink-0 text-lamp" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-ui-sm text-foreground-muted">
                {device?.name ?? entity.name}
              </span>
              <span className="text-headline font-medium text-foreground">
                {entity.isAvailable
                  ? describeState(entity.state, entity)
                  : t('entity.transport.unreachable', 'Unreachable')}
              </span>
              <span className="text-caption text-foreground-subtle">
                {ways.active === null
                  ? t('entity.transport.neitherAnswers', 'Neither way answers')
                  : ways.active === ways.first
                    ? t('entity.transport.throughFirst', 'Through {{way}}, the preferred way', {
                        way: ways.active.name,
                      })
                    : t(
                        'entity.transport.throughFallback',
                        'Through {{way}}, while {{first}} is silent',
                        {
                          way: ways.active.name,
                          first: ways.first.name,
                        },
                      )}
              </span>
            </span>
          </div>
        </div>

        <p
          className={cn(
            'flex items-start gap-2.5 border-t border-border pt-4 text-ui-sm',
            isAgreed || said[1] === null ? 'text-foreground-muted' : 'text-warning',
          )}
        >
          <AppIcon
            id={isAgreed || said[1] === null ? 'circle-check' : 'triangle-alert'}
            size={16}
            className={cn('mt-0.5 shrink-0', isAgreed || said[1] === null ? 'text-success' : '')}
          />
          <span>
            {isAgreed
              ? t('entity.transport.bothSay', 'Both say {{value}}.', { value: said[0] })
              : said[1] === null
                ? t('entity.transport.onlyOneSays', '{{second}} has not said anything yet.', {
                    second: ways.second.name,
                  })
                : t(
                    'entity.transport.theySayApart',
                    '{{first}} says {{a}}, {{second}} says {{b}}.',
                    {
                      first: ways.first.name,
                      a: said[0] ?? '—',
                      second: ways.second.name,
                      b: said[1],
                    },
                  )}{' '}
            {fallback === null
              ? t('entity.transport.noFallbackToday', '{{second}} has not had to carry it today.', {
                  second: ways.second.name,
                })
              : t(
                  'entity.transport.lastCarried',
                  '{{second}} last carried it {{when}}, for {{for}} while {{first}} was silent.',
                  {
                    second: ways.second.name,
                    when: at(fallback.at),
                    for: durationText(fallback.ms),
                    first: ways.first.name,
                  },
                )}
          </span>
        </p>
      </div>
    </Section>
  );
}
