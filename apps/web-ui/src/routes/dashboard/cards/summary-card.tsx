/**
 * What needs a look, counted across the house or one area: doors and windows open, lights on,
 * batteries low, updates ready, devices out of reach (`K-Overview`, Summary).
 *
 * The card is coloured only while its count is above zero; otherwise it is quiet - a grey chip, a
 * green dot, "All closed". It offers one action at most: All off for the lights, Review for the
 * updates. A tap opens the list of what was counted, each row opening its entity; the 1×2 shows the
 * first three in the card itself. The house at a glance (`glance`) puts the five counts side by
 * side on the 2×1, in a row of marks on the 1×1 and in five rows on the 1×2.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { DashboardSummaryCard, SummarySubject } from '@nebulahome/contracts';
import { AppIcon, cn, Modal, type UiIconId } from '@nebulahome/ui';

import { defineMessage, text, translate, type Message } from '@/i18n/messages';
import { powerCommand } from '@/library/entity-control';
import { entityKindOf } from '@/library/entity-kind';
import { readingOf } from '@/library/entity-reading';
import { BigValue, Caption, forHowLong } from '@/routes/dashboard/cards/card-kit';
import { CardFrame, type CardTap } from '@/routes/dashboard/cards/card-parts';
import { cardTime } from '@/routes/dashboard/cards/entity-model';
import { useGroupCommand } from '@/routes/dashboard/cards/overview-command';
import {
  countOf,
  seenIn,
  type Count,
  type CountedSubject,
  type Seen,
} from '@/routes/dashboard/cards/overview-counts';
import { OverviewHead } from '@/routes/dashboard/cards/overview-parts';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';
import { entityPath } from '@/routes/library/entity/entity-path';
import { EntityTile } from '@/routes/library/entity-tile';

/** Where the updates are reviewed: the Software page. */
const SOFTWARE_PAGE = '/settings/system/software';

/** A battery at or under this, in percent, is drawn in the danger colour. */
const EMPTY_BATTERY = 10;

/** How a subject is drawn while its count is above zero. */
type Look = {
  readonly icon: UiIconId;
  readonly name: Message;
  readonly chip: string;
  readonly dot: string;
  readonly figure: string;
  readonly glow: string | undefined;
};

/** What each subject is called, and how it is lit. */
const LOOKS: Readonly<Record<Exclude<SummarySubject, 'glance'>, Look>> = {
  openings: {
    icon: 'door-open',
    name: defineMessage('dashboard.cards.summaryCard.openings', 'Doors and windows'),
    chip: 'bg-warning/14 text-warning',
    dot: 'bg-warning',
    figure: 'text-warning',
    glow: 'var(--color-warning)',
  },
  lights: {
    icon: 'lightbulb',
    name: defineMessage('dashboard.cards.summaryCard.lights', 'Lights on'),
    chip: 'bg-lamp/14 text-lamp',
    dot: 'bg-lamp',
    figure: 'text-foreground',
    glow: 'var(--color-lamp)',
  },
  batteries: {
    icon: 'battery-low',
    name: defineMessage('dashboard.cards.summaryCard.batteries', 'Batteries'),
    chip: 'bg-warning/14 text-warning',
    dot: 'bg-warning',
    figure: 'text-warning',
    glow: 'var(--color-warning)',
  },
  updates: {
    icon: 'circle-arrow-up',
    name: defineMessage('dashboard.cards.summaryCard.updates', 'Updates'),
    chip: 'bg-cyan/14 text-cyan',
    dot: 'bg-cyan',
    figure: 'text-foreground',
    glow: undefined,
  },
  offline: {
    icon: 'wifi-off',
    name: defineMessage('dashboard.cards.summaryCard.offline', 'Not reachable'),
    chip: 'bg-danger/14 text-danger',
    dot: 'bg-danger',
    figure: 'text-danger',
    glow: 'var(--color-danger)',
  },
};

/** The look of a count of zero: nothing needs a look. */
const QUIET = { chip: 'bg-surface-raised text-foreground-subtle', dot: 'bg-success' } as const;

/** The house at a glance, in its order: what each column counts and how it is lit. */
const GLANCE: readonly { readonly subject: CountedSubject; readonly figure: string }[] = [
  { subject: 'lights', figure: 'text-lamp' },
  { subject: 'openings', figure: 'text-warning' },
  { subject: 'blinds', figure: 'text-foreground' },
  { subject: 'batteries', figure: 'text-warning' },
  { subject: 'offline', figure: 'text-danger' },
];

/** What a summary card needs. */
export type SummaryCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardSummaryCard;

  /** What the page read for its cards. */
  readonly data: DashboardData;
};

/**
 * Renders a summary card.
 *
 * @param props - See {@link SummaryCardProps}.
 * @returns The card.
 */
export function SummaryCard(props: SummaryCardProps) {
  const { t } = useTranslation();

  const { card, data } = props;
  const [isListOpen, setListOpen] = useState(false);
  const seen = seenIn(data.entityById.values(), data.readings, card.areaKey);
  const place =
    card.areaKey === null
      ? t('dashboard.cards.summaryCard.wholeHouse', 'Whole house')
      : (seen.find((each) => each.entity.areaName !== null)?.entity.areaName ?? card.areaKey);
  const { what } = card;
  const glance = GLANCE.map((column) => ({ ...column, count: countOf(column.subject, seen) }));
  const count = what === 'glance' ? null : countOf(what, seen);
  const found = count?.found ?? [
    ...new Map(
      glance
        .filter((column) => column.subject !== 'blinds')
        .flatMap((column) => column.count.found)
        .map((each) => [each.entity.entityId, each]),
    ).values(),
  ];
  const title =
    card.title ??
    (what === 'glance'
      ? card.areaKey === null
        ? t('dashboard.cards.summaryCard.home', 'Home')
        : place
      : text(LOOKS[what].name));
  const tap: CardTap | undefined =
    found.length === 0
      ? undefined
      : {
          kind: 'press',
          label: t('dashboard.cards.summaryCard.showList', 'Show what was counted'),
          /** Opens the list of what was counted. */
          onPress: () => {
            setListOpen(true);
          },
        };
  const list = (
    <Modal
      isOpen={isListOpen}
      title={title}
      size="small"
      hasCloseButton
      onClose={() => {
        setListOpen(false);
      }}
    >
      <ul className="-mx-2 flex flex-col">
        {found.map((each) => (
          <li key={each.entity.entityId}>
            <Link
              to={entityPath(each.entity.entityId)}
              className="flex h-11 items-center gap-2.5 rounded-field px-2 transition-colors duration-150 hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none"
              onClick={() => {
                setListOpen(false);
              }}
            >
              <EntityTile
                icon={undefined}
                kind={entityKindOf(each.entity)}
                isActive={null}
                isAvailable={each.isAvailable}
                size="small"
              />
              <span className="flex min-w-0 grow flex-col">
                <span className="truncate text-ui-sm">{each.entity.name}</span>
                {each.entity.areaName === null ? null : (
                  <span className="truncate text-caption text-foreground-subtle">
                    {each.entity.areaName}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-caption text-foreground-subtle tabular-nums">
                {readingOf(each.entity, data.readings[each.entity.entityId]).text}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Modal>
  );

  if (what === 'glance' || count === null) {
    return (
      <>
        <GlanceFace card={card} title={title} glance={glance} tap={tap} />
        {list}
      </>
    );
  }

  return (
    <>
      <CountFace
        card={card}
        what={what}
        data={data}
        title={title}
        place={place}
        count={count}
        tap={tap}
      />
      {list}
    </>
  );
}

/** What the face of one count needs. */
type CountFaceProps = {
  readonly card: DashboardSummaryCard;
  readonly what: Exclude<SummarySubject, 'glance'>;
  readonly data: DashboardData;
  readonly title: string;
  readonly place: string;
  readonly count: Count;
  readonly tap: CardTap | undefined;
};

/**
 * Renders one count: the head, the count with its dot, and what it is about or its action; the
 * 1×2 adds the first three counted, as rows.
 *
 * @param props - See {@link CountFaceProps}.
 * @returns The card.
 */
function CountFace(props: CountFaceProps) {
  const { t } = useTranslation();

  const { card, what, data, title, place, count, tap } = props;
  const group = useGroupCommand();
  const look = LOOKS[what];
  const { found, of, total, since } = count;
  const isQuiet = found.length === 0;
  const levels = of.flatMap((each) =>
    each.state.sensor_numeric === undefined ? [] : [each.state.sensor_numeric.value],
  );
  const lowest = levels.length === 0 ? undefined : Math.min(...levels);
  const subtitle = {
    openings: `${place} · ${String(total)}`,
    lights: `${place} · ${String(total)}`,
    batteries: devicesIn(card.areaKey === null ? null : place, total),
    updates:
      card.areaKey === null
        ? t('dashboard.cards.summaryCard.devicesAndPackages', 'Devices and packages')
        : place,
    offline: devicesIn(card.areaKey === null ? null : place, total),
  }[what];
  const figure = isQuiet
    ? {
        openings: t('dashboard.cards.summaryCard.allClosed', 'All closed'),
        lights: t('dashboard.cards.summaryCard.allOff', 'All off'),
        batteries: t('dashboard.cards.summaryCard.allCharged', 'All charged'),
        updates: t('dashboard.cards.summaryCard.upToDate', 'Up to date'),
        offline: t('dashboard.cards.summaryCard.allReachable', 'All reachable'),
      }[what]
    : {
        openings: t('dashboard.cards.summaryCard.countOpen', '{{count}} open', {
          count: found.length,
        }),
        lights: t('dashboard.cards.summaryCard.countOn', '{{count}} on', { count: found.length }),
        batteries: t('dashboard.cards.summaryCard.countLow', '{{count}} low', {
          count: found.length,
        }),
        updates: t('dashboard.cards.summaryCard.countReady', '{{count}} ready', {
          count: found.length,
        }),
        offline: t('dashboard.cards.summaryCard.countOffline', '{{count}} offline', {
          count: found.length,
        }),
      }[what];
  const lowestText =
    lowest === undefined
      ? ''
      : t('dashboard.cards.summaryCard.lowest', 'lowest {{value}}%', { value: Math.round(lowest) });
  const sinceText =
    since === null
      ? ''
      : t('dashboard.cards.summaryCard.since', 'since {{time}}', { time: cardTime(since) });
  const note = isQuiet
    ? what === 'openings' || what === 'lights'
      ? sinceText
      : what === 'batteries'
        ? lowestText
        : ''
    : what === 'batteries'
      ? lowestText
      : found.map((each) => each.entity.name).join(', ');
  const switchable = found.filter((each) => data.canControl(each.entity));
  const button =
    'press-scale inline-flex h-7.5 shrink-0 items-center gap-2 rounded-pill border border-border-strong bg-surface-raised px-3.5 text-ui-sm font-medium whitespace-nowrap text-foreground transition-colors duration-200 hover:enabled:bg-surface-high disabled:opacity-60';
  const action = isQuiet ? null : what === 'lights' && switchable.length > 0 ? (
    <button
      type="button"
      disabled={group.sending !== null}
      className={button}
      onClick={() => {
        group.send(
          'off',
          switchable.map((each) => each.entity.entityId),
          'on_off',
          powerCommand(false),
        );
      }}
    >
      {group.sending === null ? null : (
        <span className="inline-flex animate-spin">
          <AppIcon id="loader-circle" size={13} />
        </span>
      )}
      {t('dashboard.cards.summaryCard.allOffAction', 'All off')}
    </button>
  ) : what === 'updates' ? (
    <Link to={SOFTWARE_PAGE} className={button}>
      {t('dashboard.cards.summaryCard.review', 'Review')}
    </Link>
  ) : null;
  const head = (
    <OverviewHead
      icon={look.icon}
      chip={isQuiet ? QUIET.chip : look.chip}
      title={title}
      subtitle={subtitle}
    />
  );

  if (card.h === 1) {
    return (
      <CardFrame label={title} glow={isQuiet ? undefined : look.glow} tap={tap}>
        {head}
        <div className="grow" />
        <div className="flex min-w-0 items-center justify-between gap-2.5">
          <span
            className={cn(
              'flex items-center gap-2 text-[20px] font-medium whitespace-nowrap transition-colors duration-200',
              isQuiet ? 'text-foreground' : look.figure,
            )}
          >
            <span className={cn('size-2 shrink-0 rounded-full', isQuiet ? QUIET.dot : look.dot)} />
            {figure}
          </span>
          {action ?? <Caption>{note}</Caption>}
        </div>
      </CardFrame>
    );
  }

  return (
    <CardFrame label={title} glow={isQuiet ? undefined : look.glow} tap={tap}>
      {head}
      <div className="mt-3.5 flex min-w-0 items-baseline justify-between gap-2.5">
        <BigValue value={figure} size={30} className={isQuiet ? undefined : look.figure} />
        {action ??
          (isQuiet ? (
            <Caption>{note}</Caption>
          ) : (
            <Caption>{t('dashboard.cards.summaryCard.ofTotal', 'of {{total}}', { total })}</Caption>
          ))}
      </div>
      <div className="grow" />
      <div>
        {found.slice(0, 3).map((each, index) => (
          <Link
            key={each.entity.entityId}
            to={entityPath(each.entity.entityId)}
            className={cn(
              'flex min-w-0 items-center gap-2.5 py-1.5 transition-colors duration-150 hover:text-foreground',
              index > 0 && 'border-t border-border',
            )}
          >
            <span className="min-w-0 grow truncate text-caption text-foreground-muted">
              {each.entity.name}
            </span>
            <FoundEnd what={what} seen={each} />
          </Link>
        ))}
      </div>
    </CardFrame>
  );
}

/**
 * How many devices, and where.
 *
 * @param place - The area's name, or null for the whole house.
 * @param count - How many.
 * @returns "12 devices", "Kitchen · 3 devices".
 */
function devicesIn(place: string | null, count: number): string {
  const devices = translate('dashboard.cards.summaryCard.devices', {
    count,
    defaultValue_one: '{{count}} device',
    defaultValue_other: '{{count}} devices',
  });

  return place === null ? devices : `${place} · ${devices}`;
}

/**
 * Renders what a counted row ends on: a battery's level as a short bar and its percent, how long
 * a door has been open, a light's level, the version an update brings, when a device was last
 * heard from.
 *
 * @param props - The row.
 * @param props.what - What was counted.
 * @param props.seen - The entity.
 * @returns The end of the row.
 */
function FoundEnd(props: {
  readonly what: Exclude<SummarySubject, 'glance'>;
  readonly seen: Seen;
}) {
  const { t } = useTranslation();

  const { what, seen } = props;
  const { state, changedAt } = seen;

  if (what === 'batteries') {
    const value = Math.round(state.sensor_numeric?.value ?? 0);
    const colour = value <= EMPTY_BATTERY ? 'danger' : 'warning';

    return (
      <>
        <span className="h-1 w-11 shrink-0 overflow-hidden rounded-pill bg-surface-high">
          <span
            className={cn('block h-full', colour === 'danger' ? 'bg-danger' : 'bg-warning')}
            /* eslint-disable-next-line react/forbid-dom-props -- the bar is as long as the level. */
            style={{ width: `${String(value)}%` }}
          />
        </span>
        <span
          className={cn(
            'w-7 shrink-0 text-right text-caption tabular-nums',
            colour === 'danger' ? 'text-danger' : 'text-warning',
          )}
        >
          {`${String(value)}%`}
        </span>
      </>
    );
  }

  const end = {
    openings: changedAt === null ? '' : forHowLong(changedAt),
    lights:
      state.level === undefined
        ? t('dashboard.cards.summaryCard.on', 'On')
        : `${String(Math.round(state.level.level))}%`,
    updates: state.update?.latestVersion ?? '',
    offline:
      changedAt === null
        ? ''
        : t('dashboard.cards.kit.lastSeen', 'last seen {{time}}', { time: cardTime(changedAt) }),
  }[what];

  return <span className="shrink-0 text-caption text-foreground-subtle tabular-nums">{end}</span>;
}

/** What the house at a glance needs. */
type GlanceFaceProps = {
  readonly card: DashboardSummaryCard;
  readonly title: string;
  readonly glance: readonly {
    readonly subject: CountedSubject;
    readonly figure: string;
    readonly count: Count;
  }[];
  readonly tap: CountFaceProps['tap'];
};

/**
 * Renders the house at a glance: its five counts side by side on the 2×1, as a row of marks on
 * the 1×1, as five rows on the 1×2. A count of zero is written in the quiet colour.
 *
 * @param props - See {@link GlanceFaceProps}.
 * @returns The card.
 */
function GlanceFace(props: GlanceFaceProps) {
  const { t } = useTranslation();

  const { card, title, glance, tap } = props;
  const columns = glance.map((column) => {
    const many = column.count.found.length;

    return {
      ...column,
      many,
      icon: column.subject === 'blinds' ? ('blinds' as const) : LOOKS[column.subject].icon,
      label: {
        lights: t('dashboard.cards.summaryCard.glanceLights', 'Lights'),
        openings: t('dashboard.cards.summaryCard.glanceDoors', 'Doors'),
        blinds: t('dashboard.cards.summaryCard.glanceBlinds', 'Blinds'),
        batteries: t('dashboard.cards.summaryCard.glanceBatteries', 'Batteries'),
        updates: t('dashboard.cards.summaryCard.updates', 'Updates'),
        offline: t('dashboard.cards.summaryCard.glanceOffline', 'Offline'),
      }[column.subject],
      value: {
        lights: t('dashboard.cards.summaryCard.countOn', '{{count}} on', { count: many }),
        openings: t('dashboard.cards.summaryCard.countOpen', '{{count}} open', { count: many }),
        blinds: t('dashboard.cards.summaryCard.countOpen', '{{count}} open', { count: many }),
        batteries: t('dashboard.cards.summaryCard.countLow', '{{count}} low', { count: many }),
        updates: t('dashboard.cards.summaryCard.countReady', '{{count}} ready', { count: many }),
        offline: String(many),
      }[column.subject],
      colour: many === 0 ? 'text-foreground-muted' : column.figure,
    };
  });
  const head = (
    <OverviewHead
      icon="house"
      chip="bg-primary/14 text-primary"
      title={title}
      subtitle={t('dashboard.cards.summaryCard.atAGlance', 'At a glance')}
    />
  );

  if (card.w === 2 && card.h === 1) {
    return (
      <CardFrame label={title} tap={tap}>
        <div className="flex h-full items-center gap-5">
          <div className="w-33 shrink-0">{head}</div>
          <div className="grid grow grid-cols-5 gap-2.5">
            {columns.map((column) => (
              <div key={column.subject} className="flex min-w-0 flex-col gap-[3px]">
                <span className="text-label tracking-normal whitespace-nowrap text-foreground-subtle">
                  {column.label}
                </span>
                <span
                  className={cn(
                    'truncate text-title font-medium tabular-nums transition-colors duration-200',
                    column.colour,
                  )}
                >
                  {column.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardFrame>
    );
  }

  if (card.h === 1) {
    return (
      <CardFrame label={title} tap={tap}>
        {head}
        <div className="grow" />
        <div className="flex min-w-0 items-center justify-between gap-2">
          {columns.map((column) => (
            <span
              key={column.subject}
              title={`${column.label} · ${column.value}`}
              className={cn(
                'inline-flex items-center gap-1.5 text-title font-medium tabular-nums transition-colors duration-200',
                column.colour,
              )}
            >
              <AppIcon id={column.icon} size={14} />
              {String(column.many)}
            </span>
          ))}
        </div>
      </CardFrame>
    );
  }

  return (
    <CardFrame label={title} tap={tap}>
      {head}
      <div className="grow" />
      <div>
        {columns.map((column, index) => (
          <div
            key={column.subject}
            className={cn(
              'flex h-7 min-w-0 items-center gap-2.5',
              index > 0 && 'border-t border-border',
            )}
          >
            <span className="min-w-0 grow truncate text-caption text-foreground-muted">
              {column.label}
            </span>
            <span className={cn('shrink-0 text-ui-sm font-medium tabular-nums', column.colour)}>
              {column.value}
            </span>
          </div>
        ))}
      </div>
    </CardFrame>
  );
}
