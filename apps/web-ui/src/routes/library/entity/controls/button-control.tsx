/**
 * A button: one press, and nothing to read back.
 *
 * A button holds no state, so the block has no value beside its title - only the button. One
 * that installs firmware asks first: the device restarts to install it and is gone for a minute,
 * which is not something a stray tap should do in the middle of an evening.
 */
import { useState } from 'react';

import { Button, Modal } from '@nebula-home/ui';

import {
  ControlBlock,
  isBusy,
  type ControlProps,
} from '@/routes/library/entity/controls/control-block';

/** Device classes whose press restarts the device, and so is asked about first. */
const RESTARTING_CLASSES: ReadonlySet<string> = new Set(['update', 'restart']);

/**
 * Renders the button control.
 *
 * @param props - See {@link ControlProps}.
 * @returns The block.
 */
export function ButtonControl(props: ControlProps) {
  const { entity, commander, disabled } = props;
  const [isAsking, setAsking] = useState(false);
  const asksFirst = RESTARTING_CLASSES.has(entity.deviceClass ?? '');
  const isUpdate = entity.deviceClass === 'update';

  /** Sends the press. */
  const press = (): void => {
    setAsking(false);
    commander.send('button', { command: 'press' });
  };

  return (
    <ControlBlock
      title={isUpdate ? 'Firmware' : 'Button'}
      action={
        <Button
          size="compact"
          variant="ghost"
          disabled={disabled}
          isBusy={isBusy(props, 'button')}
          onClick={() => {
            if (asksFirst) {
              setAsking(true);
            } else {
              press();
            }
          }}
        >
          {isUpdate ? 'Install update' : 'Press'}
        </Button>
      }
    >
      {asksFirst ? (
        <Modal
          isOpen={isAsking}
          onClose={() => {
            setAsking(false);
          }}
          size="small"
          title={isUpdate ? 'Install the firmware update?' : `Press ${entity.name}?`}
          description={
            isUpdate
              ? 'The device downloads the update and restarts to install it. It is offline for a minute or two, and whatever it switches may turn off meanwhile.'
              : 'The device restarts, and is offline until it is back.'
          }
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
              <Button onClick={press}>{isUpdate ? 'Install' : 'Press'}</Button>
            </>
          }
        >
          {null}
        </Modal>
      ) : null}
    </ControlBlock>
  );
}
