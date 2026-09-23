/**
 * A lock: locked, unlocked, or jammed.
 *
 * Jammed is a state of its own and is shown as a warning, because a bolt that failed to throw is
 * a fact about the front door, not a hiccup to retry quietly. A lock that wants a code gets a
 * field for it; the code is sent with the command and kept nowhere, and the field empties once
 * it has gone.
 */
import { useState } from 'react';

import { AppIcon, Button, cn, TextField } from '@nebula-home/ui';

import { paramsOf } from '@/library/entity-control';
import {
  ControlBlock,
  isBusy,
  type ControlProps,
} from '@/routes/library/entity/controls/control-block';

/** The words for each bolt position. */
const STATES = {
  locked: { label: 'Locked', icon: 'lock', className: 'text-foreground' },
  unlocked: { label: 'Unlocked', icon: 'lock-open', className: 'text-warning' },
  jammed: { label: 'Jammed', icon: 'triangle-alert', className: 'text-danger' },
} as const;

/**
 * Renders the lock control.
 *
 * @param props - See {@link ControlProps}.
 * @returns The block.
 */
export function LockControl(props: ControlProps) {
  const { entity, state, commander, disabled } = props;
  const [code, setCode] = useState('');
  const hasCode = paramsOf(entity, 'lock')?.hasCode === true;
  const shown = STATES[state.lock?.lockState ?? 'locked'];
  const busy = isBusy(props, 'lock');

  /**
   * Throws or draws the bolt.
   *
   * @param command - Which.
   */
  const send = (command: 'lock' | 'unlock'): void => {
    commander.send('lock', { command, ...(hasCode && code !== '' ? { code } : {}) });
    setCode('');
  };

  return (
    <ControlBlock
      title="Lock"
      value={
        state.lock === undefined ? (
          '—'
        ) : (
          <span className={cn('inline-flex items-center gap-1.5', shown.className)}>
            <AppIcon id={shown.icon} size={14} />
            {shown.label}
          </span>
        )
      }
    >
      {hasCode ? (
        <TextField
          label="Code"
          size="compact"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={code}
          disabled={disabled}
          onChange={(event) => {
            setCode(event.target.value);
          }}
        />
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="ghost"
          disabled={disabled || busy || (hasCode && code === '')}
          onClick={() => {
            send('lock');
          }}
        >
          <AppIcon id="lock" size={15} />
          Lock
        </Button>
        <Button
          variant="ghost"
          disabled={disabled || busy || (hasCode && code === '')}
          onClick={() => {
            send('unlock');
          }}
        >
          <AppIcon id="lock-open" size={15} />
          Unlock
        </Button>
      </div>
    </ControlBlock>
  );
}
