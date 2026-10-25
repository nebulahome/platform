/**
 * An entity's card: works out what it shows once, then hands it to the card for its kind.
 *
 * Three states come before any kind. An entity that is not in the registry - removed, or one this
 * person may not see - leaves a card that says so, with the address it names, rather than a hole
 * in the page. An entity that cannot be reached says so in a word and an icon, with the last thing
 * it said and when. Everything else is drawn by its kind, at its size, or at the nearest size its
 * kind is drawn for when what it can do has changed since the card was placed.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardEntityCard, IconView } from '@nebulahome/contracts';
import { AppIcon, CardHeading } from '@nebulahome/ui';

import { CARD_SIZES, cardKindOf, snapSize, type EntityCardKind } from '@/dashboard/card-sizes';
import { capabilityStateOf } from '@/library/entity-control';
import { entityKindOf } from '@/library/entity-kind';
import { readingOf } from '@/library/entity-reading';
import { BinaryCard } from '@/routes/dashboard/cards/binary-card';
import { CameraCard } from '@/routes/dashboard/cards/camera-card';
import { CardFrame, TileRow, UnavailableNote } from '@/routes/dashboard/cards/card-parts';
import { ControlCard } from '@/routes/dashboard/cards/control-card';
import { CoverCard } from '@/routes/dashboard/cards/cover-card';
import { cardTime, sizeKey, type EntityCardModel } from '@/routes/dashboard/cards/entity-model';
import { LightCard } from '@/routes/dashboard/cards/light-card';
import { LockCard } from '@/routes/dashboard/cards/lock-card';
import { MediaCard } from '@/routes/dashboard/cards/media-card';
import { SensorCard } from '@/routes/dashboard/cards/sensor-card';
import { SwitchCard } from '@/routes/dashboard/cards/switch-card';
import { ThermostatCard } from '@/routes/dashboard/cards/thermostat-card';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';

/** The card each kind is drawn by. */
const KINDS: Readonly<
  Record<EntityCardKind, (props: { readonly model: EntityCardModel }) => ReactNode>
> = {
  light: LightCard,
  switch: SwitchCard,
  sensor: SensorCard,
  text: SensorCard,
  binary: BinaryCard,
  thermostat: ThermostatCard,
  cover: CoverCard,
  lock: LockCard,
  media: MediaCard,
  camera: CameraCard,
  control: ControlCard,
};

/** What an entity card needs. */
export type EntityCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardEntityCard;

  /** What the page read for its cards. */
  readonly data: DashboardData;
};

/**
 * Renders the card for an entity that is not there to show.
 *
 * @param props - The card and where it sits.
 * @param props.card - The card.
 * @param props.isCompact - Whether it is one row tall.
 * @returns The card.
 */
function MissingCard(props: { readonly card: DashboardEntityCard; readonly isCompact: boolean }) {
  const { t } = useTranslation();

  const { card, isCompact } = props;
  const title = card.title ?? card.entityId;

  return (
    <CardFrame label={title} tone="faint">
      <div className="flex h-full min-w-0 flex-col gap-1.5">
        <span className="flex items-center gap-2 text-foreground-muted">
          <AppIcon id="triangle-alert" size={15} />
          <span className="truncate text-ui font-medium">
            {card.title ?? t('dashboard.cards.entityCard.entityNotFound', 'Entity not found')}
          </span>
        </span>
        <span className="truncate font-mono text-caption text-foreground-subtle">
          {card.entityId}
        </span>
        {isCompact ? null : (
          <span className="text-caption text-foreground-subtle">
            {t(
              'dashboard.cards.entityCard.itWasRemovedOr',
              'It was removed, or it is not one you may see. Choose another in the layout editor.',
            )}
          </span>
        )}
      </div>
    </CardFrame>
  );
}

/**
 * Renders the card for an entity that cannot be reached.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
function UnavailableCard(props: { readonly model: EntityCardModel }) {
  const { model } = props;
  const { title, subtitle, reading } = model;
  const last =
    reading.at === null ? undefined : `Last said ${reading.text} at ${cardTime(reading.at)}.`;

  if (sizeKey(model.size) === '1x1') {
    return (
      <CardFrame label={title} tone="faint">
        <TileRow
          icon={model.icon}
          kind={model.kind}
          isActive={false}
          isAvailable={false}
          title={title}
          subtitle={subtitle}
          tail={<UnavailableNote isCompact />}
        />
      </CardFrame>
    );
  }

  return (
    <CardFrame label={title} tone="faint">
      <CardHeading title={title} subtitle={subtitle} isMuted />
      <div className="mt-3">
        <UnavailableNote last={last} />
      </div>
    </CardFrame>
  );
}

/**
 * Renders an entity's card.
 *
 * @param props - See {@link EntityCardProps}.
 * @returns The card.
 */
export function EntityCard(props: EntityCardProps) {
  const { t } = useTranslation();
  const { card, data } = props;
  const entity = data.entityById.get(card.entityId);

  if (entity === undefined) {
    return <MissingCard card={card} isCompact={card.h === 1} />;
  }

  const live = data.readings[entity.entityId];
  const kind = cardKindOf(entity);
  const allowed = CARD_SIZES[kind].sizes;
  const fits = allowed.some((size) => size.w === card.w && size.h === card.h);
  const iconId = card.icon ?? entity.icon;
  const icon: IconView | undefined = iconId === null ? undefined : data.icons.get(iconId);
  const reading = readingOf(entity, live);
  const model: EntityCardModel = {
    card,
    entity,
    state: capabilityStateOf(entity, live),
    reading,
    reportedAt: live?.receivedAt ?? entity.lastUpdated?.getTime() ?? null,
    changedAt: live?.changedAt ?? entity.lastChanged,
    title: card.title ?? data.entityTitleOf(entity),
    // While its integration or package is updated the value is the last one: say so in words.
    subtitle: reading.isUpdating
      ? t('dashboard.cards.updating', 'Updating… last value shown')
      : entity.areaName,
    icon,
    kind: entityKindOf(entity),
    size: fits ? { w: card.w, h: card.h } : snapSize(allowed, card.w, card.h, card.w),
    canControl: data.canControl(entity),
    canReadHistory: data.canReadHistory(entity),
  };

  if (!model.reading.isAvailable) {
    return <UnavailableCard model={model} />;
  }

  const Card = KINDS[kind];

  return <Card model={model} />;
}
