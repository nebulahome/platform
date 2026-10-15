/**
 * On and off.
 *
 * A switch that commands at once, with the state in words beside the title, so the answer to
 * "is it on?" is read before the control is found.
 */
import { useTranslation } from 'react-i18next';

import { Switch } from '@nebulahome/ui';

import { powerCommand } from '@/library/entity-control';
import {
  ControlBlock,
  isBusy,
  type ControlProps,
} from '@/routes/library/entity/controls/control-block';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/**
 * Renders the power control.
 *
 * @param props - See {@link ControlProps}.
 * @returns The block.
 */
export function PowerControl(props: ControlProps) {
  const { t } = useTranslation();

  const { entity, state, reportedAt, commander, disabled } = props;
  const reported = state.on_off?.isOn ?? false;
  const power = usePendingValue(reported, reportedAt);
  const isOn = commander.problem === null ? power.shown : reported;

  return (
    <ControlBlock
      title={t('entity.controls.powerControl.power', 'Power')}
      value={isOn ? 'On' : 'Off'}
      action={
        <Switch
          label={t('entity.controls.powerControl.namePower', '{{name}} power', {
            name: entity.name,
          })}
          isOn={isOn}
          disabled={disabled}
          isBusy={isBusy(props, 'on_off')}
          onChange={(next) => {
            power.sent(next);
            commander.send('on_off', powerCommand(next));
          }}
        />
      }
    />
  );
}
