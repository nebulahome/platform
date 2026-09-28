/**
 * A setting picked from a fixed list: a mower's cutting pattern, how high an obstacle it climbs.
 *
 * A few choices are a segmented control, every one in sight; more are a dropdown. A value the
 * device was set to elsewhere and the list does not have is shown as it is, rather than as the
 * first choice it is not.
 */
import { Segmented, SelectField } from '@nebula-home/ui';

import { paramsOf } from '@/library/entity-control';
import { capabilityLabel } from '@/library/entity-kind';
import {
  ControlBlock,
  isBusy,
  type ControlProps,
} from '@/routes/library/entity/controls/control-block';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** Past this many choices the list is a dropdown rather than a segmented control. */
const SEGMENTED_OPTIONS = 3;

/**
 * Renders the select control.
 *
 * @param props - See {@link ControlProps}.
 * @returns The block.
 */
export function SelectControl(props: ControlProps) {
  const { entity, state, reportedAt, commander, disabled } = props;
  const options = paramsOf(entity, 'select')?.options ?? [];
  const option = usePendingValue(state.select?.option ?? '', reportedAt);
  const known = options.find((each) => each.value === option.shown);
  const busy = disabled || isBusy(props, 'select');

  /**
   * Picks one of the choices.
   *
   * @param next - Its value.
   */
  const pick = (next: string): void => {
    option.sent(next);
    commander.send('select', { command: 'select_option', option: next });
  };

  return (
    <ControlBlock
      title={capabilityLabel('select')}
      value={option.shown === '' ? '—' : (known?.label ?? option.shown)}
    >
      {options.length === 0 ? (
        <p className="text-caption text-foreground-subtle">
          This setting has not said its choices, so it cannot be set from here.
        </p>
      ) : options.length <= SEGMENTED_OPTIONS && known !== undefined ? (
        <Segmented
          label={entity.name}
          className="self-start"
          options={options}
          value={known.value}
          disabled={busy}
          onChange={pick}
        />
      ) : (
        <SelectField
          label={entity.name}
          isLabelHidden
          size="compact"
          options={
            known === undefined && option.shown !== ''
              ? [{ value: option.shown, label: option.shown }, ...options]
              : options
          }
          value={option.shown}
          disabled={busy}
          onChange={(next) => {
            if (next !== option.shown && options.some((each) => each.value === next)) {
              pick(next);
            }
          }}
        />
      )}
    </ControlBlock>
  );
}
