/**
 * Entities of any kind as rows, each with its value or its one main control (`K-Overview`, Entity
 * list): a switch for what switches, and on the 2×3 the up and down of a cover and the minus and
 * plus of a thermostat. The 1×2 holds four rows, the 2×3 six, with a chip and where each is.
 * A row opens its entity; a list with nothing on it yet waits with a dashed face.
 *
 * Each row commands its own entity through the card command path, so it says when it is sending
 * and when its device did not answer, as an entity card does.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { DashboardListCard, EntityView } from '@nebulahome/contracts';
import { AppIcon, cn, Switch } from '@nebulahome/ui';

import { numberFormat } from '@/i18n/formatters';
import { capabilityStateOf, hasCapability, paramsOf, powerCommand } from '@/library/entity-control';
import { entityKindOf } from '@/library/entity-kind';
import { readingOf } from '@/library/entity-reading';
import { forHowLong, NoAnswer } from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import { isActiveOf } from '@/routes/dashboard/cards/overview-counts';
import {
  OverviewHead,
  OverviewRoundButton,
  toneText,
  WaitingFace,
} from '@/routes/dashboard/cards/overview-parts';
import { useCardCommand } from '@/routes/dashboard/cards/use-card-command';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';
import { entityPath } from '@/routes/library/entity/entity-path';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';
import { EntityTile } from '@/routes/library/entity-tile';

/** The kinds of binary sensor whose open state asks for a look. */
const OPENINGS: ReadonlySet<string> = new Set(['door', 'window', 'garage_door', 'opening']);

/** What a list card needs. */
export type ListCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardListCard;

  /** What the page read for its cards. */
  readonly data: DashboardData;
};

/**
 * Writes a temperature as a card does: one decimal and a degree sign.
 *
 * @param value - The temperature.
 * @returns "21.5°".
 */
function degrees(value: number): string {
  return `${numberFormat({ minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)}°`;
}

/**
 * Renders a list card.
 *
 * @param props - See {@link ListCardProps}.
 * @returns The card.
 */
export function ListCard(props: ListCardProps) {
  const { t } = useTranslation();

  const { card, data } = props;
  const title = card.title ?? t('dashboard.cards.listCard.entityList', 'Entity list');
  const entities = card.entityIds.flatMap((entityId) => {
    const entity = data.entityById.get(entityId);

    return entity === undefined ? [] : [entity];
  });
  const isLarge = card.h >= 3;

  if (entities.length === 0) {
    return (
      <WaitingFace
        label={title}
        icon="list"
        title={t('dashboard.cards.listCard.noEntitiesYet', 'No entities yet')}
        note={t('dashboard.cards.listCard.pickThem', 'Pick them in its settings')}
      />
    );
  }

  return (
    <CardFrame label={title}>
      <OverviewHead
        icon="list"
        chip="bg-primary/14 text-primary"
        title={title}
        subtitle={t('dashboard.cards.listCard.entities', {
          count: entities.length,
          defaultValue_one: '{{count}} entity',
          defaultValue_other: '{{count}} entities',
        })}
      />
      <div className="grow" />
      <div>
        {entities.slice(0, isLarge ? 6 : 4).map((entity) => (
          <ListRow key={entity.entityId} entity={entity} data={data} isLarge={isLarge} />
        ))}
      </div>
    </CardFrame>
  );
}

/**
 * Renders one row: the entity's glyph or chip, its name, and its value or its control.
 *
 * @param props - The row.
 * @param props.entity - The entity.
 * @param props.data - What the page read.
 * @param props.isLarge - Whether it is a 2×3 row, with a chip, where it is, and more controls.
 * @returns The row.
 */
function ListRow(props: {
  readonly entity: EntityView;
  readonly data: DashboardData;
  readonly isLarge: boolean;
}) {
  const { t } = useTranslation();

  const { entity, data, isLarge } = props;
  const live = data.readings[entity.entityId];
  const state = capabilityStateOf(entity, live);
  const reading = readingOf(entity, live);
  const reportedAt = live?.receivedAt ?? entity.lastUpdated?.getTime() ?? null;
  const changedAt = live?.changedAt ?? entity.lastChanged;
  const command = useCardCommand(entity.entityId, reportedAt);
  const isOn = state.on_off?.isOn ?? false;
  const power = usePendingValue(isOn, reportedAt, command.sending === 'on_off');
  const isOpening = OPENINGS.has(entity.deviceClass ?? '') && state.sensor_binary !== undefined;
  const isOpen = isOpening && state.sensor_binary?.isOn === true;
  // A door or a window is drawn as one, open or shut, whatever kind of sensor reports it.
  const kind = isOpening
    ? { ...entityKindOf(entity), icon: isOpen ? ('door-open' as const) : ('door-closed' as const) }
    : entityKindOf(entity);
  const isOffline = !reading.isAvailable;
  const canControl = data.canControl(entity);
  const isActive = isActiveOf(state);
  const thermostat = state.thermostat;
  const lock = state.lock?.lockState;
  const name = entity.name;

  /**
   * Whether a control of the row takes input now.
   *
   * @param capability - The control's capability.
   * @returns True when it does.
   */
  const usable = (capability: string): boolean =>
    canControl && !isOffline && (command.sending === null || command.sending === capability);

  /**
   * Moves the thermostat's target one step.
   *
   * @param direction - Down or up.
   */
  const nudge = (direction: -1 | 1): void => {
    const params = paramsOf(entity, 'thermostat');
    const step = params?.temperatureStep ?? 0.5;
    const from = thermostat?.targetTemperature ?? 20;
    const next = Math.min(
      params?.maxTemperature ?? 35,
      Math.max(params?.minTemperature ?? 5, Math.round((from + direction * step) / step) * step),
    );

    command.send('thermostat', { command: 'set_target', temperature: next });
  };

  const value =
    thermostat === undefined
      ? isOpen && isLarge && changedAt !== null
        ? `${reading.text} · ${forHowLong(changedAt)}`
        : reading.text
      : degrees(thermostat.targetTemperature);
  const valueColor = isOffline
    ? 'text-foreground-subtle'
    : lock === 'locked'
      ? 'text-success'
      : lock === 'unlocked'
        ? 'text-warning'
        : lock === 'jammed'
          ? 'text-danger'
          : isOpen
            ? 'text-warning'
            : 'text-foreground';
  const control = !canControl ? null : isLarge && thermostat !== undefined ? (
    <div className="flex shrink-0 gap-1.5">
      <OverviewRoundButton
        label={t('dashboard.cards.listCard.lower', 'Lower')}
        icon="minus"
        disabled={!usable('thermostat')}
        onPress={() => {
          nudge(-1);
        }}
      />
      <OverviewRoundButton
        label={t('dashboard.cards.listCard.raise', 'Raise')}
        icon="plus"
        disabled={!usable('thermostat')}
        onPress={() => {
          nudge(1);
        }}
      />
    </div>
  ) : isLarge && state.cover !== undefined ? (
    <div className="flex shrink-0 gap-1.5">
      <OverviewRoundButton
        label={t('dashboard.cards.listCard.open', 'Open')}
        icon="chevron-up"
        disabled={!usable('cover')}
        onPress={() => {
          command.send('cover', { command: 'open' });
        }}
      />
      <OverviewRoundButton
        label={t('dashboard.cards.listCard.close', 'Close')}
        icon="chevron-down"
        disabled={!usable('cover')}
        onPress={() => {
          command.send('cover', { command: 'close' });
        }}
      />
    </div>
  ) : hasCapability(entity, 'on_off') && state.cover === undefined && thermostat === undefined ? (
    <Switch
      label={name}
      size="small"
      isOn={command.hasFailed ? isOn : power.shown}
      isBusy={command.sending === 'on_off'}
      disabled={!usable('on_off')}
      onChange={(next) => {
        power.sent(next);
        command.send('on_off', powerCommand(next));
      }}
    />
  ) : null;
  const end = control ?? (
    <span
      className={cn(
        'shrink-0 text-ui-sm whitespace-nowrap tabular-nums transition-colors duration-200',
        valueColor,
      )}
    >
      {value}
    </span>
  );
  const level = state.level?.level;
  const where = [
    thermostat === undefined ? entity.areaName : kind.label,
    thermostat?.currentTemperature === undefined
      ? isOn && level !== undefined
        ? `${String(Math.round(level))}%`
        : null
      : t('dashboard.cards.listCard.now', 'now {{value}}', {
          value: degrees(thermostat.currentTemperature),
        }),
  ]
    .filter((part) => part !== null && part !== '')
    .join(' · ');
  const lit = isOpen
    ? 'text-warning'
    : isActive === false || isOffline
      ? 'text-foreground-subtle'
      : toneText(kind);

  return (
    <div
      className={cn(
        'relative box-border flex min-w-0 items-center gap-2.5 border-t border-border',
        isLarge ? 'h-[42px]' : 'h-[34px]',
      )}
    >
      <Link
        to={entityPath(entity.entityId)}
        aria-label={t('dashboard.cards.listCard.openName', 'Open {{name}}', { name })}
        className="absolute inset-0 rounded-field transition-colors duration-150 hover:bg-foreground/[0.025] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      />
      {command.hasFailed ? (
        <span className="relative z-10 min-w-0 grow">
          <NoAnswer command={command} what={name} />
        </span>
      ) : (
        <>
          {isLarge ? (
            <EntityTile
              icon={undefined}
              kind={kind}
              isActive={isActive}
              isAvailable={!isOffline}
              size="small"
              className={cn(
                'pointer-events-none rounded-field',
                isOpen && 'bg-warning/14 text-warning',
              )}
            />
          ) : (
            <span
              aria-hidden="true"
              className={cn('pointer-events-none inline-flex shrink-0', lit)}
            >
              <AppIcon id={kind.icon} size={16} />
            </span>
          )}
          {isLarge ? (
            <span className="pointer-events-none flex min-w-0 grow flex-col">
              <span className="truncate text-ui-sm text-foreground">{name}</span>
              <span className="truncate text-label tracking-normal text-foreground-subtle">
                {where}
              </span>
            </span>
          ) : (
            <span className="pointer-events-none min-w-0 grow truncate text-ui-sm text-foreground">
              {name}
            </span>
          )}
          <span
            className={cn(
              'flex shrink-0 items-center',
              control === null ? 'pointer-events-none' : 'relative z-10',
            )}
          >
            {end}
          </span>
        </>
      )}
    </div>
  );
}
