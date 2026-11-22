/**
 * One area in one card (`K-Overview`, Room): its climate on top - the temperature, the humidity,
 * what the thermostat is doing - then a row for each kind of thing it has: Lights, Blinds,
 * Speaker, Heating. Each row reads its group and has the one control that matters, acting on the
 * whole group at once; a row the room has nothing for is not drawn.
 *
 * The 1×1 is the temperature and a mark for each group, lit while it is on; a room without a
 * thermometer says what is on instead. The 1×2 adds the humidity and the first two rows; the 2×2
 * puts the climate at the left, with the day's temperature as a line, and up to four rows at the
 * right. A card whose room is not chosen yet waits with a dashed face.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardRoomCard } from '@nebulahome/contracts';
import { AppIcon, cn, Pill, Switch, type UiIconId } from '@nebulahome/ui';

import { numberFormat } from '@/i18n/formatters';
import { text, translate } from '@/i18n/messages';
import { paramsOf, powerCommand } from '@/library/entity-control';
import { entityKindOf } from '@/library/entity-kind';
import { BigValue } from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import { useGroupCommand, type GroupCommand } from '@/routes/dashboard/cards/overview-command';
import {
  averagePosition,
  roomOf,
  seenIn,
  type Room,
  type Seen,
} from '@/routes/dashboard/cards/overview-counts';
import {
  OverviewHead,
  OverviewRoundButton,
  toneText,
  WaitingFace,
} from '@/routes/dashboard/cards/overview-parts';
import { AreaLine } from '@/routes/dashboard/cards/reading-parts';
import { changeInLastHour } from '@/routes/dashboard/cards/reading-series';
import { useTelemetry } from '@/routes/dashboard/cards/use-card-history';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';
import { climateLookOf } from '@/routes/library/entity/sheet/bodies/climate-body';
import { TONE_CHOSEN } from '@/routes/library/entity/sheet/tones';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** The rows a room may have, in their order. */
type RowKind = 'lights' | 'blinds' | 'speaker' | 'heating';

/** The glyph of each row, and of its mark on the 1×1. */
const ROW_ICONS: Readonly<Record<RowKind, UiIconId>> = {
  lights: 'lightbulb',
  blinds: 'blinds',
  speaker: 'volume-1',
  heating: 'thermometer',
};

/** What a room card needs. */
export type RoomCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardRoomCard;

  /** What the page read for its cards. */
  readonly data: DashboardData;
};

/**
 * Writes a temperature as a card does: one decimal.
 *
 * @param value - The temperature.
 * @returns "21.4".
 */
function degrees(value: number): string {
  return numberFormat({ minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}

/**
 * Whether a room's thermostat is at work: heating, cooling, drying.
 *
 * @param room - The room.
 * @returns True while it works.
 */
function isWorking(room: Room): boolean {
  const action = room.thermostat?.state.thermostat?.action;

  return action !== undefined && action !== 'idle' && action !== 'off';
}

/**
 * What is on in a room, in a few words: "2 lights on · Playing", or "Nothing on".
 *
 * @param room - The room.
 * @returns The words.
 */
function whatIsOn(room: Room): string {
  const lightsOn = room.lights.filter((each) => each.state.on_off?.isOn === true).length;
  const blinds = averagePosition(room.blinds) ?? 0;
  const thermostat = room.thermostat?.state.thermostat;
  const parts = [
    lightsOn === 0
      ? null
      : translate('dashboard.cards.roomCard.lightsOn', {
          count: lightsOn,
          defaultValue_one: '{{count}} light on',
          defaultValue_other: '{{count}} lights on',
        }),
    blinds === 0
      ? null
      : translate('dashboard.cards.roomCard.blindsOpen', 'Blinds {{value}}%', { value: blinds }),
    room.speaker?.state.media_player?.playback === 'playing'
      ? translate('dashboard.cards.roomCard.playing', 'Playing')
      : null,
    thermostat !== undefined && isWorking(room) ? text(climateLookOf(thermostat).word) : null,
  ].filter((part) => part !== null);

  return parts.length === 0
    ? translate('dashboard.cards.roomCard.nothingOn', 'Nothing on')
    : parts.join(' · ');
}

/**
 * Renders a room card.
 *
 * @param props - See {@link RoomCardProps}.
 * @returns The card.
 */
export function RoomCard(props: RoomCardProps) {
  const { t } = useTranslation();

  const { card, data } = props;

  if (card.areaKey === 'pending') {
    return (
      <WaitingFace
        label={card.title ?? t('dashboard.cards.roomCard.room', 'Room')}
        icon="armchair"
        title={t('dashboard.cards.roomCard.noRoomYet', 'No room yet')}
        note={t('dashboard.cards.roomCard.chooseOne', 'Choose one in its settings')}
      />
    );
  }

  return <RoomFace card={card} data={data} />;
}

/**
 * Renders a room whose area is known.
 *
 * @param props - See {@link RoomCardProps}.
 * @returns The card.
 */
function RoomFace(props: RoomCardProps) {
  const { t } = useTranslation();

  const { card, data } = props;
  const group = useGroupCommand();
  const seen = seenIn(data.entityById.values(), data.readings, card.areaKey);
  const room = roomOf(seen);
  const isSquare = card.w === 2;
  const { thermometer, temperature, humidity } = room;
  const history = useTelemetry(
    thermometer?.entity.entityId ?? '',
    '24h',
    isSquare && thermometer !== undefined && data.canReadHistory(thermometer.entity),
  );
  // shortcut: an area with no entity has no name to read here; the areas' own list when one does.
  const title =
    card.title ??
    seen.find((each) => each.entity.areaName !== null)?.entity.areaName ??
    card.areaKey;
  const thermostat = room.thermostat?.state.thermostat;
  const look = thermostat === undefined ? null : climateLookOf(thermostat);
  const rows: RowKind[] = [
    ...(room.lights.length > 0 ? (['lights'] as const) : []),
    ...(room.blinds.length > 0 ? (['blinds'] as const) : []),
    ...(room.speaker === undefined ? [] : (['speaker'] as const)),
    ...(room.thermostat === undefined ? [] : (['heating'] as const)),
  ];
  const isLit =
    room.lights.some((each) => each.state.on_off?.isOn === true) ||
    (averagePosition(room.blinds) ?? 0) > 0 ||
    room.speaker?.state.media_player?.playback === 'playing' ||
    isWorking(room);
  const unit = thermometer?.entity.unitOfMeasurement ?? '°C';
  const points = history?.points ?? [];
  const change =
    history === undefined ? null : changeInLastHour(points, temperature, history.window.to);
  const trend =
    change === null
      ? null
      : change > 0
        ? t('dashboard.cards.sensorCard.upShort', '▲ {{change}} in 1 h', {
            change: degrees(Math.abs(change)),
          })
        : change < 0
          ? t('dashboard.cards.sensorCard.downShort', '▼ {{change}} in 1 h', {
              change: degrees(Math.abs(change)),
            })
          : t('dashboard.cards.sensorCard.steadyShort', 'Steady in 1 h');
  const heating =
    thermostat === undefined || look === null
      ? null
      : isWorking(room)
        ? t('dashboard.cards.roomCard.actionTo', '{{action}} to {{target}}', {
            action: text(look.word),
            target: `${degrees(thermostat.targetTemperature)}°`,
          })
        : t('dashboard.cards.roomCard.target', 'Target {{target}}', {
            target: `${degrees(thermostat.targetTemperature)}°`,
          });
  const head = (
    <OverviewHead
      icon="armchair"
      chip="bg-primary/14 text-primary"
      title={title}
      subtitle={translate('dashboard.cards.roomCard.devices', {
        count: room.devices,
        defaultValue_one: '{{count}} device',
        defaultValue_other: '{{count}} devices',
      })}
      tail={
        isSquare && look !== null && isWorking(room) ? (
          <Pill className={cn(TONE_CHOSEN[look.tone], 'border-border-strong *:bg-current')}>
            {text(look.word)}
          </Pill>
        ) : undefined
      }
    />
  );
  /**
   * The temperature in large figures, or nothing without a thermometer.
   *
   * @param size - How large.
   * @returns The figure.
   */
  const figure = (size: 26 | 36) =>
    temperature === undefined ? null : (
      <BigValue value={degrees(temperature)} unit={unit} size={size} />
    );
  /**
   * The humidity, with what follows it on its line.
   *
   * @param extra - What follows: the change in the last hour.
   * @returns The line, or nothing when there is neither.
   */
  const humidityLine = (extra: string | null): ReactNode =>
    humidity === undefined && extra === null ? null : (
      <span className="inline-flex items-center gap-[5px] text-caption whitespace-nowrap text-foreground-subtle tabular-nums">
        {humidity === undefined ? null : <AppIcon id="droplet" size={12} />}
        {[humidity === undefined ? null : `${String(Math.round(humidity))}%`, extra]
          .filter((part) => part !== null)
          .join(' · ')}
      </span>
    );

  if (card.h === 1) {
    const marks = rows.filter((row) => row !== 'heating');

    return (
      <CardFrame label={title} glow={isLit ? 'var(--color-primary)' : undefined}>
        {head}
        <div className="grow" />
        <div className="flex min-w-0 items-center justify-between gap-2.5">
          {figure(26) ?? (
            <span className="truncate text-ui-sm text-foreground-muted tabular-nums">
              {whatIsOn(room)}
            </span>
          )}
          <div aria-hidden="true" className="flex shrink-0">
            {marks.map((row, index) => {
              const mark = markOf(row, room);

              return (
                <span
                  key={row}
                  className={cn(
                    'flex size-6 items-center justify-center rounded-full border-2 border-surface bg-surface-raised transition-colors duration-200',
                    index > 0 && '-ml-1.5',
                    mark.isLit ? mark.color : 'text-foreground-subtle',
                  )}
                >
                  <AppIcon id={mark.icon} size={11} />
                </span>
              );
            })}
          </div>
        </div>
      </CardFrame>
    );
  }

  if (!isSquare) {
    return (
      <CardFrame label={title} glow={isLit ? 'var(--color-primary)' : undefined}>
        {head}
        <div className="mt-3.5 flex flex-col gap-1.5">
          {figure(36) ?? (
            <span className="truncate text-ui-sm text-foreground-muted">{whatIsOn(room)}</span>
          )}
          <span className="flex min-w-0 gap-3">
            {humidityLine(null)}
            {heating === null ? null : (
              <span className="truncate text-caption text-foreground-subtle tabular-nums">
                {heating}
              </span>
            )}
          </span>
        </div>
        <div className="grow" />
        <div>
          {rows.slice(0, 2).map((row) => (
            <RoomRow key={row} kind={row} room={room} data={data} group={group} isTall={false} />
          ))}
        </div>
      </CardFrame>
    );
  }

  return (
    <CardFrame label={title} glow={isLit ? 'var(--color-primary)' : undefined}>
      {head}
      <div className="mt-3.5 flex min-h-0 grow">
        <div className="box-border flex w-[170px] shrink-0 flex-col gap-1.5 pr-5">
          {figure(36) ?? <span className="text-ui-sm text-foreground-muted">{whatIsOn(room)}</span>}
          {humidityLine(trend)}
          {history === undefined || points.length < 2 ? null : (
            <div className="mt-auto">
              <AreaLine
                points={points.map((point) => ({ at: point.time.getTime(), value: point.value }))}
                window={history.window}
                color="var(--color-cyan)"
                height={40}
              />
            </div>
          )}
        </div>
        <div className="flex min-w-0 grow flex-col justify-end border-l border-border pl-5">
          {rows.map((row, index) => (
            <RoomRow
              key={row}
              kind={row}
              room={room}
              data={data}
              group={group}
              isTall
              isFirst={index === 0}
            />
          ))}
        </div>
      </div>
    </CardFrame>
  );
}

/**
 * The mark of a group on the 1×1: its glyph, its colour, whether it is on.
 *
 * @param row - The group.
 * @param room - The room.
 * @returns The mark.
 */
function markOf(
  row: RowKind,
  room: Room,
): { readonly icon: UiIconId; readonly color: string; readonly isLit: boolean } {
  const first = {
    lights: room.lights[0],
    blinds: room.blinds[0],
    speaker: room.speaker,
    heating: room.thermostat,
  }[row];

  return {
    icon: ROW_ICONS[row],
    color: first === undefined ? '' : toneText(entityKindOf(first.entity)),
    isLit: {
      lights: room.lights.some((each) => each.state.on_off?.isOn === true),
      blinds: (averagePosition(room.blinds) ?? 0) > 0,
      speaker: room.speaker?.state.media_player?.playback === 'playing',
      heating: isWorking(room),
    }[row],
  };
}

/** What a row of a room needs. */
type RoomRowProps = {
  readonly kind: RowKind;
  readonly room: Room;
  readonly data: DashboardData;
  readonly group: GroupCommand;

  /** 38 px on the 2×2, 34 px on the 1×2. */
  readonly isTall: boolean;

  /** Whether it is the first of the 2×2's rows, drawn without a line above it. */
  readonly isFirst?: boolean;
};

/**
 * Renders one row of a room: its glyph, its name, what its group reads, and its one control.
 *
 * @param props - See {@link RoomRowProps}.
 * @returns The row.
 */
function RoomRow(props: RoomRowProps) {
  const { t } = useTranslation();

  const { kind, room, data, group, isTall, isFirst = false } = props;
  const members: readonly Seen[] = {
    lights: room.lights,
    blinds: room.blinds,
    speaker: room.speaker === undefined ? [] : [room.speaker],
    heating: room.thermostat === undefined ? [] : [room.thermostat],
  }[kind];
  const usable = members.filter((each) => data.canControl(each.entity));
  const reachable = usable.filter((each) => each.isAvailable);
  const ids = reachable.map((each) => each.entity.entityId);
  const reportedAt = Math.max(0, ...members.map((each) => each.reportedAt ?? 0));
  const lightsOn = room.lights.filter((each) => each.isAvailable && each.state.on_off?.isOn);
  const isOut = group.sending === kind;
  const power = usePendingValue(lightsOn.length > 0, reportedAt, isOut);
  const thermostat = room.thermostat?.state.thermostat;
  const target = usePendingValue(thermostat?.targetTemperature ?? 0, reportedAt, isOut);
  const mark = markOf(kind, room);
  const disabled = ids.length === 0 || (group.sending !== null && !isOut);
  const position = averagePosition(room.blinds);
  const player = room.speaker?.state.media_player;
  const isPlaying = player?.playback === 'playing';

  /**
   * Moves the thermostat's target one step.
   *
   * @param direction - Down or up.
   */
  const nudge = (direction: -1 | 1): void => {
    const params =
      room.thermostat === undefined ? null : paramsOf(room.thermostat.entity, 'thermostat');
    const step = params?.temperatureStep ?? 0.5;
    const next = Math.min(
      params?.maxTemperature ?? 35,
      Math.max(
        params?.minTemperature ?? 5,
        Math.round((target.shown + direction * step) / step) * step,
      ),
    );

    target.sent(next);
    group.send(kind, ids, 'thermostat', { command: 'set_target', temperature: next });
  };

  const row = {
    lights: {
      label: t('dashboard.cards.roomCard.lights', 'Lights'),
      value:
        lightsOn.length === 0
          ? t('dashboard.cards.roomCard.allOff', 'All off')
          : t('dashboard.cards.roomCard.someOn', '{{on}} of {{count}} on', {
              on: lightsOn.length,
              count: room.lights.length,
            }),
      control: (
        <Switch
          label={t('dashboard.cards.roomCard.lights', 'Lights')}
          size="small"
          isOn={power.shown}
          isBusy={isOut}
          disabled={disabled}
          onChange={(next) => {
            power.sent(next);
            group.send(kind, ids, 'on_off', powerCommand(next));
          }}
        />
      ),
    },
    blinds: {
      label: t('dashboard.cards.roomCard.blinds', 'Blinds'),
      value:
        position === undefined || position === 0
          ? t('dashboard.cards.roomCard.closed', 'Closed')
          : `${String(position)}%`,
      control: (
        <div className="flex shrink-0 gap-1.5">
          <OverviewRoundButton
            label={t('dashboard.cards.roomCard.open', 'Open')}
            icon="chevron-up"
            disabled={disabled}
            onPress={() => {
              group.send(kind, ids, 'cover', { command: 'open' });
            }}
          />
          <OverviewRoundButton
            label={t('dashboard.cards.roomCard.close', 'Close')}
            icon="chevron-down"
            disabled={disabled}
            onPress={() => {
              group.send(kind, ids, 'cover', { command: 'close' });
            }}
          />
        </div>
      ),
    },
    speaker: {
      label: t('dashboard.cards.roomCard.speaker', 'Speaker'),
      value: player?.mediaTitle ?? t('dashboard.cards.roomCard.nothingPlaying', 'Nothing playing'),
      control: (
        <OverviewRoundButton
          label={
            isPlaying
              ? t('dashboard.cards.roomCard.pause', 'Pause')
              : t('dashboard.cards.roomCard.play', 'Play')
          }
          icon={isPlaying ? 'pause' : 'play'}
          disabled={disabled}
          onPress={() => {
            group.send(kind, ids, 'media_player', { command: isPlaying ? 'pause' : 'play' });
          }}
        />
      ),
    },
    heating: {
      label: t('dashboard.cards.roomCard.heating', 'Heating'),
      value: thermostat === undefined ? '' : `${degrees(target.shown)}°`,
      control: (
        <div className="flex shrink-0 gap-1.5">
          <OverviewRoundButton
            label={t('dashboard.cards.roomCard.lower', 'Lower')}
            icon="minus"
            disabled={disabled}
            onPress={() => {
              nudge(-1);
            }}
          />
          <OverviewRoundButton
            label={t('dashboard.cards.roomCard.raise', 'Raise')}
            icon="plus"
            disabled={disabled}
            onPress={() => {
              nudge(1);
            }}
          />
        </div>
      ),
    },
  }[kind];

  return (
    <div
      className={cn(
        'box-border flex min-w-0 items-center gap-2.5',
        isTall ? 'h-[38px]' : 'h-[34px]',
        !isFirst && 'border-t border-border',
      )}
    >
      <span
        className={cn('inline-flex shrink-0', mark.isLit ? mark.color : 'text-foreground-subtle')}
      >
        <AppIcon id={mark.icon} size={16} />
      </span>
      <span className="text-ui-sm whitespace-nowrap text-foreground">{row.label}</span>
      <span className="min-w-0 grow truncate text-caption text-foreground-subtle">{row.value}</span>
      {usable.length === 0 ? null : row.control}
    </div>
  );
}
