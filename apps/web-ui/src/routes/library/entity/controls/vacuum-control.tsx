/**
 * A robot vacuum: what it is doing, the things it can be told - start (or carry on), pause, end
 * the job, go back to its station, say where it is - and, for one with a map, which rooms to clean.
 *
 * The rooms are chips: picked, **Clean these rooms** sends only those, the rest of the house left
 * alone. They are the map's own - named in the app - so they change when the map is edited there,
 * and are read from the robot's state rather than fixed in its bundle. Each command is offered
 * only when the robot declared it takes it, and only when it means something now.
 *
 * A robot a fault stopped in the middle of a job still holds it: once the fault is seen to, one
 * that takes a resume of its own (`canResume`) is offered **Resume** rather than a clean, which
 * would start the house again.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { VacuumActivity } from '@nebulahome/contracts';
import { AppIcon, Button, cn } from '@nebulahome/ui';

import { defineMessage, type Message, text } from '@/i18n/messages';
import { paramsOf } from '@/library/entity-control';
import { capabilityLabel } from '@/library/entity-kind';
import {
  ControlBlock,
  isBusy,
  type ControlProps,
} from '@/routes/library/entity/controls/control-block';

/** What each activity is called, and how it is drawn. */
const ACTIVITIES: Readonly<
  Record<VacuumActivity, { readonly label: Message; readonly className: string }>
> = {
  cleaning: {
    label: defineMessage('entity.controls.vacuumControl.cleaning', 'Cleaning'),
    className: 'text-success',
  },
  paused: {
    label: defineMessage('entity.controls.vacuumControl.paused', 'Paused'),
    className: 'text-warning',
  },
  returning: {
    label: defineMessage(
      'entity.controls.vacuumControl.goingBackToIts',
      'Going back to its station',
    ),
    className: 'text-foreground',
  },
  docked: {
    label: defineMessage('entity.controls.vacuumControl.inItsStation', 'In its station'),
    className: 'text-foreground',
  },
  idle: {
    label: defineMessage('entity.controls.vacuumControl.idle', 'Idle'),
    className: 'text-foreground-muted',
  },
  error: {
    label: defineMessage('entity.controls.vacuumControl.stoppedByAFault', 'Stopped by a fault'),
    className: 'text-danger',
  },
};

/**
 * Renders the vacuum control.
 *
 * @param props - See {@link ControlProps}.
 * @returns The block.
 */
export function VacuumControl(props: ControlProps) {
  const { t } = useTranslation();

  const { entity, state, commander, disabled } = props;
  const params = paramsOf(entity, 'vacuum') ?? {
    canPause: true,
    canStop: true,
    canDock: true,
    canLocate: false,
    canCleanRooms: false,
    canResume: false,
  };
  const activity = state.vacuum?.activity;
  const rooms = state.vacuum?.rooms ?? [];
  const shown = activity === undefined ? undefined : ACTIVITIES[activity];
  const busy = disabled || isBusy(props, 'vacuum');
  const [picked, setPicked] = useState<readonly string[]>([]);
  const isHeldByFault =
    activity === 'error' && params.canResume && state.vacuum?.isResumable === true;
  const isResuming = activity === 'paused' || isHeldByFault;
  const isOut =
    activity === 'cleaning' || activity === 'paused' || activity === 'returning' || isHeldByFault;

  /**
   * Picks a room, or lets it go.
   *
   * @param id - The room.
   */
  const toggleRoom = (id: string): void => {
    setPicked((current) =>
      current.includes(id) ? current.filter((each) => each !== id) : [...current, id],
    );
  };

  return (
    <ControlBlock
      title={capabilityLabel('vacuum')}
      value={
        shown === undefined ? (
          '—'
        ) : (
          <span className={cn('inline-flex items-center gap-1.5', shown.className)}>
            {activity === 'error' ? <AppIcon id="triangle-alert" size={14} /> : null}
            {text(shown.label)}
          </span>
        )
      }
    >
      <div className="flex flex-wrap gap-2">
        <Button
          variant={activity === 'cleaning' ? 'ghost' : 'primary'}
          disabled={busy || activity === 'cleaning'}
          onClick={() => {
            // A robot without a resume of its own carries a paused job on when started.
            commander.send('vacuum', {
              command: isResuming && params.canResume ? 'resume' : 'start',
            });
          }}
        >
          <AppIcon id="play" size={15} />
          {isResuming
            ? t('entity.controls.vacuumControl.resume', 'Resume')
            : t('entity.controls.vacuumControl.cleanEverywhere', 'Clean everywhere')}
        </Button>
        {params.canPause ? (
          <Button
            variant="ghost"
            disabled={busy || activity !== 'cleaning'}
            onClick={() => {
              commander.send('vacuum', { command: 'pause' });
            }}
          >
            <AppIcon id="pause" size={15} />
            {t('entity.controls.vacuumControl.pause', 'Pause')}
          </Button>
        ) : null}
        {params.canDock ? (
          <Button
            variant="ghost"
            disabled={busy || activity === 'docked' || activity === 'returning'}
            onClick={() => {
              commander.send('vacuum', { command: 'dock' });
            }}
          >
            <AppIcon id="house" size={15} />
            {t('entity.controls.vacuumControl.backToStation', 'Back to station')}
          </Button>
        ) : null}
        {params.canStop && isOut ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              commander.send('vacuum', { command: 'stop' });
            }}
          >
            <AppIcon id="square" size={15} />
            {t('entity.controls.vacuumControl.endJob', 'End job')}
          </Button>
        ) : null}
        {params.canLocate ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              commander.send('vacuum', { command: 'locate' });
            }}
          >
            <AppIcon id="rss" size={15} />
            {t('entity.controls.vacuumControl.whereAreYou', 'Where are you?')}
          </Button>
        ) : null}
      </div>

      {params.canCleanRooms && rooms.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          <p className="text-caption text-foreground-subtle">
            {t('entity.controls.vacuumControl.orOnlySomeRooms', 'Or only some rooms:')}
          </p>
          <div
            role="group"
            aria-label={t('entity.controls.vacuumControl.rooms', 'Rooms')}
            className="flex flex-wrap gap-1.5"
          >
            {rooms.map((room) => {
              const isPicked = picked.includes(room.id);

              return (
                <button
                  key={room.id}
                  type="button"
                  aria-pressed={isPicked}
                  disabled={busy}
                  className={cn(
                    'press h-control-sm rounded-full border px-3 text-ui transition-colors',
                    isPicked
                      ? 'border-primary/50 bg-primary/13 text-primary'
                      : 'border-border-strong bg-surface-raised text-foreground',
                  )}
                  onClick={() => {
                    toggleRoom(room.id);
                  }}
                >
                  {room.name}
                </button>
              );
            })}
          </div>
          <Button
            className="self-start"
            disabled={busy || picked.length === 0}
            onClick={() => {
              commander.send('vacuum', { command: 'clean_rooms', rooms: [...picked] });
              setPicked([]);
            }}
          >
            {picked.length <= 1
              ? t('entity.controls.vacuumControl.cleanThisRoom', 'Clean this room')
              : t(
                  'entity.controls.vacuumControl.cleanTheseCountRooms',
                  'Clean these {{count}} rooms',
                  { count: picked.length },
                )}
          </Button>
        </div>
      ) : null}
    </ControlBlock>
  );
}
