/**
 * A button: one press, and nothing to read back.
 *
 * A button holds no state, so the block has no value beside its title - only the button. One
 * that restarts the device asks first: the device is gone until it is back, which is not
 * something a stray tap should do in the middle of an evening. So does one that stops what the
 * device is doing - a print cancelled halfway cannot be picked up again. Firmware is not a button: it has
 * its own block, with the versions and the install beside them.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Modal } from '@nebulahome/ui';

import { defineMessage, type Message, text } from '@/i18n/messages';
import {
  ControlBlock,
  isBusy,
  type ControlProps,
} from '@/routes/library/entity/controls/control-block';

/** Device classes whose press cannot be taken back, and what the question says about each. */
const ASKED_FIRST: Readonly<Record<string, Message>> = {
  restart: defineMessage(
    'entity.controls.buttonControl.deviceRestartsAndIs',
    'The device restarts, and is offline until it is back.',
  ),
  stop: defineMessage(
    'entity.controls.buttonControl.whatTheDeviceIs',
    'What the device is doing stops, and cannot be picked up again.',
  ),
};

/**
 * Renders the button control.
 *
 * @param props - See {@link ControlProps}.
 * @returns The block.
 */
export function ButtonControl(props: ControlProps) {
  const { t } = useTranslation();

  const { entity, commander, disabled } = props;
  const [isAsking, setAsking] = useState(false);
  const asked = ASKED_FIRST[entity.deviceClass ?? ''];
  const question = asked === undefined ? undefined : text(asked);
  const asksFirst = question !== undefined;

  /** Sends the press. */
  const press = (): void => {
    setAsking(false);
    commander.send('button', { command: 'press' });
  };

  return (
    <ControlBlock
      title={t('entity.controls.buttonControl.button', 'Button')}
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
          {t('entity.controls.buttonControl.press', 'Press')}
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
          title={t('entity.controls.buttonControl.pressName', 'Press {{name}}?', {
            name: entity.name,
          })}
          description={question}
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setAsking(false);
                }}
              >
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button onClick={press}>{t('entity.controls.buttonControl.press', 'Press')}</Button>
            </>
          }
        >
          {null}
        </Modal>
      ) : null}
    </ControlBlock>
  );
}
