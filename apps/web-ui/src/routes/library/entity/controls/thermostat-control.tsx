/**
 * A thermostat: what it measures, what it aims for, the mode it is in and what it is doing.
 *
 * The measured temperature is the large figure, because it is what someone opening a thermostat
 * wants to know first; the target is set half a step at a time with a stepper, inside the range
 * this thermostat declared. The mode offers only the modes it supports. "Heating" and "Idle" are
 * said apart from the mode: a thermostat on auto that has reached its target is idle, and a page
 * that showed only the mode could not explain why nothing is running.
 */
import { useTranslation } from 'react-i18next';

import { THERMOSTAT_MODES } from '@nebulahome/contracts';
import { Segmented, SelectField, Stepper } from '@nebulahome/ui';

import { numberFormat } from '@/i18n/formatters';
import { paramsOf } from '@/library/entity-control';
import { ControlBlock, type ControlProps } from '@/routes/library/entity/controls/control-block';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** One thermostat mode. */
type Mode = (typeof THERMOSTAT_MODES)[number];

/** Past this many modes the choice is a dropdown rather than a segmented control. */
const SEGMENTED_MODES = 4;

/**
 * How a temperature is written.
 *
 * @returns The formatter, in the reader's language.
 */
const temperature = (): Intl.NumberFormat =>
  numberFormat({
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

/**
 * Names a mode or an action.
 *
 * @param word - As the thermostat says it: `fan_only`.
 * @returns `Fan only`.
 */
function spoken(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).replaceAll('_', ' ');
}

/**
 * Narrows a chosen value to a mode.
 *
 * @param value - What the control reported.
 * @returns The mode, or null when it is not one.
 */
function modeOf(value: string): Mode | null {
  return THERMOSTAT_MODES.find((mode) => mode === value) ?? null;
}

/**
 * Renders the thermostat control.
 *
 * @param props - See {@link ControlProps}.
 * @returns The block.
 */
export function ThermostatControl(props: ControlProps) {
  const { t } = useTranslation();

  const { entity, state, reportedAt, commander, disabled } = props;
  const params = paramsOf(entity, 'thermostat');
  const thermostat = state.thermostat;
  const target = usePendingValue(thermostat?.targetTemperature ?? 20, reportedAt);
  const mode = usePendingValue<Mode>(thermostat?.mode ?? 'off', reportedAt);
  const modes = (params?.supportedModes ?? []).map((value) => ({ value, label: spoken(value) }));

  return (
    <ControlBlock
      title={t('entity.controls.thermostatControl.climate', 'Climate')}
      value={thermostat === undefined ? '—' : spoken(thermostat.action)}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-caption text-foreground-subtle">
            {t('entity.controls.thermostatControl.now', 'Now')}
          </span>
          <span className="font-mono text-mono-reading text-foreground tabular">
            {thermostat === undefined
              ? '—'
              : `${temperature().format(thermostat.currentTemperature)}°`}
          </span>
          {thermostat?.humidity === undefined ? null : (
            <span className="text-caption text-foreground-subtle tabular">
              {t('entity.controls.thermostatControl.humidityHumidity', 'Humidity {{humidity}}%', {
                humidity: String(Math.round(thermostat.humidity)),
              })}
            </span>
          )}
        </div>
        {params === null ? null : (
          <div className="flex flex-col items-center gap-1">
            <span className="text-caption text-foreground-subtle">
              {t('entity.controls.thermostatControl.target', 'Target')}
            </span>
            <Stepper
              label={t('entity.controls.thermostatControl.targetTemperature', 'Target temperature')}
              value={target.shown}
              min={params.minTemperature}
              max={params.maxTemperature}
              step={params.temperatureStep}
              format={(value) => `${temperature().format(value)}°`}
              disabled={disabled || mode.shown === 'off'}
              onChange={(next) => {
                target.sent(next);
                commander.send('thermostat', { command: 'set_target', temperature: next });
              }}
            />
          </div>
        )}
      </div>
      {params === null ? (
        <p className="text-caption text-foreground-subtle">
          {t(
            'entity.controls.thermostatControl.thisThermostatHasNot',
            'This thermostat has not said its range and modes, so it cannot be set from here.',
          )}
        </p>
      ) : modes.length <= SEGMENTED_MODES ? (
        <Segmented
          label={t('entity.controls.thermostatControl.mode', 'Mode')}
          className="self-start"
          options={modes}
          value={mode.shown}
          disabled={disabled}
          onChange={(next) => {
            mode.sent(next);
            commander.send('thermostat', { command: 'set_mode', mode: next });
          }}
        />
      ) : (
        <SelectField
          label={t('entity.controls.thermostatControl.mode', 'Mode')}
          size="compact"
          options={modes}
          value={mode.shown}
          disabled={disabled}
          onChange={(value) => {
            const next = modeOf(value);

            if (next !== null) {
              mode.sent(next);
              commander.send('thermostat', { command: 'set_mode', mode: next });
            }
          }}
        />
      )}
    </ControlBlock>
  );
}
