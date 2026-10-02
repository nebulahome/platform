/**
 * A setting that is a number within limits: minutes to wait after rain, the angle a mower cuts
 * at.
 *
 * A short range is a stepper, one press a step; a long one is a slider, sent when it is let go -
 * a delay of up to a day in minutes is not something to reach one press at a time. The unit is
 * the entity's, as a sensor's is.
 */
import { Slider, Stepper } from '@nebulahome/ui';

import { paramsOf } from '@/library/entity-control';
import { capabilityLabel } from '@/library/entity-kind';
import {
  ControlBlock,
  isBusy,
  type ControlProps,
} from '@/routes/library/entity/controls/control-block';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** Up to this many steps a stepper does; past it, a slider. */
const STEPPER_STEPS = 24;

const numbers = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/**
 * Renders the number control.
 *
 * @param props - See {@link ControlProps}.
 * @returns The block.
 */
export function NumberControl(props: ControlProps) {
  const { entity, state, reportedAt, commander, disabled } = props;
  const params = paramsOf(entity, 'number');
  const reported = state.number?.value ?? null;
  const value = usePendingValue(reported ?? params?.min ?? 0, reportedAt);
  const busy = disabled || isBusy(props, 'number');
  const unit = entity.unitOfMeasurement;

  /**
   * Writes a figure with the entity's unit.
   *
   * @param figure - The number.
   * @returns "180 min", "90°".
   */
  const format = (figure: number): string =>
    unit === null || unit === ''
      ? numbers.format(figure)
      : unit === '°' || unit === '%'
        ? `${numbers.format(figure)}${unit}`
        : `${numbers.format(figure)} ${unit}`;

  /**
   * Sends a new value.
   *
   * @param next - It.
   */
  const set = (next: number): void => {
    value.sent(next);
    commander.send('number', { command: 'set_value', value: next });
  };

  return (
    <ControlBlock
      title={capabilityLabel('number')}
      value={reported === null ? '—' : format(value.shown)}
    >
      {params === null ? (
        <p className="text-caption text-foreground-subtle">
          This setting has not said its limits, so it cannot be set from here.
        </p>
      ) : (params.max - params.min) / params.step <= STEPPER_STEPS ? (
        <Stepper
          label={entity.name}
          className="self-start"
          value={value.shown}
          min={params.min}
          max={params.max}
          step={params.step}
          format={format}
          disabled={busy}
          onChange={set}
        />
      ) : (
        <Slider
          label={entity.name}
          isLabelHidden
          value={value.shown}
          min={params.min}
          max={params.max}
          step={params.step}
          display={format(value.shown)}
          disabled={busy}
          onChange={value.hold}
          onCommit={set}
        />
      )}
    </ControlBlock>
  );
}
