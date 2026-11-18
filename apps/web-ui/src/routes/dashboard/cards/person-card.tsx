/**
 * A person: home, away, or the name of the zone they are in (`K-New`, Person).
 *
 * The head is the person's initials in a ring of their own colour rather than an icon. The tile
 * says where, with a dot - green at home, the accent in a zone, grey away - and since when, or
 * how far and how long ago while away; the tall card writes the place large over its facts; the
 * square puts the place beside the map (the house's own tiles, through the API), which a tap on
 * the card opens in full on the entity sheet.
 *
 * A person's phone battery is an entity of its own on the same device, which the card is not
 * given: it is not drawn here.
 */
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, cn } from '@nebulahome/ui';

import { numberFormat } from '@/i18n/formatters';
import { durationText } from '@/library/history-stats';
import { BigValue, Caption } from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import { cardTime, sizeKey, type EntityCardModel } from '@/routes/dashboard/cards/entity-model';
import { useMinute } from '@/routes/dashboard/cards/time-card';

/**
 * The house's map, loaded when a square person card first draws one: the rest of the dashboard
 * does without Leaflet.
 *
 * @returns The map's module, as `lazy` takes it.
 */
const HouseMap = lazy(async () => {
  const module = await import('@/routes/library/house-map');

  return { default: module.HouseMap };
});

/** The rings a person's initials are drawn in, one per person, spelled out for Tailwind. */
const AVATARS = [
  'border-violet/50 bg-violet/18',
  'border-primary/50 bg-primary/18',
  'border-cyan/50 bg-cyan/18',
] as const;

/**
 * A person's ring: the same one every time for the same person.
 *
 * @param entityId - The person's entity.
 * @returns The ring's classes.
 */
function avatarOf(entityId: string): string {
  let sum = 0;

  for (let index = 0; index < entityId.length; index += 1) {
    sum += entityId.charCodeAt(index);
  }

  return AVATARS[sum % AVATARS.length] ?? AVATARS[0];
}

/**
 * A name's initials: the first letters of its first and last words.
 *
 * @param name - "Roberto Tani".
 * @returns "RT"; "R" for one word.
 */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/u);
  const first = words[0]?.charAt(0) ?? '';
  const last = words.length > 1 ? (words.at(-1)?.charAt(0) ?? '') : '';

  return `${first}${last}`.toUpperCase();
}

/**
 * Renders one fact under the place: what it is, and its value.
 *
 * @param props - The fact.
 * @param props.label - What it is.
 * @param props.value - Its value.
 * @param props.isQuiet - Whether the value is written quietly: a time, not a figure.
 * @param props.isFirst - Whether it starts the list, with no line above it.
 * @returns The row.
 */
function FactRow(props: {
  readonly label: string;
  readonly value: string;
  readonly isQuiet?: boolean;
  readonly isFirst?: boolean;
}) {
  const { label, value, isQuiet = false, isFirst = false } = props;

  return (
    <div
      className={cn(
        'flex min-w-0 items-center justify-between gap-2.5 py-[5px]',
        !isFirst && 'border-t border-border',
      )}
    >
      <span className="truncate text-caption text-foreground-muted tabular-nums">{label}</span>
      <span
        className={cn(
          'truncate text-caption tabular-nums',
          isQuiet ? 'text-foreground-subtle' : 'text-foreground',
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Renders a person card at its size.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function PersonCard(props: { readonly model: EntityCardModel }) {
  const { t } = useTranslation();

  const { model } = props;
  const { entity, state, title, reportedAt } = model;
  const key = sizeKey(model.size);
  const now = useMinute();
  const location = state.location;
  const zone = location?.zone ?? null;
  const isHome = zone === 'home';
  const isAway = zone === 'away';
  const km = location?.distanceKm;
  const distance =
    km === undefined
      ? null
      : t('dashboard.cards.personCard.km', '{{distance}} km', {
          distance: numberFormat({ maximumFractionDigits: km < 10 ? 1 : 0 }).format(km),
        });
  const updated =
    reportedAt === null
      ? null
      : t('dashboard.cards.personCard.ago', '{{time}} ago', {
          time: durationText(Math.max(0, now - reportedAt)),
        });
  const word =
    zone === null
      ? '—'
      : isHome
        ? t('dashboard.cards.personCard.home', 'Home')
        : isAway
          ? t('dashboard.cards.personCard.away', 'Away')
          : zone;
  const since =
    model.changedAt === null
      ? ''
      : t('dashboard.cards.personCard.since', 'since {{time}}', {
          time: cardTime(model.changedAt),
        });

  /**
   * The line under or beside the place: since when, how far and how long ago while away, or why
   * there is nothing to say.
   *
   * @param isTile - Whether it is the tile's, which says how far a person away is.
   * @returns The line.
   */
  const caption = (isTile: boolean): string => {
    if (model.isOffline) {
      return model.changedAt === null
        ? t('dashboard.cards.kit.unreachable', 'Not reachable')
        : t('dashboard.cards.kit.lastSeen', 'last seen {{time}}', {
            time: cardTime(model.changedAt),
          });
    }

    if (zone === null) {
      return t('dashboard.cards.kit.waitingForDevice', 'Waiting for the device');
    }

    return isTile && isAway && distance !== null
      ? [distance, updated].filter((part) => part !== null).join(' · ')
      : since;
  };

  const isDim = model.isOffline || zone === null;
  const head = (
    <div className="flex h-8 shrink-0 items-center gap-2.5">
      <span
        aria-hidden="true"
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full border text-caption font-medium transition-colors duration-200',
          model.isOffline
            ? 'border-border-strong bg-surface-raised text-foreground-subtle'
            : `${avatarOf(entity.entityId)} text-foreground`,
        )}
      >
        {initialsOf(title)}
      </span>
      <div className="flex min-w-0 grow flex-col">
        <span className="truncate text-ui leading-[18px] font-medium text-foreground">{title}</span>
        <span className="truncate text-caption leading-4 text-foreground-subtle">
          {model.reading.isUpdating
            ? model.subtitle
            : t('dashboard.cards.personCard.person', 'Person')}
        </span>
      </div>
      {model.isOffline ? (
        <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-pill border border-border-strong px-2.5 text-caption font-medium text-foreground-muted">
          <AppIcon id="wifi-off" size={12} />
          {t('dashboard.cards.kit.offline', 'Offline')}
        </span>
      ) : null}
    </div>
  );

  if (key === '1x1') {
    return (
      <CardFrame label={title}>
        {head}
        <div className="grow" />
        <div className="flex min-w-0 items-center justify-between gap-2.5">
          <span
            className={cn(
              'flex min-w-0 items-center gap-2 text-[20px] font-medium whitespace-nowrap transition-colors duration-200',
              isDim
                ? 'text-foreground-subtle'
                : isAway
                  ? 'text-foreground-muted'
                  : 'text-foreground',
            )}
          >
            {zone === null ? null : (
              <span
                className={cn(
                  'size-2 shrink-0 rounded-full transition-colors duration-200',
                  model.isOffline || isAway
                    ? 'bg-foreground-subtle/70'
                    : isHome
                      ? 'bg-success'
                      : 'bg-primary',
                )}
              />
            )}
            <span className="truncate">{word}</span>
          </span>
          <Caption>{caption(true)}</Caption>
        </div>
      </CardFrame>
    );
  }

  const place = (
    <div className="flex min-w-0 flex-col gap-1.5">
      <BigValue value={word} size={30} className={isDim ? 'text-foreground-subtle' : undefined} />
      <Caption>{caption(false)}</Caption>
    </div>
  );
  const fromHome =
    distance === null || isHome
      ? null
      : { label: t('dashboard.cards.personCard.fromHome', 'From home'), value: distance };
  const updatedRow =
    updated === null
      ? null
      : { label: t('dashboard.cards.personCard.updated', 'Updated'), value: updated };

  if (key === '2x2') {
    const hasPosition = location?.latitude !== undefined && location.longitude !== undefined;

    return (
      <CardFrame label={title}>
        {head}
        <div className="mt-4 flex min-h-0 grow gap-5">
          <div className="flex min-w-0 grow flex-col">
            {place}
            {updatedRow === null ? null : (
              <div className="mt-auto">
                <FactRow label={updatedRow.label} value={updatedRow.value} isQuiet isFirst />
              </div>
            )}
          </div>
          <div className="relative w-[250px] shrink-0 overflow-hidden rounded-tile border border-border bg-sheet">
            {hasPosition ? (
              // Without tiles - no network, a preview - the map is its plain dark ground.
              <Suspense fallback={null}>
                <HouseMap
                  value={{ latitude: location.latitude ?? 0, longitude: location.longitude ?? 0 }}
                  className="absolute inset-0 h-full rounded-none border-0 bg-transparent [&_.leaflet-control-attribution]:text-[9px] [&_.leaflet-control-zoom]:hidden"
                  onChange={() => undefined}
                />
              </Suspense>
            ) : null}
            {distance === null ? null : (
              <span className="absolute bottom-2 left-2 z-[1000] inline-flex h-5.5 items-center gap-1.5 rounded-pill bg-canvas/70 px-2 text-label tracking-normal text-foreground-muted">
                <AppIcon id="house" size={11} />
                {distance}
              </span>
            )}
          </div>
        </div>
      </CardFrame>
    );
  }

  return (
    <CardFrame label={title}>
      {head}
      <div className="mt-3.5">{place}</div>
      <div className="grow" />
      <div>
        {fromHome === null ? null : <FactRow label={fromHome.label} value={fromHome.value} />}
        {updatedRow === null ? null : (
          <FactRow label={updatedRow.label} value={updatedRow.value} isQuiet />
        )}
      </div>
    </CardFrame>
  );
}
