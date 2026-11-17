/**
 * A robot: a vacuum or a mower - what it is doing, and the few things it is told.
 *
 * What it is doing is the headline: a robot out at work is watched, not operated, and the buttons
 * are there for the moment it has to stop or come in. The tile is the status and two round
 * buttons (or Start, while it sits in its station); the tall card puts the state in large figures,
 * a vacuum's commands as three tiles under it and a mower's lawn as a strip with the mower on it;
 * the square vacuum adds its map's rooms as chips to clean only those.
 *
 * What the robot cannot do is not drawn, and what is left moves up (`K-Capabilities`): no Locate
 * for one that cannot say where it is; without rooms the square shows when the last clean ended
 * and one Start. A robot's battery is an entity of its own on the same device, which the card is
 * not given: it is not drawn here.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { JsonObject, LawnMowerActivity, VacuumActivity } from '@nebulahome/contracts';
import { AppIcon, cn, type UiIconId } from '@nebulahome/ui';

import { translate } from '@/i18n/messages';
import { durationText } from '@/lib/format-time';
import { paramsOf } from '@/library/entity-control';
import {
  BigValue,
  Caption,
  CardHead,
  CommandNote,
  NoAnswer,
} from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import {
  MidValue,
  PillButton,
  RoundButton,
  StatusLine,
  whenText,
} from '@/routes/dashboard/cards/control-parts';
import {
  canUse,
  cardTime,
  sizeKey,
  type EntityCardModel,
} from '@/routes/dashboard/cards/entity-model';

/** What a robot can be doing. */
type Activity = VacuumActivity | LawnMowerActivity;

/** The capability a robot is commanded through. */
type RobotCapability = 'vacuum' | 'lawn_mower';

/** One thing a robot can be told, as a card offers it. */
type RobotAction = {
  readonly label: string;
  readonly icon: UiIconId;
  readonly command: JsonObject;
  readonly disabled: boolean;
};

/** A robot as its card reads it. */
type Robot = {
  readonly activity: Activity | undefined;

  /** Out cleaning or mowing now. */
  readonly isWorking: boolean;

  /** In its station, or not yet heard from: Start is all there is to press. */
  readonly isHome: boolean;

  /** Pause while it works, Start or Resume otherwise; null for one that cannot pause. */
  readonly main: RobotAction | null;

  /** Back to the station, for one that can be sent there. */
  readonly dock: RobotAction | null;

  /** Say where it is, for a vacuum that can. */
  readonly locate: RobotAction | null;
};

/**
 * What an activity is called on a card.
 *
 * @param activity - The activity.
 * @returns "Cleaning", "Docked"…
 */
function activityWord(activity: Activity): string {
  switch (activity) {
    case 'cleaning':
      return translate('dashboard.cards.robot.cleaning', 'Cleaning');
    case 'mowing':
      return translate('dashboard.cards.robot.mowing', 'Mowing');
    case 'paused':
      return translate('dashboard.cards.robot.paused', 'Paused');
    case 'returning':
      return translate('dashboard.cards.robot.returning', 'Returning');
    case 'docked':
      return translate('dashboard.cards.robot.docked', 'Docked');
    case 'idle':
      return translate('dashboard.cards.robot.idle', 'Idle');
    case 'error':
      return translate('dashboard.cards.robot.error', 'Error');
  }
}

/** The colour of each activity's dot. */
const DOTS: Readonly<Record<Activity, string>> = {
  cleaning: 'bg-success',
  mowing: 'bg-success',
  paused: 'bg-warning',
  returning: 'bg-primary',
  docked: 'bg-foreground-subtle',
  idle: 'bg-foreground-subtle',
  error: 'bg-danger',
};

/**
 * Reads a robot off its card: what it is doing, and the commands it takes now.
 *
 * @param model - The card.
 * @param capability - Which robot it is.
 * @returns The robot.
 */
function robotOf(model: EntityCardModel, capability: RobotCapability): Robot {
  const vacuum = capability === 'vacuum' ? paramsOf(model.entity, 'vacuum') : null;
  const params = vacuum ?? paramsOf(model.entity, 'lawn_mower');
  const state = capability === 'vacuum' ? model.state.vacuum : model.state.lawn_mower;
  const activity = state?.activity;
  const isWorking = activity === 'cleaning' || activity === 'mowing';
  // A paused job, or one a fault stopped, is carried on rather than started again.
  const isHeld = activity === 'paused' || (activity === 'error' && state?.isResumable === true);
  const off = !canUse(model, capability);
  const start: RobotAction = {
    label: isHeld
      ? translate('dashboard.cards.robot.resume', 'Resume')
      : translate('dashboard.cards.robot.start', 'Start'),
    icon: 'play',
    command: { command: isHeld && params?.canResume === true ? 'resume' : 'start' },
    disabled: off,
  };
  const pause: RobotAction | null =
    params?.canPause === false
      ? null
      : {
          label: translate('dashboard.cards.robot.pause', 'Pause'),
          icon: 'pause',
          command: { command: 'pause' },
          disabled: off,
        };

  return {
    activity,
    isWorking,
    isHome: activity === undefined || activity === 'docked',
    main: isWorking ? pause : start,
    dock:
      params?.canDock === false
        ? null
        : {
            label: translate('dashboard.cards.robot.dock', 'Dock'),
            icon: 'house',
            command: { command: 'dock' },
            disabled: off || activity === 'docked' || activity === 'returning',
          },
    locate:
      vacuum?.canLocate === true
        ? {
            label: translate('dashboard.cards.robot.locate', 'Locate'),
            icon: 'map-pin',
            command: { command: 'locate' },
            disabled: off,
          }
        : null,
  };
}

/**
 * How long a robot has been at work.
 *
 * @param since - When it set out.
 * @returns "12 min", "1 h 5 min".
 */
function workTime(since: Date): string {
  return durationText(Date.now() - since.getTime());
}

/**
 * The line under a robot's state: how long it has been at work, since when it rests, or when it
 * was last heard from.
 *
 * @param model - The card.
 * @param robot - The robot.
 * @returns The line.
 */
function sinceLine(model: EntityCardModel, robot: Robot): string {
  if (model.isOffline) {
    return model.changedAt === null
      ? translate('dashboard.cards.kit.unreachable', 'Not reachable')
      : translate('dashboard.cards.kit.lastSeen', 'last seen {{time}}', {
          time: cardTime(model.changedAt),
        });
  }

  if (robot.activity === undefined) {
    return translate('dashboard.cards.kit.waitingForDevice', 'Waiting for the device');
  }

  if (model.changedAt === null) {
    return '';
  }

  return robot.isWorking
    ? translate('dashboard.cards.robot.workingFor', '{{time}} in', {
        time: workTime(model.changedAt),
      })
    : translate('dashboard.cards.robot.since', 'since {{time}}', {
        time: cardTime(model.changedAt),
      });
}

/**
 * The robot's state in large figures, or a dash before it has said anything.
 *
 * @param model - The card.
 * @param robot - The robot.
 * @param size - 26 on a vacuum, 24 on a mower.
 * @returns The figure.
 */
function stateFigure(model: EntityCardModel, robot: Robot, size: 24 | 26) {
  if (robot.activity === undefined) {
    return <BigValue value="—" size={22} className="text-foreground-subtle" />;
  }

  const className = model.isOffline
    ? 'text-foreground-subtle'
    : robot.activity === 'error'
      ? 'text-danger'
      : robot.activity === 'mowing'
        ? 'text-success'
        : undefined;

  return size === 24 ? (
    <MidValue value={activityWord(robot.activity)} className={className} />
  ) : (
    <BigValue value={activityWord(robot.activity)} size={26} className={className} />
  );
}

/**
 * Renders the bottom row of a robot's tile: its status, and Start while it rests, Pause and Dock
 * while it is out.
 *
 * @param props - The card and its robot.
 * @param props.model - See {@link EntityCardModel}.
 * @param props.robot - The robot.
 * @param props.capability - What it is commanded through.
 * @returns The row.
 */
function RobotTileRow(props: {
  readonly model: EntityCardModel;
  readonly robot: Robot;
  readonly capability: RobotCapability;
}) {
  const { t } = useTranslation();

  const { model, robot, capability } = props;
  const { command } = model;

  if (command.hasFailed) {
    return <NoAnswer command={command} />;
  }

  const actions = [robot.main, robot.dock].filter((each) => each !== null);
  const start = robot.main;

  return (
    <div className="flex min-w-0 items-center justify-between gap-2.5">
      <CommandNote command={command} sending={t('dashboard.cards.robot.sending', 'Sending…')}>
        <StatusLine
          dot={
            robot.activity === undefined || model.isOffline
              ? 'bg-foreground-subtle'
              : DOTS[robot.activity]
          }
          word={robot.activity === undefined ? '—' : activityWord(robot.activity)}
          detail={robot.isWorking && model.changedAt !== null ? workTime(model.changedAt) : null}
          className={model.isOffline ? 'text-foreground-subtle' : undefined}
        />
      </CommandNote>
      {!model.canControl ? null : robot.isHome && start !== null ? (
        <PillButton
          label={start.label}
          icon={start.icon}
          disabled={start.disabled}
          onPress={() => {
            command.send(capability, start.command);
          }}
        />
      ) : (
        <div className="flex shrink-0 gap-1.5">
          {actions.map((action) => (
            <RoundButton
              key={action.label}
              label={action.label}
              icon={action.icon}
              disabled={action.disabled}
              onPress={() => {
                command.send(capability, action.command);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Renders a robot vacuum's card at its size.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function VacuumCard(props: { readonly model: EntityCardModel }) {
  const { t } = useTranslation();

  const { model } = props;
  const { entity, state, title, command } = model;
  const key = sizeKey(model.size);
  const robot = robotOf(model, 'vacuum');
  const [picked, setPicked] = useState<readonly string[]>([]);
  // The vacuum's chip stays lit, as the boards draw it: the robot is the thing, not its power.
  const head = <CardHead model={model} isActive={null} tail={null} />;
  const sending = t('dashboard.cards.robot.sending', 'Sending…');

  /**
   * Sends a command to the vacuum.
   *
   * @param action - What to send.
   */
  const send = (action: RobotAction): void => {
    command.send('vacuum', action.command);
  };

  if (key === '1x1') {
    return (
      <CardFrame label={title}>
        {head}
        <div className="grow" />
        <RobotTileRow model={model} robot={robot} capability="vacuum" />
      </CardFrame>
    );
  }

  if (key === '1x2') {
    const tiles = [robot.main, robot.dock, robot.locate].filter((each) => each !== null);

    return (
      <CardFrame label={title}>
        {head}
        <div className="mt-3.5 flex flex-col gap-1.5">
          {stateFigure(model, robot, 26)}
          <CommandNote command={command} sending={sending}>
            <Caption>{sinceLine(model, robot)}</Caption>
          </CommandNote>
        </div>
        <div className="grow" />
        {command.hasFailed ? (
          <NoAnswer command={command} />
        ) : model.canControl ? (
          <div className="grid grid-cols-3 gap-1.5">
            {tiles.map((action) => (
              <button
                key={action.label}
                type="button"
                disabled={action.disabled}
                className={cn(
                  'press-scale flex flex-col items-center gap-1 rounded-tile py-2 text-label tracking-normal',
                  'transition-colors duration-200 disabled:cursor-default disabled:opacity-40',
                  action === robot.main
                    ? 'bg-primary text-primary-foreground hover:enabled:bg-primary/90'
                    : 'border border-border-strong bg-surface-raised text-foreground hover:enabled:bg-surface-high',
                )}
                onClick={() => {
                  send(action);
                }}
              >
                <AppIcon id={action.icon} size={16} />
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </CardFrame>
    );
  }

  const rooms = state.vacuum?.rooms ?? [];
  const canPickRooms =
    model.canControl && paramsOf(entity, 'vacuum')?.canCleanRooms === true && rooms.length > 0;
  const chosen = picked.filter((id) => rooms.some((room) => room.id === id));
  const rested = model.changedAt === null ? '—' : whenText(model.changedAt);
  const caption =
    model.isOffline || robot.activity === undefined || !robot.isHome
      ? sinceLine(model, robot)
      : canPickRooms
        ? t('dashboard.cards.robot.lastClean', 'Last clean {{time}}', { time: rested })
        : t('dashboard.cards.robot.readyToClean', 'Ready to clean');
  const main = robot.main;

  return (
    <CardFrame label={title}>
      {head}
      <div className="mt-3.5 flex min-h-0 grow">
        <div className="flex w-[170px] shrink-0 flex-col gap-1.5">
          {stateFigure(model, robot, 26)}
          <CommandNote command={command} sending={sending}>
            <Caption>{caption}</Caption>
          </CommandNote>
          {model.canControl ? (
            <div className="mt-auto flex gap-1.5">
              {main === null ? null : (
                <PillButton
                  label={main.label}
                  icon={main.icon}
                  tone="primary"
                  disabled={main.disabled}
                  onPress={() => {
                    send(main);
                  }}
                />
              )}
              {[robot.isHome ? null : robot.dock, robot.locate]
                .filter((each) => each !== null)
                .map((action) => (
                  <RoundButton
                    key={action.label}
                    label={action.label}
                    icon={action.icon}
                    size={32}
                    disabled={action.disabled}
                    onPress={() => {
                      send(action);
                    }}
                  />
                ))}
            </div>
          ) : null}
        </div>
        <div className="flex min-w-0 grow flex-col gap-2.5 border-l border-border pl-5">
          {canPickRooms ? (
            <>
              <div className="flex min-w-0 items-center justify-between gap-2.5">
                <Caption>{t('dashboard.cards.robot.cleanRooms', 'Clean rooms')}</Caption>
                <Caption className="text-foreground-muted">
                  {t('dashboard.cards.robot.selected', '{{count}} selected', {
                    count: chosen.length,
                  })}
                </Caption>
              </div>
              <div
                role="group"
                aria-label={t('dashboard.cards.robot.rooms', 'Rooms')}
                className="flex min-h-0 flex-wrap gap-1.5 overflow-hidden"
              >
                {rooms.map((room) => {
                  const isPicked = chosen.includes(room.id);

                  return (
                    <button
                      key={room.id}
                      type="button"
                      aria-pressed={isPicked}
                      disabled={!canUse(model, 'vacuum')}
                      className={cn(
                        'inline-flex h-7 items-center gap-1.5 rounded-pill border px-2.5 text-caption',
                        'transition-colors duration-200 disabled:cursor-default disabled:opacity-40',
                        isPicked
                          ? 'border-primary/60 bg-primary/12 text-foreground'
                          : 'border-border-strong text-foreground-muted hover:enabled:text-foreground',
                      )}
                      onClick={() => {
                        setPicked(
                          isPicked
                            ? chosen.filter((each) => each !== room.id)
                            : [...chosen, room.id],
                        );
                      }}
                    >
                      {isPicked ? <AppIcon id="check" size={12} /> : null}
                      {room.name}
                    </button>
                  );
                })}
              </div>
              <div className="mt-auto">
                {command.hasFailed ? (
                  <NoAnswer command={command} />
                ) : (
                  <PillButton
                    label={
                      chosen.length === 0
                        ? t('dashboard.cards.robot.cleanRooms', 'Clean rooms')
                        : t('dashboard.cards.robot.cleanCountRooms', {
                            count: chosen.length,
                            defaultValue_one: 'Clean {{count}} room',
                            defaultValue_other: 'Clean {{count}} rooms',
                          })
                    }
                    icon="sparkles"
                    isWide
                    disabled={chosen.length === 0 || !canUse(model, 'vacuum')}
                    onPress={() => {
                      command.send('vacuum', { command: 'clean_rooms', rooms: [...chosen] });
                      setPicked([]);
                    }}
                  />
                )}
              </div>
            </>
          ) : (
            <>
              <Caption>
                {robot.isWorking
                  ? t('dashboard.cards.robot.thisClean', 'This clean')
                  : t('dashboard.cards.robot.lastCleanTitle', 'Last clean')}
              </Caption>
              <div className="mt-auto">
                {command.hasFailed ? (
                  <NoAnswer command={command} />
                ) : (
                  <div className="flex min-w-0 items-center justify-between gap-2.5 py-[7px]">
                    <Caption className="text-foreground-muted">
                      {robot.isWorking
                        ? t('dashboard.cards.robot.started', 'Started')
                        : t('dashboard.cards.robot.finished', 'Finished')}
                    </Caption>
                    <Caption className="text-foreground">
                      {robot.isHome || robot.isWorking ? rested : '—'}
                    </Caption>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </CardFrame>
  );
}

/**
 * Renders a robot mower's card at its size.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function MowerCard(props: { readonly model: EntityCardModel }) {
  const { t } = useTranslation();

  const { model } = props;
  const { title, command } = model;
  const robot = robotOf(model, 'lawn_mower');
  const glow = robot.isWorking && !model.isOffline ? 'var(--color-success)' : undefined;
  const head = <CardHead model={model} isActive={robot.isWorking} tail={null} />;

  if (sizeKey(model.size) === '1x1') {
    return (
      <CardFrame label={title} glow={glow}>
        {head}
        <div className="grow" />
        <RobotTileRow model={model} robot={robot} capability="lawn_mower" />
      </CardFrame>
    );
  }

  const buttons = [robot.main, robot.dock].filter((each) => each !== null);

  return (
    <CardFrame label={title} glow={glow}>
      {head}
      <div className="mt-3 flex flex-col gap-1.5">
        <div className="flex min-w-0 items-baseline justify-between gap-2.5">
          {stateFigure(model, robot, 24)}
          <CommandNote command={command} sending={t('dashboard.cards.robot.sending', 'Sending…')}>
            <Caption>{sinceLine(model, robot)}</Caption>
          </CommandNote>
        </div>
        {/* The lawn, with the mower on it - out on the grass, or at its station at the left. */}
        <div
          aria-hidden="true"
          className="relative h-[58px] overflow-hidden rounded-field bg-[repeating-linear-gradient(90deg,color-mix(in_srgb,var(--color-success)_18%,var(--color-surface))_0_18px,color-mix(in_srgb,var(--color-success)_23%,var(--color-surface))_18px_36px)]"
        >
          <span
            className={cn(
              'absolute top-[18px] flex size-[22px] items-center justify-center rounded-[6px] bg-foreground text-surface transition-[left] duration-300 ease-out',
              robot.isHome || robot.activity === 'returning' ? 'left-1.5' : 'left-[calc(50%-11px)]',
            )}
          >
            <AppIcon id="tractor" size={13} />
          </span>
        </div>
      </div>
      <div className="grow" />
      {command.hasFailed ? (
        <NoAnswer command={command} />
      ) : model.canControl ? (
        <div className="flex gap-1.5">
          {buttons.map((action) => (
            <PillButton
              key={action.label}
              label={action.label}
              icon={action.icon}
              isWide
              disabled={action.disabled}
              onPress={() => {
                command.send('lawn_mower', action.command);
              }}
            />
          ))}
        </div>
      ) : null}
    </CardFrame>
  );
}
