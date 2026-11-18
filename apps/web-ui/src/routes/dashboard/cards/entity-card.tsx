/**
 * An entity's card: works out what it shows once, then hands it to the card for its kind.
 *
 * Two states come before any kind. An entity that is not in the registry - removed, or one this
 * person may not see - leaves a card that says so, with the address it names, rather than a hole
 * in the page; one switched off in Devices keeps its place with a dashed edge and, for whoever may
 * change it, Enable. Everything else is drawn by its kind, at its size, or at the nearest size its
 * kind is drawn for when what it can do has changed since the card was placed - and the states
 * every kind shares (out of reach, view only, sending, no answer) are drawn by each kind with the
 * same parts (`card-kit.tsx`), so the card keeps its shape through them.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardEntityCard, EntityView, IconView } from '@nebulahome/contracts';
import { AppIcon, toast } from '@nebulahome/ui';

import { allowedSizes, cardKindOf, snapSize, type EntityCardKind } from '@/dashboard/card-sizes';
import { toMessage } from '@/lib/error-message';
import { LIBRARY_QUERY_KEYS, updateEntity } from '@/library/api';
import { capabilityStateOf, hasCapability, powerCommand } from '@/library/entity-control';
import { entityKindOf } from '@/library/entity-kind';
import { readingOf } from '@/library/entity-reading';
import { BinaryCard } from '@/routes/dashboard/cards/binary-card';
import { CameraCard } from '@/routes/dashboard/cards/camera-card';
import { Caption } from '@/routes/dashboard/cards/card-kit';
import { CardFrame, CardTapContext, type CardTap } from '@/routes/dashboard/cards/card-parts';
import { MowerCard, VacuumCard } from '@/routes/dashboard/cards/control-card';
import { CustomCard } from '@/routes/dashboard/cards/control-custom-card';
import { PictureCard } from '@/routes/dashboard/cards/control-picture-card';
import {
  ButtonCard,
  NumberCard,
  SelectCard,
  UpdateCard,
} from '@/routes/dashboard/cards/control-settings-card';
import { CoverCard } from '@/routes/dashboard/cards/cover-card';
import type { EntityCardModel } from '@/routes/dashboard/cards/entity-model';
import { FanCard } from '@/routes/dashboard/cards/fan-card';
import { LightCard } from '@/routes/dashboard/cards/light-card';
import { LockCard } from '@/routes/dashboard/cards/lock-card';
import { MediaCard } from '@/routes/dashboard/cards/media-card';
import { PersonCard } from '@/routes/dashboard/cards/person-card';
import { SensorCard } from '@/routes/dashboard/cards/sensor-card';
import { SwitchCard } from '@/routes/dashboard/cards/switch-card';
import { ThermostatCard } from '@/routes/dashboard/cards/thermostat-card';
import { TimeCard } from '@/routes/dashboard/cards/time-card';
import { useCardCommand } from '@/routes/dashboard/cards/use-card-command';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';
import { entityPath } from '@/routes/library/entity/entity-path';
import { EntityTile } from '@/routes/library/entity-tile';

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
  vacuum: VacuumCard,
  mower: MowerCard,
  select: SelectCard,
  number: NumberCard,
  button: ButtonCard,
  update: UpdateCard,
  picture: PictureCard,
  custom: CustomCard,
  fan: FanCard,
  time: TimeCard,
  person: PersonCard,
};

/** What an entity card needs. */
export type EntityCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardEntityCard;

  /** What the page read for its cards. */
  readonly data: DashboardData;
};

/** What the card of an entity that is not there needs. */
export type MissingCardProps = {
  /** The card, with the address it names and the title it was given. */
  readonly card: DashboardEntityCard;

  /** Whether it is one row tall. */
  readonly isCompact: boolean;

  /**
   * The editor's Replace and Remove, drawn where the boards draw them; the read-only page passes
   * none.
   */
  readonly actions?: ReactNode;
};

/**
 * Renders the card for an entity that is not there to show: removed, or not one this person may
 * see. It keeps its place, says so, and names the address it was given; a tile says what the card
 * was called, a tall card why it stays.
 *
 * @param props - See {@link MissingCardProps}.
 * @returns The card.
 */
export function MissingCard(props: MissingCardProps) {
  const { t } = useTranslation();

  const { card, isCompact, actions } = props;
  const removed = t('dashboard.cards.entityCard.entityRemoved', 'Entity removed');
  const end =
    actions === undefined || actions === null ? null : (
      <div className="flex shrink-0 gap-1.5">{actions}</div>
    );

  if (!isCompact) {
    return (
      <CardFrame label={card.title ?? removed} tone="faint">
        <div className="flex h-full flex-col items-center justify-center gap-2.5 text-center">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-field bg-warning/14 text-warning">
            <AppIcon id="triangle-alert" size={18} />
          </span>
          <div className="flex max-w-full min-w-0 flex-col items-center gap-0.5">
            <span className="text-ui font-medium">{removed}</span>
            <Caption>{card.entityId}</Caption>
          </div>
          <span className="max-w-[220px] text-ui-sm text-foreground-muted">
            {t(
              'dashboard.cards.entityCard.keepsItsPlace',
              'The card keeps its place until you pick another entity or remove it.',
            )}
          </span>
          {end}
        </div>
      </CardFrame>
    );
  }

  const head = (
    <div className="flex h-8 min-w-0 shrink-0 items-center gap-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-field bg-warning/14 text-warning">
        <AppIcon id="triangle-alert" size={16} />
      </span>
      <div className="flex min-w-0 grow flex-col">
        <span className="truncate text-ui leading-[18px] font-medium">{removed}</span>
        <span className="truncate text-caption leading-4 text-foreground-subtle">
          {card.entityId}
        </span>
      </div>
    </div>
  );

  return (
    <CardFrame label={card.title ?? removed} tone="faint">
      {card.w > 1 ? (
        <div className="flex h-full min-w-0 items-center justify-between gap-2.5">
          <div className="min-w-0 grow">{head}</div>
          {end}
        </div>
      ) : (
        <>
          {head}
          <div className="grow" />
          <div className="flex min-w-0 items-center justify-between gap-2.5">
            <Caption>
              {card.title === null
                ? ''
                : t('dashboard.cards.entityCard.wasTitle', 'Was {{title}}', { title: card.title })}
            </Caption>
            {end}
          </div>
        </>
      )}
    </CardFrame>
  );
}

/**
 * Renders the card of an entity switched off in Devices: it keeps its place with a dashed edge,
 * says so, and offers Enable to whoever may change it; others are told to ask an admin.
 *
 * @param props - The entity and its card.
 * @param props.entity - The entity.
 * @param props.title - What the card is headed.
 * @param props.icon - The card's icon.
 * @param props.isCompact - Whether it is one row tall.
 * @param props.canEnable - Whether this person may switch it back on.
 * @returns The card.
 */
function DisabledCard(props: {
  readonly entity: EntityView;
  readonly title: string;
  readonly icon: IconView | undefined;
  readonly isCompact: boolean;
  readonly canEnable: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { entity, title, icon, isCompact, canEnable } = props;
  const enable = useMutation({
    /**
     * Switches the entity back on.
     *
     * @returns The entity as it is now.
     */
    mutationFn: async () => updateEntity(entity.entityId, { isEnabled: true }),

    /** Reads the entities again, so the card draws the entity as it is. */
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.entities });
    },

    /**
     * Says why it could not be switched on.
     *
     * @param error - What went wrong.
     */
    onError: (error) => {
      toast.error({
        title: t('dashboard.cards.entityCard.couldNotEnable', 'Could not enable it'),
        message: toMessage(error),
      });
    },
  });
  const action = canEnable ? (
    <button
      type="button"
      disabled={enable.isPending}
      className="press-scale inline-flex h-7.5 shrink-0 items-center rounded-pill border border-border-strong bg-surface-raised px-3.5 text-ui-sm font-medium text-foreground hover:enabled:bg-surface-high disabled:opacity-60"
      onClick={() => {
        enable.mutate();
      }}
    >
      {t('dashboard.cards.entityCard.enable', 'Enable')}
    </button>
  ) : (
    <Caption>{t('dashboard.cards.entityCard.askAnAdmin', 'Ask an admin')}</Caption>
  );
  const tile = (
    <EntityTile
      icon={icon}
      kind={{ ...entityKindOf(entity), icon: 'ban' }}
      isActive={false}
      size="medium"
    />
  );

  if (isCompact) {
    return (
      <CardFrame label={title} tone="faint">
        <div className="flex h-8 shrink-0 items-center gap-2.5">
          {tile}
          <div className="flex min-w-0 grow flex-col">
            <span className="truncate text-ui leading-[18px] font-medium">{title}</span>
            <span className="truncate text-caption leading-4 text-foreground-subtle">
              {entity.areaName}
            </span>
          </div>
        </div>
        <div className="grow" />
        <div className="flex items-center justify-between gap-2.5">
          <Caption>{t('dashboard.cards.entityCard.disabled', 'Disabled')}</Caption>
          {action}
        </div>
      </CardFrame>
    );
  }

  return (
    <CardFrame label={title} tone="faint">
      <div className="flex grow flex-col items-center justify-center gap-1.5 text-center">
        {tile}
        <span className="mt-1.5 truncate text-ui font-medium">{title}</span>
        <Caption>
          {t('dashboard.cards.entityCard.disabledInDevices', 'Disabled in Devices')}
        </Caption>
        <div className="mt-2">{action}</div>
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
  const live = entity === undefined ? undefined : data.readings[entity.entityId];
  const reportedAt = live?.receivedAt ?? entity?.lastUpdated?.getTime() ?? null;
  const command = useCardCommand(card.entityId, reportedAt);

  if (entity === undefined) {
    return <MissingCard card={card} isCompact={card.h === 1} />;
  }

  const kind = cardKindOf(entity);
  const allowed = allowedSizes(entity);
  const fits = allowed.some((size) => size.w === card.w && size.h === card.h);
  const iconId = card.icon ?? entity.icon;
  const icon: IconView | undefined = iconId === null ? undefined : data.icons.get(iconId);
  const reading = readingOf(entity, live);
  const title = card.title ?? data.entityTitleOf(entity);

  if (!entity.isEnabled) {
    return (
      <DisabledCard
        entity={entity}
        title={title}
        icon={icon}
        isCompact={card.h === 1}
        canEnable={data.canWriteEntity(entity)}
      />
    );
  }

  const model: EntityCardModel = {
    card,
    entity,
    state: capabilityStateOf(entity, live),
    reading,
    reportedAt,
    changedAt: live?.changedAt ?? entity.lastChanged,
    title,
    // While its integration or package is updated the value is the last one: say so in words.
    subtitle: reading.isUpdating
      ? t('dashboard.cards.updating', 'Updating… last value shown')
      : entity.areaName,
    icon,
    kind: entityKindOf(entity),
    size: fits ? { w: card.w, h: card.h } : snapSize(allowed, card.w, card.h, card.w),
    canControl: data.canControl(entity),
    canReadHistory: data.canReadHistory(entity),
    isOffline: !reading.isAvailable,
    command,
    hidden: new Set(card.hide ?? []),
  };
  const Card = KINDS[kind];

  return (
    <CardFrameTap model={model}>
      <Card model={model} />
    </CardFrameTap>
  );
}

/**
 * Gives a card's face the tap its settings chose: open the entity (the default), switch it on or
 * off, or nothing. The card's own controls keep their taps.
 *
 * @param props - The card and what it draws.
 * @param props.model - The card.
 * @param props.children - The card's kind, drawn.
 * @returns The card with its tap.
 */
function CardFrameTap(props: { readonly model: EntityCardModel; readonly children: ReactNode }) {
  const { t } = useTranslation();

  const { model, children } = props;
  const tap = model.card.tap ?? 'sheet';
  const canToggle =
    tap === 'toggle' &&
    hasCapability(model.entity, 'on_off') &&
    model.canControl &&
    !model.isOffline &&
    model.command.sending === null;
  const face: CardTap | undefined =
    tap === 'sheet'
      ? {
          kind: 'open',
          to: entityPath(model.entity.entityId),
          label: t('dashboard.cards.entityCard.open', 'Open {{name}}', { name: model.title }),
        }
      : canToggle
        ? {
            kind: 'press',
            label: t('dashboard.cards.entityCard.toggle', 'Turn {{name}} on or off', {
              name: model.title,
            }),
            /** Switches the entity the other way. */
            onPress: () => {
              model.command.send('on_off', powerCommand(!(model.state.on_off?.isOn ?? false)));
            },
          }
        : undefined;

  return <CardTapContext value={face}>{children}</CardTapContext>;
}
