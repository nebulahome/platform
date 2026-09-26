/**
 * A device's firmware: what it runs, what it could run, and the install.
 *
 * One block, because it is one thing: the version beside the title, the newer one underneath
 * when there is one, and the button that installs it. The button asks first - the device
 * restarts to install and is gone for a minute or two - and while it installs the block says so,
 * with how far it got when the device says, and offers nothing to press: pressing again is what
 * an install already under way does not need.
 */
import { useState } from 'react';

import { isUpdateOffered } from '@nebula-home/contracts';
import { Button, Modal } from '@nebula-home/ui';

import { paramsOf } from '@/library/entity-control';
import {
  ControlBlock,
  isBusy,
  type ControlProps,
} from '@/routes/library/entity/controls/control-block';

/**
 * Renders the firmware control.
 *
 * @param props - See {@link ControlProps}.
 * @returns The block.
 */
export function UpdateControl(props: ControlProps) {
  const { entity, state, commander, disabled } = props;
  const [isAsking, setAsking] = useState(false);
  const firmware = state.update;
  const canInstall = paramsOf(entity, 'update')?.canInstall ?? true;
  const isInstalling = firmware?.isInstalling === true;
  const isOffered = firmware !== undefined && isUpdateOffered(firmware);
  const progress = firmware?.progress ?? null;

  /** Sends the install. */
  const install = (): void => {
    setAsking(false);
    commander.send('update', { command: 'install' });
  };

  return (
    <ControlBlock
      title="Firmware"
      value={firmware?.installedVersion ?? '—'}
      action={
        canInstall && isOffered && !isInstalling ? (
          <Button
            size="compact"
            variant="ghost"
            disabled={disabled}
            isBusy={isBusy(props, 'update')}
            onClick={() => {
              setAsking(true);
            }}
          >
            Install update
          </Button>
        ) : null
      }
    >
      {isInstalling ? (
        <div className="flex flex-col gap-2">
          <p role="status" className="text-ui text-foreground-muted">
            Installing
            {firmware.latestVersion === null ? '' : ` ${firmware.latestVersion}`}
            {progress === null ? '…' : ` · ${String(Math.round(progress))}%`}
          </p>
          <div
            role="progressbar"
            aria-label="Firmware update"
            aria-valuemin={0}
            aria-valuemax={100}
            {...(progress === null ? {} : { 'aria-valuenow': Math.round(progress) })}
            className="h-1.5 overflow-hidden rounded-full bg-surface-raised"
          >
            <div
              className={
                progress === null
                  ? 'h-full w-1/3 animate-pulse rounded-full bg-primary'
                  : 'h-full rounded-full bg-primary transition-[width] duration-500'
              }
              /* eslint-disable-next-line react/forbid-dom-props -- how far the install got is
                 a live value, not a token (RULES.md 15.3). */
              style={progress === null ? undefined : { width: `${String(progress)}%` }}
            />
          </div>
        </div>
      ) : isOffered ? (
        <p className="text-ui text-foreground-muted">
          {firmware.latestVersion} is available
          {canInstall ? '.' : '; install it from the device’s own app.'}
        </p>
      ) : firmware === undefined ? null : (
        <p className="text-ui text-foreground-subtle">Up to date.</p>
      )}

      <Modal
        isOpen={isAsking}
        onClose={() => {
          setAsking(false);
        }}
        size="small"
        title="Install the firmware update?"
        description="The device downloads the update and restarts to install it. It is offline for a minute or two, and whatever it switches may turn off meanwhile."
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setAsking(false);
              }}
            >
              Cancel
            </Button>
            <Button onClick={install}>Install</Button>
          </>
        }
      >
        {null}
      </Modal>
    </ControlBlock>
  );
}
