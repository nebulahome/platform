/**
 * A thermostat, drawn as the dial it is.
 *
 * The arc runs from the coldest to the warmest target the thermostat takes, lit up to the target;
 * the target is the large figure in the middle and the measured temperature is under it. Two
 * buttons move the target one step each way. What it is doing - heating, idle - is said in a word
 * beside the name, since the mode alone cannot say why nothing is running. The square card adds
 * the mode as something to choose, and the humidity when the thermostat reads it.
 */
import type { THERMOSTAT_MODES } from '@nebulahome/contracts';
import { AppIcon, Badge, Button, Segmented, type BadgeTone } from '@nebulahome/ui';

import { paramsOf } from '@/library/entity-control';
import { CardFrame, CardHeading } from '@/routes/dashboard/cards/card-parts';
import { sizeKey, type EntityCardModel } from '@/routes/dashboard/cards/entity-model';
import { useEntityCommand } from '@/routes/library/entity/use-entity-command';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** One thermostat mode. */
type Mode = (typeof THERMOSTAT_MODES)[number];

/** How a temperature is written. */
const temperature = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** The radius of the dial, in its own units. */
const RADIUS = 48;

/** How long the arc is: three quarters of the circle. */
const ARC = 2 * Math.PI * RADIUS * 0.75;

/** The badge each thing a thermostat can be doing is drawn in. */
const ACTIONS: Readonly<Record<string, BadgeTone>> = {
  heating: 'danger',
  cooling: 'accent',
  drying: 'accent',
  fan: 'neutral',
  idle: 'neutral',
  off: 'neutral',
};

/** The colour of the lit arc, by what the thermostat is doing. */
const ARC_COLOURS: Readonly<Record<string, string>> = {
  heating: 'var(--color-tag-orange)',
  cooling: 'var(--color-tag-blue)',
};

/**
 * Names a mode or an action.
 *
 * @param word - As the thermostat says it: `fan_only`.
 * @returns `Fan only`.
 */
function spoken(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).replaceAll('_', ' ');
}

/** What the dial needs. */
type DialProps = {
  readonly target: number;
  readonly now: number | undefined;
  readonly min: number;
  readonly max: number;
  readonly action: string;
  readonly isOff: boolean;
};

/**
 * Renders the dial: the arc, the target inside it, and the measured temperature under that.
 *
 * @param props - See {@link DialProps}.
 * @returns The dial.
 */
function Dial(props: DialProps) {
  const { target, now, min, max, action, isOff } = props;
  const share = max > min ? Math.min(1, Math.max(0, (target - min) / (max - min))) : 0;
  // The arc starts at the lower left, 135 degrees round from the right, and turns clockwise.
  const angle = ((135 + share * 270) * Math.PI) / 180;
  const knob = { x: 60 + RADIUS * Math.cos(angle), y: 60 + RADIUS * Math.sin(angle) };
  const colour = isOff
    ? 'var(--color-border-strong)'
    : (ARC_COLOURS[action] ?? 'var(--color-primary)');
  const path = 'M 26.06 93.94 A 48 48 0 1 1 93.94 93.94';

  return (
    <div className="relative flex min-h-0 grow items-center justify-center">
      <svg viewBox="6 6 108 94" className="h-full max-h-28 w-auto" fill="none" aria-hidden="true">
        <path d={path} stroke="var(--color-groove)" strokeWidth="9" strokeLinecap="round" />
        {isOff ? null : (
          <path
            d={path}
            stroke={colour}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={`${String(share * ARC)} ${String(ARC)}`}
          />
        )}
        <circle cx={knob.x} cy={knob.y} r="2.6" fill="var(--color-knob)" />
      </svg>
      <div className="absolute inset-x-0 flex translate-y-0.5 flex-col items-center gap-0.5">
        <span className="text-reading leading-none font-semibold tabular">
          {isOff ? 'Off' : `${temperature.format(target)}°`}
        </span>
        {now === undefined ? null : (
          <span className="text-caption text-foreground-subtle tabular">
            now {temperature.format(now)}°
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Renders a thermostat card at its size.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function ThermostatCard(props: { readonly model: EntityCardModel }) {
  const { model } = props;
  const { entity, state, title, subtitle, reportedAt } = model;
  const thermostat = state.thermostat;
  const params = paramsOf(entity, 'thermostat');
  const commander = useEntityCommand(entity.entityId);
  const target = usePendingValue(thermostat?.targetTemperature ?? 20, reportedAt);
  const mode = usePendingValue<Mode>(thermostat?.mode ?? 'off', reportedAt);
  const action = thermostat?.action ?? 'idle';
  const isOff = mode.shown === 'off';
  const disabled = !model.canControl || params === null || isOff;
  const min = params?.minTemperature ?? 5;
  const max = params?.maxTemperature ?? 35;
  const step = params?.temperatureStep ?? 0.5;

  /**
   * Moves the target one step.
   *
   * @param direction - Down or up.
   */
  const nudge = (direction: -1 | 1): void => {
    const next = Math.min(
      max,
      Math.max(min, Math.round((target.shown + direction * step) / step) * step),
    );

    target.sent(next);
    commander.send('thermostat', { command: 'set_target', temperature: next });
  };

  const heading = (
    <CardHeading
      title={title}
      subtitle={subtitle}
      tail={
        thermostat === undefined ? undefined : (
          <Badge tone={ACTIONS[action] ?? 'neutral'} size="small">
            {spoken(action)}
          </Badge>
        )
      }
    />
  );
  const buttons = (
    <div className="flex gap-2">
      <Button
        variant="ghost"
        size="compact"
        className="grow"
        aria-label="Lower the target"
        disabled={disabled || target.shown <= min}
        onClick={() => {
          nudge(-1);
        }}
      >
        <AppIcon id="minus" size={16} />
      </Button>
      <Button
        variant="ghost"
        size="compact"
        className="grow"
        aria-label="Raise the target"
        disabled={disabled || target.shown >= max}
        onClick={() => {
          nudge(1);
        }}
      >
        <AppIcon id="plus" size={16} />
      </Button>
    </div>
  );
  const dial = (
    <Dial
      target={target.shown}
      now={thermostat?.currentTemperature}
      min={min}
      max={max}
      action={action}
      isOff={isOff}
    />
  );

  if (sizeKey(model.size) !== '2x2') {
    return (
      <CardFrame label={title}>
        {heading}
        {dial}
        {buttons}
      </CardFrame>
    );
  }

  const modes = (params?.supportedModes ?? []).map((value) => ({ value, label: spoken(value) }));

  return (
    <CardFrame label={title}>
      {heading}
      <div className="flex min-h-0 grow gap-4 pt-2">
        <div className="flex min-w-0 grow flex-col gap-2">
          {dial}
          {buttons}
        </div>
        <div className="flex w-2/5 shrink-0 flex-col justify-end gap-3">
          {thermostat?.humidity === undefined ? null : (
            <span className="text-caption text-foreground-muted tabular">
              Humidity {String(Math.round(thermostat.humidity))}%
            </span>
          )}
          {modes.length === 0 ? null : (
            <Segmented
              label="Mode"
              size="compact"
              className="flex-wrap"
              options={modes}
              value={mode.shown}
              disabled={!model.canControl}
              onChange={(next) => {
                mode.sent(next);
                commander.send('thermostat', { command: 'set_mode', mode: next });
              }}
            />
          )}
        </div>
      </div>
    </CardFrame>
  );
}
