/**
 * A robot vacuum and a robot mower, as the canvas draws them (`N-Entity-Modal-Vacuum`,
 * `N-Entity-Vacuum-More`, `N-Entity-Modal-Vacuum-Areas`, `N-Entity-Modal-Mower`,
 * `N-Entity-Mower-More`). Both are built from the commands they take:
 *
 * - a picture: the vacuum's map, its rooms to tap in the order they should be cleaned; the
 *   mower's garden, the mower where its activity puts it;
 * - the battery ring (from the device's battery sensor) or its glyph, the activity and since;
 * - one main button - Start, Clean 2 rooms, Pause, Start again - and round ones beside it: Stop,
 *   Dock, Locate, a spot clean;
 * - for a vacuum, its clean mode, suction and water as their lists say.
 *
 * An error is said in red over all of it.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { JsonObject, VacuumRoom } from '@nebulahome/contracts';
import { AppIcon, cn, type UiIconId } from '@nebulahome/ui';

import { defineMessage, text, type Message } from '@/i18n/messages';
import { paramsOf } from '@/library/entity-control';
import { clockText } from '@/routes/library/entity/sheet/history';
import { OptionList } from '@/routes/library/entity/sheet/parts/option-list';
import {
  BatteryRing,
  BlockHead,
  LevelSteps,
  RoundAction,
  useSinceLine,
} from '@/routes/library/entity/sheet/parts/sheet-controls';
import { SendingSpinner } from '@/routes/library/entity/sheet/parts/sheet-parts';
import type { SheetBodyProps } from '@/routes/library/entity/sheet/sheet-types';
import type { SheetTone } from '@/routes/library/entity/sheet/tones';

/** The words of a robot's activities. */
const ACTIVITIES: Readonly<Record<string, Message>> = {
  cleaning: defineMessage('entity.sheet.robot.cleaning', 'Cleaning'),
  mowing: defineMessage('entity.sheet.robot.mowing', 'Mowing'),
  paused: defineMessage('entity.sheet.robot.paused', 'Paused'),
  returning: defineMessage('entity.sheet.robot.returning', 'Returning'),
  docked: defineMessage('entity.sheet.robot.docked', 'Docked'),
  idle: defineMessage('entity.sheet.robot.idle', 'Idle'),
  error: defineMessage('entity.sheet.robot.error', 'Error'),
};

/** The words of a vacuum's clean modes. */
const CLEAN_MODES: Readonly<Record<string, Message>> = {
  vacuum: defineMessage('entity.sheet.robot.vacuum', 'Vacuum'),
  mop: defineMessage('entity.sheet.robot.mop', 'Mop'),
  vacuum_and_mop: defineMessage('entity.sheet.robot.both', 'Both'),
};

/** The main button's look: filled in the robot's colour. */
const MAIN_FILL: Readonly<Partial<Record<SheetTone, string>>> = {
  cyan: 'bg-cyan text-canvas shadow-[0_10px_28px_-14px_color-mix(in_oklab,var(--color-cyan)_90%,transparent)]',
  success:
    'bg-success text-canvas shadow-[0_10px_28px_-14px_color-mix(in_oklab,var(--color-success)_90%,transparent)]',
};

/** One round button beside the main one. */
type RoundSpec = {
  readonly key: string;
  readonly icon: UiIconId;
  readonly label: string;
  readonly command: string;
  readonly disabled?: boolean;
};

/** What the shared part of a robot's body needs. */
type RobotFrameProps = {
  /** The body's props. */
  readonly body: SheetBodyProps;

  /** The robot's colour. */
  readonly tone: SheetTone;

  /** Its glyph, for a robot without a battery reading. */
  readonly icon: UiIconId;

  /** Its activity. */
  readonly activity: string;

  /** The line under the activity. */
  readonly line: string;

  /** The main button's glyph, words and action; filled unless said otherwise. */
  readonly main: { icon: UiIconId; label: string; command: string; isFilled: boolean };

  /** Sends a button's command. */
  readonly onCommand: (command: string) => void;

  /** The round buttons beside it. */
  readonly rounds: readonly RoundSpec[];

  /** Whether a command is on its way. */
  readonly isSending: boolean;
};

/**
 * The status and the buttons both robots share.
 *
 * @param props - See {@link RobotFrameProps}.
 * @returns The status row and the button row.
 */
function RobotStatus(props: RobotFrameProps) {
  const { t } = useTranslation();
  const { body, tone, icon, activity, line, main, rounds, isSending } = props;

  return (
    <>
      {activity === 'error' ? (
        <div className="flex items-center gap-3 rounded-inner border border-danger/40 bg-danger/8 px-3.5 py-3 text-danger">
          <AppIcon id="octagon-alert" size={18} />
          <span className="text-ui-sm leading-[1.45] text-foreground-muted">
            {t('entity.sheet.robot.errorAt', 'Error reported at {{time}}.', {
              time: clockText(body.entity.lastChanged?.getTime() ?? body.now),
            })}
          </span>
        </div>
      ) : null}
      <div className="flex items-center gap-4">
        <BatteryRing level={body.battery} tone={tone} icon={icon} />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-2 text-[22px] font-medium tracking-[-0.02em]">
            {text(
              ACTIVITIES[activity] ??
                ACTIVITIES['idle'] ??
                defineMessage('entity.sheet.robot.idle', 'Idle'),
            )}
            {isSending ? <SendingSpinner tone={tone} size={18} /> : null}
          </span>
          <span className="text-ui-sm text-foreground-subtle">{line}</span>
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          disabled={body.disabled}
          onClick={() => {
            props.onCommand(main.command);
          }}
          className={cn(
            'inline-flex h-13 min-w-0 flex-1 cursor-pointer items-center justify-center gap-2.25 rounded-card px-4.5 text-title font-medium',
            'disabled:cursor-not-allowed disabled:opacity-50',
            main.isFilled
              ? MAIN_FILL[tone]
              : 'border border-border-strong bg-surface-raised text-foreground',
          )}
        >
          <AppIcon id={main.icon} size={18} />
          <span className="truncate">{main.label}</span>
        </button>
        {rounds.map((round) => (
          <RoundAction
            key={round.key}
            icon={round.icon}
            label={round.label}
            disabled={body.disabled || round.disabled === true}
            onClick={() => {
              props.onCommand(round.command);
            }}
          />
        ))}
      </div>
    </>
  );
}

/**
 * Lays rooms out on the map: from their outlines when the robot shares them, otherwise in a
 * grid, so a map always has its rooms to tap.
 *
 * @param rooms - The rooms.
 * @returns Each room's box, in percent of the map.
 */
function roomBoxes(
  rooms: readonly VacuumRoom[],
): { room: VacuumRoom; left: number; top: number; width: number; height: number }[] {
  const columns =
    rooms.length <= 2 ? rooms.length : rooms.length <= 4 ? 2 : rooms.length <= 9 ? 3 : 4;
  const rows = Math.ceil(rooms.length / Math.max(1, columns));

  return rooms.map((room, index) => {
    if (room.outline !== undefined) {
      const xs = room.outline.map(([x]) => x);
      const ys = room.outline.map(([, y]) => y);
      const left = Math.min(...xs);
      const top = Math.min(...ys);

      return { room, left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
    }

    const column = index % columns;
    const row = Math.floor(index / columns);

    return {
      room,
      left: (column / columns) * 100,
      top: (row / rows) * 100,
      width: 100 / columns,
      height: 100 / rows,
    };
  });
}

/** What the map needs. */
type RoomMapProps = {
  readonly rooms: readonly VacuumRoom[];
  readonly picked: readonly string[];
  readonly onToggle: (id: string) => void;
  readonly isCleaning: boolean;
  readonly disabled: boolean;
};

/**
 * The vacuum's map: its rooms, those picked lit and numbered in the order they will be cleaned,
 * the dock and the robot.
 *
 * @param props - See {@link RoomMapProps}.
 * @returns The map.
 */
function RoomMap(props: RoomMapProps) {
  const { t } = useTranslation();
  const { rooms, picked, onToggle, isCleaning, disabled } = props;

  return (
    <div
      role="group"
      aria-label={t('entity.sheet.robot.mapLabel', 'Map, tap rooms to pick them')}
      className="relative h-47.5 overflow-hidden rounded-card border border-border-strong bg-[radial-gradient(120%_90%_at_50%_0%,#10142a,#0a0c17)]"
    >
      <div className="absolute inset-2">
        {roomBoxes(rooms).map(({ room, left, top, width, height }) => {
          const order = picked.indexOf(room.id);
          const isPicked = order >= 0;

          return (
            <button
              key={room.id}
              type="button"
              aria-pressed={isPicked}
              aria-label={room.name}
              disabled={disabled}
              onClick={() => {
                onToggle(room.id);
              }}
              className={cn(
                'absolute cursor-pointer rounded-chip border p-0 text-left',
                isPicked ? 'border-cyan/60 bg-cyan/16' : 'border-[#20243c] bg-[#121528]',
              )}
              // eslint-disable-next-line react/forbid-dom-props -- each room where the map has it, a gap between
              style={{
                left: `calc(${String(left)}% + 3px)`,
                top: `calc(${String(top)}% + 3px)`,
                width: `calc(${String(width)}% - 6px)`,
                height: `calc(${String(height)}% - 6px)`,
              }}
            >
              <span
                className={cn(
                  'absolute top-1.5 left-2 max-w-[calc(100%-16px)] truncate text-[11px]',
                  isPicked ? 'text-foreground' : 'text-foreground-subtle',
                )}
              >
                {room.name}
              </span>
              {isPicked ? (
                <span className="absolute right-1.5 bottom-1.5 flex size-4.5 items-center justify-center rounded-full bg-cyan font-mono text-[10px] font-semibold text-canvas">
                  {order + 1}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <span
        title={t('entity.sheet.robot.dock', 'Dock')}
        className="absolute right-4 bottom-2.5 h-2 w-4.5 rounded-[3px] bg-success"
      />
      <span
        title={t('entity.sheet.robot.robot', 'Robot')}
        className={cn(
          'absolute right-4 size-4.5 rounded-full border-3 border-surface bg-cyan shadow-[0_0_0_1px_var(--color-cyan)]',
          isCleaning ? 'top-14' : 'bottom-4.5',
        )}
      />
    </div>
  );
}

/**
 * The body of a robot vacuum.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
export function VacuumBody(props: SheetBodyProps) {
  const { t } = useTranslation();
  const { entity, state, commander, disabled, history, battery } = props;
  const since = useSinceLine(entity, history);
  const params = paramsOf(entity, 'vacuum');
  const [picked, setPicked] = useState<readonly string[]>([]);
  const vacuum = state.vacuum;

  if (vacuum === undefined || params === null) {
    return null;
  }

  const activity = vacuum.activity;
  const isWorking = activity === 'cleaning';
  const rooms = params.canCleanRooms ? vacuum.rooms : [];
  const names = picked
    .map((id) => rooms.find((room) => room.id === id)?.name)
    .filter((name): name is string => name !== undefined);

  /**
   * Sends one of the vacuum's commands.
   *
   * @param command - The command, with what it takes.
   */
  const send = (command: JsonObject): void => {
    commander.send('vacuum', command);
  };

  /**
   * Sends a button's command: the rooms picked go with a clean of rooms, and are let go of.
   *
   * @param command - The command's name.
   */
  const onCommand = (command: string): void => {
    if (command === 'clean_rooms') {
      send({ command, rooms: [...picked] });
      setPicked([]);
    } else {
      send({ command });
    }
  };

  const main = isWorking
    ? params.canPause
      ? {
          icon: 'pause' as const,
          label: t('entity.sheet.robot.pause', 'Pause'),
          command: 'pause',
          isFilled: true,
        }
      : {
          icon: 'square' as const,
          label: t('entity.sheet.robot.stop', 'Stop'),
          command: 'stop',
          isFilled: true,
        }
    : {
        icon: 'play' as const,
        label:
          activity === 'error'
            ? t('entity.sheet.robot.startAgain', 'Start again')
            : activity === 'paused' && vacuum.isResumable && params.canResume
              ? t('entity.sheet.robot.resume', 'Resume')
              : names.length === 1
                ? t('entity.sheet.robot.cleanRoom', 'Clean {{room}}', { room: names[0] })
                : names.length > 1
                  ? t('entity.sheet.robot.cleanRooms', 'Clean {{count}} rooms', {
                      count: names.length,
                    })
                  : t('entity.sheet.robot.start', 'Start'),
        command:
          picked.length > 0
            ? 'clean_rooms'
            : activity === 'paused' && vacuum.isResumable && params.canResume
              ? 'resume'
              : 'start',
        isFilled: true,
      };
  const rounds: RoundSpec[] = [
    ...(params.canStop && !params.canDock
      ? [
          {
            key: 'stop',
            icon: 'square' as const,
            label: t('entity.sheet.robot.stop', 'Stop'),
            command: 'stop',
            disabled: !isWorking,
          },
        ]
      : []),
    ...(activity === 'returning' && params.canPause
      ? [
          {
            key: 'pause',
            icon: 'pause' as const,
            label: t('entity.sheet.robot.pause', 'Pause'),
            command: 'pause',
          },
        ]
      : []),
    ...(params.canDock && activity !== 'returning'
      ? [
          {
            key: 'dock',
            icon: 'house' as const,
            label:
              activity === 'error'
                ? t('entity.sheet.robot.returnToDock', 'Return to dock')
                : t('entity.sheet.robot.dock', 'Dock'),
            command: 'dock',
            disabled: activity === 'docked',
          },
        ]
      : []),
    ...(params.canCleanSpot
      ? [
          {
            key: 'spot',
            icon: 'crosshair' as const,
            label: t('entity.sheet.robot.spot', 'Clean a spot'),
            command: 'clean_spot',
          },
        ]
      : []),
    ...(params.canLocate
      ? [
          {
            key: 'locate',
            icon: 'locate-fixed' as const,
            label: t('entity.sheet.robot.locate', 'Locate'),
            command: 'locate',
          },
        ]
      : []),
  ];
  const line =
    activity === 'returning'
      ? t('entity.sheet.robot.goingBack', 'Going back to charge')
      : activity === 'docked' && battery !== null
        ? battery >= 100
          ? t('entity.sheet.robot.charged', 'Charged')
          : t('entity.sheet.robot.charging', 'Charging')
        : activity === 'error' && battery !== null
          ? t('entity.sheet.robot.sinceBattery', '{{since}} · battery {{battery}}%', {
              since,
              battery: Math.round(battery),
            })
          : since;

  return (
    <div className="flex grow flex-col justify-center gap-5">
      {rooms.length === 0 ? null : (
        <>
          <RoomMap
            rooms={rooms}
            picked={picked}
            isCleaning={isWorking}
            disabled={disabled || isWorking}
            onToggle={(id) => {
              setPicked(
                picked.includes(id) ? picked.filter((each) => each !== id) : [...picked, id],
              );
            }}
          />
          <div className="-mt-2 flex items-center justify-between gap-3">
            <span className="truncate text-ui-sm text-foreground-muted">
              {names.length === 0
                ? t('entity.sheet.robot.wholeHome', 'Whole home')
                : names.join(t('entity.sheet.robot.then', ', then '))}
            </span>
            {names.length === 0 ? (
              <span className="shrink-0 text-caption text-foreground-subtle">
                {t('entity.sheet.robot.nonePicked', 'None picked = whole home')}
              </span>
            ) : (
              <button
                type="button"
                className="shrink-0 cursor-pointer text-caption text-foreground-muted"
                onClick={() => {
                  setPicked([]);
                }}
              >
                {t('entity.sheet.robot.clear', 'Clear')}
              </button>
            )}
          </div>
        </>
      )}

      <RobotStatus
        body={props}
        tone="cyan"
        icon="circle-dot"
        activity={activity}
        line={line}
        main={main}
        rounds={rounds}
        isSending={commander.busy.has('vacuum')}
        onCommand={onCommand}
      />

      {params.cleanModes.length === 0 ? null : (
        <div className="flex flex-col gap-2.5">
          <BlockHead title={t('entity.sheet.robot.mode', 'Mode')} />
          <OptionList
            title={t('entity.sheet.robot.mode', 'Mode')}
            options={params.cleanModes.map((value) => ({
              value,
              label: text(
                CLEAN_MODES[value] ??
                  CLEAN_MODES['vacuum'] ??
                  defineMessage('entity.sheet.robot.vacuum', 'Vacuum'),
              ),
            }))}
            value={vacuum.cleanMode ?? null}
            tone="cyan"
            hasIcons={false}
            isTinted
            disabled={disabled}
            onPick={(cleanMode) => {
              send({ command: 'set_clean_mode', cleanMode });
            }}
          />
        </div>
      )}

      {(
        [
          ['fanSpeeds', 'fanSpeed', 'set_fan_speed', t('entity.sheet.robot.suction', 'Suction')],
          ['waterLevels', 'waterLevel', 'set_water_level', t('entity.sheet.robot.water', 'Water')],
        ] as const
      ).map(([list, field, command, title]) =>
        params[list].length === 0 ? null : (
          <div key={list} className="flex flex-col gap-2.5">
            <BlockHead
              title={title}
              {...(params[list].length > 10 && vacuum[field] !== undefined
                ? {
                    aside: t('entity.sheet.robot.ofCount', '{{step}} of {{count}}', {
                      step: params[list].indexOf(vacuum[field] ?? '') + 1,
                      count: params[list].length,
                    }),
                  }
                : {})}
            />
            <LevelSteps
              title={title}
              levels={params[list].map((value) => ({ value, label: value }))}
              value={vacuum[field] ?? null}
              tone="cyan"
              disabled={disabled}
              onPick={(value) => {
                send({ command, [field]: value });
              }}
            />
          </div>
        ),
      )}
    </div>
  );
}

/** Where the mower sits in the garden, by what it is doing. */
const MOWER_SPOTS: Readonly<Record<string, string>> = {
  mowing: 'top-20.25 left-46.25',
  paused: 'top-20.25 left-46.25',
  error: 'top-20.25 left-46.25',
  idle: 'top-20.25 left-46.25',
  returning: 'top-27.5 left-24',
  docked: 'top-39.25 left-5.75',
};

/**
 * The body of a robot mower.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
export function MowerBody(props: SheetBodyProps) {
  const { t } = useTranslation();
  const { entity, state, commander, history, battery } = props;
  const since = useSinceLine(entity, history);
  const params = paramsOf(entity, 'lawn_mower');
  const mower = state.lawn_mower;

  if (mower === undefined || params === null) {
    return null;
  }

  const activity = mower.activity;
  const isWorking = activity === 'mowing';

  /**
   * Sends one of the mower's commands.
   *
   * @param command - The command.
   */
  const send = (command: string): void => {
    commander.send('lawn_mower', { command });
  };

  const main =
    isWorking && params.canPause
      ? {
          icon: 'pause' as const,
          label: t('entity.sheet.robot.pause', 'Pause'),
          command: 'pause',
          isFilled: true,
        }
      : {
          icon: 'play' as const,
          label:
            activity === 'paused' && mower.isResumable && params.canResume
              ? t('entity.sheet.robot.resume', 'Resume')
              : isWorking
                ? t('entity.sheet.robot.start', 'Start')
                : t('entity.sheet.robot.startMowing', 'Start mowing'),
          command:
            activity === 'paused' && mower.isResumable && params.canResume ? 'resume' : 'start',
          // A mower already out mowing with no pause has nothing better to offer than Start.
          isFilled: !isWorking,
        };
  const rounds: RoundSpec[] = params.canDock
    ? [
        {
          key: 'dock',
          icon: 'house',
          label: t('entity.sheet.robot.dock', 'Dock'),
          command: 'dock',
          disabled: activity === 'docked',
        },
      ]
    : [];
  const line =
    activity === 'returning'
      ? t('entity.sheet.robot.goingBack', 'Going back to charge')
      : activity === 'docked' && battery !== null
        ? battery >= 100
          ? t('entity.sheet.robot.charged', 'Charged')
          : t('entity.sheet.robot.charging', 'Charging')
        : since;

  return (
    <div className="flex grow flex-col justify-center gap-5">
      <div
        aria-hidden="true"
        className="relative h-44 overflow-hidden rounded-card bg-[repeating-linear-gradient(90deg,#2f8a55_0_22px,#297a4b_22px_44px)] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]"
      >
        {isWorking || activity === 'paused' ? (
          <span className="absolute inset-y-0 left-0 w-[54%] bg-[repeating-linear-gradient(90deg,#36985f_0_22px,#2e8653_22px_44px)]" />
        ) : null}
        <span className="absolute top-0 right-0 h-13.5 w-21 rounded-bl-card bg-[#2a2f55]" />
        <span className="absolute top-5.5 left-5.5 size-10 rounded-full bg-[radial-gradient(circle_at_35%_35%,#3fa06a,#1f5e3b)]" />
        <span className="absolute right-9 bottom-6.5 size-7.5 rounded-full bg-[radial-gradient(circle_at_35%_35%,#3fa06a,#1f5e3b)]" />
        <span className="absolute bottom-3 left-3.5 h-5 rounded-[6px] bg-canvas/60 pr-2 pl-7.5 text-[11px] leading-5 text-foreground-muted">
          {t('entity.sheet.robot.dock', 'Dock')}
        </span>
        <span
          className={cn(
            'absolute size-5.5 rounded-[7px] border-3 bg-[#f2f3ff] transition-[top,left] duration-700',
            activity === 'error'
              ? 'border-danger shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-danger)_30%,transparent)]'
              : 'border-success shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-success)_30%,transparent)]',
            MOWER_SPOTS[activity],
          )}
        />
      </div>
      <RobotStatus
        body={props}
        tone="success"
        icon="sprout"
        activity={activity}
        line={line}
        main={main}
        rounds={rounds}
        isSending={commander.busy.has('lawn_mower')}
        onCommand={send}
      />
    </div>
  );
}
