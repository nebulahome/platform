/**
 * A lock: locked, unlocked, or jammed.
 *
 * Jammed is a state of its own and is shown as a warning, because a bolt that failed to throw is
 * a fact about the front door, not a hiccup to retry quietly. A lock that wants a code gets a
 * field for it; the code is sent with the command and kept nowhere, and the field empties once
 * it has gone.
 *
 * Unlocking is held, never tapped: a door opened by a tap in a pocket, or by a child at the
 * dashboard, is a door open. Locking is a tap - nothing is lost by a door locked by mistake.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, Button, cn, HoldButton, TextField } from '@nebulahome/ui';

import { defineMessage, text } from '@/i18n/messages';
import { paramsOf } from '@/library/entity-control';
import {
  ControlBlock,
  isBusy,
  type ControlProps,
} from '@/routes/library/entity/controls/control-block';

/** The words for each bolt position. */
const STATES = {
  locked: {
    label: defineMessage('entity.controls.lockControl.locked', 'Locked'),
    icon: 'lock',
    className: 'text-foreground',
  },
  unlocked: {
    label: defineMessage('entity.controls.lockControl.unlocked', 'Unlocked'),
    icon: 'lock-open',
    className: 'text-warning',
  },
  jammed: {
    label: defineMessage('entity.controls.lockControl.jammed', 'Jammed'),
    icon: 'triangle-alert',
    className: 'text-danger',
  },
} as const;

/**
 * Renders the lock control.
 *
 * @param props - See {@link ControlProps}.
 * @returns The block.
 */
export function LockControl(props: ControlProps) {
  const { t } = useTranslation();

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
      title={t('entity.controls.lockControl.lock', 'Lock')}
      value={
        state.lock === undefined ? (
          '—'
        ) : (
          <span className={cn('inline-flex items-center gap-1.5', shown.className)}>
            <AppIcon id={shown.icon} size={14} />
            {text(shown.label)}
          </span>
        )
      }
    >
      {hasCode ? (
        <TextField
          label={t('entity.controls.lockControl.code', 'Code')}
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
          {t('entity.controls.lockControl.lock', 'Lock')}
        </Button>
        <HoldButton
          disabled={disabled || busy || (hasCode && code === '')}
          onConfirm={() => {
            send('unlock');
          }}
        >
          <span className="inline-flex items-center gap-2">
            <AppIcon id="lock-open" size={15} />
            {t('entity.controls.lockControl.holdToUnlock', 'Hold to unlock')}
          </span>
        </HoldButton>
      </div>
    </ControlBlock>
  );
}
