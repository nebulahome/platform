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

import type { VacuumActivity } from '@nebulahome/contracts';
import { AppIcon, Button, cn } from '@nebulahome/ui';

import { paramsOf } from '@/library/entity-control';
import { capabilityLabel } from '@/library/entity-kind';
import {
  ControlBlock,
  isBusy,
  type ControlProps,
} from '@/routes/library/entity/controls/control-block';

/** What each activity is called, and how it is drawn. */
const ACTIVITIES: Readonly<
  Record<VacuumActivity, { readonly label: string; readonly className: string }>
> = {
  cleaning: { label: 'Cleaning', className: 'text-success' },
  paused: { label: 'Paused', className: 'text-warning' },
  returning: { label: 'Going back to its station', className: 'text-foreground' },
  docked: { label: 'In its station', className: 'text-foreground' },
  idle: { label: 'Idle', className: 'text-foreground-muted' },
  error: { label: 'Stopped by a fault', className: 'text-danger' },
};

/**
 * Renders the vacuum control.
 *
 * @param props - See {@link ControlProps}.
 * @returns The block.
 */
export function VacuumControl(props: ControlProps) {
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
            {shown.label}
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
          {isResuming ? 'Resume' : 'Clean everywhere'}
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
            Pause
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
            Back to station
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
            End job
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
            Where are you?
          </Button>
        ) : null}
      </div>

      {params.canCleanRooms && rooms.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          <p className="text-caption text-foreground-subtle">Or only some rooms:</p>
          <div role="group" aria-label="Rooms" className="flex flex-wrap gap-1.5">
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
            {picked.length <= 1 ? 'Clean this room' : `Clean these ${String(picked.length)} rooms`}
          </Button>
        </div>
      ) : null}
    </ControlBlock>
  );
}
