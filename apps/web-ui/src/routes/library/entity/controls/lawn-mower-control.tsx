/**
 * A robot mower: what it is doing, and the four things it can be told - start (or carry on with
 * a paused job), pause, end the job, go back to its station.
 *
 * What it is doing is the headline: a mower out on the lawn is watched, not operated, and the
 * buttons are there for the moment it has to come in. Each is offered only when it means
 * something - a docked mower has nothing to pause or send home - and only when the mower
 * declared it takes it. Ending a job asks first: the mower forgets where it was, and the next
 * start begins the lawn again.
 */
import { useState } from 'react';

import type { LawnMowerActivity } from '@nebula-home/contracts';
import { AppIcon, Button, cn } from '@nebula-home/ui';

import { paramsOf } from '@/library/entity-control';
import { capabilityLabel } from '@/library/entity-kind';
import {
  ControlBlock,
  isBusy,
  type ControlProps,
} from '@/routes/library/entity/controls/control-block';

/** What each activity is called, and how it is drawn. */
const ACTIVITIES: Readonly<
  Record<LawnMowerActivity, { readonly label: string; readonly className: string }>
> = {
  mowing: { label: 'Mowing', className: 'text-success' },
  paused: { label: 'Paused', className: 'text-warning' },
  returning: { label: 'Going back to its station', className: 'text-foreground' },
  docked: { label: 'In its station', className: 'text-foreground' },
  idle: { label: 'Idle', className: 'text-foreground-muted' },
  error: { label: 'Stopped by a fault', className: 'text-danger' },
};

/**
 * Renders the mower control.
 *
 * @param props - See {@link ControlProps}.
 * @returns The block.
 */
export function LawnMowerControl(props: ControlProps) {
  const { entity, state, commander, disabled } = props;
  const params = paramsOf(entity, 'lawn_mower') ?? {
    canPause: true,
    canStop: true,
    canDock: true,
  };
  const activity = state.lawn_mower?.activity;
  const shown = activity === undefined ? undefined : ACTIVITIES[activity];
  const busy = disabled || isBusy(props, 'lawn_mower');
  const [isConfirmingStop, setConfirmingStop] = useState(false);
  const isOut = activity === 'mowing' || activity === 'paused' || activity === 'returning';

  /**
   * Tells the mower one thing.
   *
   * @param command - Which.
   */
  const send = (command: 'start' | 'pause' | 'stop' | 'dock'): void => {
    setConfirmingStop(false);
    commander.send('lawn_mower', { command });
  };

  return (
    <ControlBlock
      title={capabilityLabel('lawn_mower')}
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
          variant={activity === 'mowing' ? 'ghost' : 'primary'}
          disabled={busy || activity === 'mowing'}
          onClick={() => {
            send('start');
          }}
        >
          <AppIcon id="play" size={15} />
          {activity === 'paused' || activity === 'returning' ? 'Resume' : 'Start mowing'}
        </Button>
        {params.canPause ? (
          <Button
            variant="ghost"
            disabled={busy || activity !== 'mowing'}
            onClick={() => {
              send('pause');
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
              send('dock');
            }}
          >
            <AppIcon id="house" size={15} />
            Back to station
          </Button>
        ) : null}
        {params.canStop && isOut ? (
          <Button
            variant={isConfirmingStop ? 'danger' : 'ghost'}
            disabled={busy}
            onClick={() => {
              if (isConfirmingStop) {
                send('stop');
              } else {
                setConfirmingStop(true);
              }
            }}
          >
            <AppIcon id="square" size={15} />
            {isConfirmingStop ? 'End the job?' : 'End job'}
          </Button>
        ) : null}
      </div>
      {isConfirmingStop ? (
        <p role="status" className="text-caption text-foreground-subtle">
          The mower forgets where it got to: the next start mows the lawn from the beginning.
        </p>
      ) : null}
    </ControlBlock>
  );
}
