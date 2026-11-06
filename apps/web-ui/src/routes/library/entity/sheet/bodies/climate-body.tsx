/**
 * A thermostat or an air conditioner, as the canvas draws it (`N-Entity-Modal-Climate`,
 * `N-Entity-Climate-More`). The dial is always the same: 270° of ticks, the target's handle, the
 * room's reading as a dot, and the ticks between the two lit in what the unit is doing. Under it
 * what the unit reports adds its blocks:
 *
 * - one target: − and + either side of "Now" and the humidity;
 * - a range: two handles, and a "Heat to" and a "Cool to" box with their own − and +;
 * - its modes as tiles, up to five on a row, six or seven on two;
 * - presets as a list; the fan as a bar of levels with Auto apart, or chips; each swing as a
 *   segmented row; a humidity target as a thin slider.
 */
import { useTranslation } from 'react-i18next';

import type { THERMOSTAT_ACTIONS, THERMOSTAT_MODES } from '@nebulahome/contracts';
import { AppIcon, cn, type UiIconId } from '@nebulahome/ui';

import { defineMessage, text, type Message } from '@/i18n/messages';
import { paramsOf } from '@/library/entity-control';
import { OptionList } from '@/routes/library/entity/sheet/parts/option-list';
import {
  BlockHead,
  LevelSteps,
  RoundAction,
  ThinSlider,
  useSinceLine,
} from '@/routes/library/entity/sheet/parts/sheet-controls';
import { SendingSpinner } from '@/routes/library/entity/sheet/parts/sheet-parts';
import type { SheetBodyProps } from '@/routes/library/entity/sheet/sheet-types';
import { TONE_SVG, TONE_TEXT, type SheetTone } from '@/routes/library/entity/sheet/tones';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** A thermostat's mode. */
type Mode = (typeof THERMOSTAT_MODES)[number];

/** What a thermostat is doing. */
type Action = (typeof THERMOSTAT_ACTIONS)[number];

/** How each mode's tile is drawn. */
const MODES: Readonly<Record<Mode, { icon: UiIconId; tone: SheetTone; word: Message }>> = {
  off: { icon: 'power', tone: 'muted', word: defineMessage('entity.sheet.climate.modeOff', 'Off') },
  heat: {
    icon: 'flame',
    tone: 'heat',
    word: defineMessage('entity.sheet.climate.modeHeat', 'Heat'),
  },
  cool: {
    icon: 'snowflake',
    tone: 'cyan',
    word: defineMessage('entity.sheet.climate.modeCool', 'Cool'),
  },
  auto: {
    icon: 'refresh-cw',
    tone: 'success',
    word: defineMessage('entity.sheet.climate.modeAuto', 'Auto'),
  },
  fan_only: {
    icon: 'wind',
    tone: 'cyan',
    word: defineMessage('entity.sheet.climate.modeFan', 'Fan'),
  },
  dry: {
    icon: 'droplet',
    tone: 'primary',
    word: defineMessage('entity.sheet.climate.modeDry', 'Dry'),
  },
};

/** How each action reads over the number. */
const ACTIONS: Readonly<Record<Action, { icon: UiIconId; tone: SheetTone; word: Message }>> = {
  off: { icon: 'power', tone: 'muted', word: defineMessage('entity.sheet.climate.off', 'Off') },
  idle: {
    icon: 'sun-snow',
    tone: 'success',
    word: defineMessage('entity.sheet.climate.idle', 'Idle'),
  },
  heating: {
    icon: 'flame',
    tone: 'heat',
    word: defineMessage('entity.sheet.climate.heating', 'Heating'),
  },
  preheating: {
    icon: 'flame',
    tone: 'heat',
    word: defineMessage('entity.sheet.climate.preheating', 'Preheating'),
  },
  cooling: {
    icon: 'snowflake',
    tone: 'cyan',
    word: defineMessage('entity.sheet.climate.cooling', 'Cooling'),
  },
  defrosting: {
    icon: 'snowflake',
    tone: 'cyan',
    word: defineMessage('entity.sheet.climate.defrosting', 'Defrosting'),
  },
  drying: {
    icon: 'droplet',
    tone: 'cyan',
    word: defineMessage('entity.sheet.climate.drying', 'Drying'),
  },
  fan: { icon: 'wind', tone: 'cyan', word: defineMessage('entity.sheet.climate.fanning', 'Fan') },
};

/** The breathing glow behind the number, in the action's colour. */
const GLOWS: Readonly<Record<SheetTone, string>> = {
  lamp: 'bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-lamp)_20%,transparent),transparent_70%)]',
  primary:
    'bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-primary)_20%,transparent),transparent_70%)]',
  success:
    'bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-success)_20%,transparent),transparent_70%)]',
  heat: 'bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-heat)_20%,transparent),transparent_70%)]',
  cyan: 'bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-cyan)_20%,transparent),transparent_70%)]',
  media:
    'bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-media)_20%,transparent),transparent_70%)]',
  violet:
    'bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-violet)_20%,transparent),transparent_70%)]',
  danger:
    'bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-danger)_20%,transparent),transparent_70%)]',
  muted: '',
};

/** The tile of a mode chosen, in its colour. */
const MODE_CHOSEN: Readonly<Record<SheetTone, string>> = {
  lamp: 'border-lamp/55 bg-lamp/14 text-lamp',
  primary: 'border-primary/55 bg-primary/14 text-primary',
  success: 'border-success/55 bg-success/14 text-success',
  heat: 'border-heat/55 bg-heat/14 text-heat',
  cyan: 'border-cyan/55 bg-cyan/14 text-cyan',
  media: 'border-media/55 bg-media/14 text-media',
  violet: 'border-violet/55 bg-violet/14 text-violet',
  danger: 'border-danger/55 bg-danger/14 text-danger',
  muted: 'border-border-strong bg-surface-high text-foreground-muted',
};

/** The names of fan modes that read as levels, in their order, so the fan can be a bar. */
const FAN_LEVELS = ['quiet', 'silent', 'low', 'mid', 'medium', 'middle', 'high', 'max', 'turbo'];

/** The dial's box, its centre and its ticks. */
const DIAL = 248;
const CENTRE = DIAL / 2;
const TICKS = 61;

/**
 * Where a value sits on the dial, as an angle in degrees: 135° (lower left) for the lowest,
 * round through the top, to 405° (lower right) for the highest.
 *
 * @param value - The value.
 * @param min - The dial's lowest.
 * @param max - The dial's highest.
 * @returns The angle.
 */
function angleOf(value: number, min: number, max: number): number {
  return 135 + ((Math.min(max, Math.max(min, value)) - min) / Math.max(1e-9, max - min)) * 270;
}

/**
 * A point at a radius and an angle from the dial's centre.
 *
 * @param radius - How far out.
 * @param degrees - The angle.
 * @returns The point.
 */
function at(radius: number, degrees: number): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;

  return { x: CENTRE + radius * Math.cos(radians), y: CENTRE + radius * Math.sin(radians) };
}

/** What the dial needs. */
type DialProps = {
  readonly min: number;
  readonly max: number;
  readonly target: number | null;
  readonly low: number | null;
  readonly high: number | null;
  readonly now: number | null;
  readonly tone: SheetTone;
  readonly label: string;
};

/**
 * The dial: its ticks, the stretch between the room and the target lit, the handles and the dot.
 *
 * @param props - See {@link DialProps}.
 * @returns The svg.
 */
function Dial(props: DialProps) {
  const { min, max, target, low, high, now, tone, label } = props;
  /**
   * Where a value sits on this dial.
   *
   * @param value - The value.
   * @returns Its angle.
   */
  const toAngle = (value: number): number => angleOf(value, min, max);
  const lit: [number, number] | null =
    low !== null && high !== null
      ? [toAngle(low), toAngle(high)]
      : target !== null && now !== null
        ? [Math.min(toAngle(target), toAngle(now)), Math.max(toAngle(target), toAngle(now))]
        : null;

  return (
    <svg
      width={DIAL}
      height={DIAL}
      viewBox={`0 0 ${String(DIAL)} ${String(DIAL)}`}
      role="img"
      aria-label={label}
      className="absolute top-0 left-0"
    >
      {[...Array.from({ length: TICKS }).keys()].map((index) => {
        const angle = 135 + index * 4.5;
        const isMajor = index % 10 === 0;
        const isLit = lit !== null && angle >= lit[0] - 0.01 && angle <= lit[1] + 0.01;
        const from = at(116, angle);
        const to = at(isMajor && !isLit ? 102 : 107, angle);

        return (
          <line
            key={index}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            strokeWidth={isLit ? 2.5 : 2}
            strokeLinecap="round"
            className={
              isLit
                ? low !== null
                  ? 'stroke-success/55'
                  : TONE_SVG[tone].stroke
                : isMajor
                  ? 'stroke-[#2d3352]'
                  : 'stroke-border'
            }
          />
        );
      })}
      {target !== null && low === null ? (
        <line
          {...(() => {
            const from = at(120, toAngle(target));
            const to = at(96, toAngle(target));

            return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
          })()}
          strokeWidth={4}
          strokeLinecap="round"
          className="stroke-knob"
        />
      ) : null}
      {low !== null && high !== null
        ? (
            [
              [low, 'fill-heat'],
              [high, 'fill-cyan'],
            ] as const
          ).map(([value, fill]) => {
            const point = at(120, toAngle(value));

            return (
              <circle
                key={fill}
                cx={point.x}
                cy={point.y}
                r={5}
                strokeWidth={2}
                className={cn(fill, 'stroke-surface')}
              />
            );
          })
        : null}
      {now === null
        ? null
        : (() => {
            const point = at(90, toAngle(now));

            return (
              <circle
                cx={point.x}
                cy={point.y}
                r={4}
                className={low !== null ? 'fill-success' : TONE_SVG[tone].fill}
              />
            );
          })()}
    </svg>
  );
}

/**
 * The body of a thermostat.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
export function ClimateBody(props: SheetBodyProps) {
  const { t } = useTranslation();
  const { entity, state, commander, disabled, reportedAt, history } = props;
  const since = useSinceLine(entity, history);
  const params = paramsOf(entity, 'thermostat');
  const target = usePendingValue(state.thermostat?.targetTemperature ?? 20, reportedAt);
  const humidityTarget = usePendingValue(state.thermostat?.targetHumidity ?? 50, reportedAt);
  const climate = state.thermostat;

  if (climate === undefined || params === null) {
    return null;
  }

  const unit = entity.unitOfMeasurement ?? '°C';
  const step = params.temperatureStep;
  const isRange =
    params.hasTargetRange &&
    climate.targetTemperatureLow !== undefined &&
    climate.targetTemperatureHigh !== undefined;
  const now = climate.currentTemperature ?? null;
  const mode = climate.mode;
  const action = ACTIONS[climate.action];
  const isOff = mode === 'off';
  const tone: SheetTone = isOff
    ? 'muted'
    : action.tone === 'muted'
      ? MODES[mode].tone
      : action.tone;
  const decimals = step < 1 ? 1 : 0;
  const [whole, fraction] = target.shown.toFixed(decimals).split('.');
  const isSending = commander.busy.has('thermostat');
  const modes = params.supportedModes;
  const actionWord =
    climate.action === 'idle' && isRange
      ? t('entity.sheet.climate.idleInRange', 'Idle · in range')
      : text(action.word);
  const fanModes = params.fanModes;
  const fanLevels = fanModes.filter((name) => FAN_LEVELS.includes(name.toLowerCase()));
  const hasAutoFan = fanModes.some((name) => name.toLowerCase() === 'auto');
  const isFanBar =
    fanLevels.length > 0 && fanLevels.length + (hasAutoFan ? 1 : 0) === fanModes.length;

  /**
   * Sends one of the thermostat's commands.
   *
   * @param command - The command, with what it takes.
   */
  const send = (command: Record<string, string | number | null>): void => {
    commander.send('thermostat', command);
  };

  /**
   * Moves the target by steps, within the unit's range.
   *
   * @param steps - How many steps, up or down.
   */
  const nudge = (steps: number): void => {
    const next = Math.min(
      params.maxTemperature,
      Math.max(params.minTemperature, Math.round((target.shown + steps * step) / step) * step),
    );

    target.sent(next);
    send({ command: 'set_target', temperature: next });
  };

  /**
   * Moves one end of the range.
   *
   * @param end - Which end.
   * @param steps - How many steps.
   */
  const nudgeRange = (end: 'low' | 'high', steps: number): void => {
    const low = climate.targetTemperatureLow ?? params.minTemperature;
    const high = climate.targetTemperatureHigh ?? params.maxTemperature;
    const next = {
      low:
        end === 'low' ? Math.min(high, Math.max(params.minTemperature, low + steps * step)) : low,
      high:
        end === 'high' ? Math.max(low, Math.min(params.maxTemperature, high + steps * step)) : high,
    };

    send({ command: 'set_target_range', ...next });
  };

  const nowLine =
    now === null
      ? t('entity.sheet.climate.noRoomTemperature', 'No room temperature')
      : t('entity.sheet.climate.now', 'Now {{value}} {{unit}}', { value: now.toFixed(1), unit });
  const humidityLine =
    climate.humidity === undefined
      ? null
      : t('entity.sheet.climate.humidity', 'Humidity {{value}} %', {
          value: Math.round(climate.humidity),
        });

  return (
    <div className="flex grow flex-col justify-center gap-4.5">
      <div className="relative h-54 w-62 self-center">
        {isOff || isRange ? null : (
          <span
            aria-hidden="true"
            className={cn(
              'entity-breathe absolute top-11 left-11 size-40 rounded-full',
              GLOWS[tone],
            )}
          />
        )}
        <Dial
          min={params.minTemperature}
          max={params.maxTemperature}
          target={isRange ? null : target.shown}
          low={isRange ? (climate.targetTemperatureLow ?? null) : null}
          high={isRange ? (climate.targetTemperatureHigh ?? null) : null}
          now={now}
          tone={tone}
          label={
            isRange
              ? t('entity.sheet.climate.keepBetweenAria', 'Keep between {{low}} and {{high}}', {
                  low: climate.targetTemperatureLow,
                  high: climate.targetTemperatureHigh,
                })
              : t('entity.sheet.climate.setTo', 'Set to {{target}}', { target: target.shown })
          }
        />
        <div className="absolute inset-x-0 top-0 flex h-62 flex-col items-center justify-center gap-0.5">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 text-ui-sm font-medium',
              TONE_TEXT[isRange && climate.action === 'idle' ? 'success' : tone],
            )}
          >
            <AppIcon id={isOff ? 'power' : action.icon} size={14} />
            {isOff ? text(MODES.off.word) : actionWord}
            {isSending ? <SendingSpinner tone={tone} size={14} /> : null}
          </span>
          {isRange ? (
            <span className="flex items-baseline gap-2">
              <span className="text-[44px] font-medium tracking-[-0.04em] text-heat tabular">
                {climate.targetTemperatureLow}
              </span>
              <span className="text-[22px] text-foreground-subtle">–</span>
              <span className="text-[44px] font-medium tracking-[-0.04em] text-cyan tabular">
                {climate.targetTemperatureHigh}
              </span>
              <span className="text-title text-foreground-subtle">{unit}</span>
            </span>
          ) : (
            <span className={cn('flex items-start', isOff && 'text-foreground-subtle')}>
              <span className="text-[64px] leading-none font-medium tracking-[-0.05em] tabular">
                {whole}
              </span>
              {fraction === undefined ? null : (
                <span className="mt-1 text-[26px] font-medium text-foreground-muted tabular">
                  .{fraction}
                </span>
              )}
              <span className="mt-2 ml-1 text-subhead text-foreground-subtle">{unit}</span>
            </span>
          )}
          <span className="font-mono text-[10px] tracking-[0.08em] text-foreground-subtle uppercase">
            {isRange
              ? t('entity.sheet.climate.keepBetween', 'Keep between')
              : t('entity.sheet.climate.target', 'Target')}
          </span>
        </div>
      </div>

      {isRange ? (
        <>
          <div className="flex gap-2.5">
            {(['low', 'high'] as const).map((end) => (
              <div
                key={end}
                className="flex flex-1 flex-col gap-2 rounded-inner border border-border bg-well px-3 py-2.5"
              >
                <span className="flex justify-between text-caption text-foreground-subtle">
                  <span>
                    {end === 'low'
                      ? t('entity.sheet.climate.heatTo', 'Heat to')
                      : t('entity.sheet.climate.coolTo', 'Cool to')}
                  </span>
                  <span className={cn('font-mono', end === 'low' ? 'text-heat' : 'text-cyan')}>
                    {(end === 'low'
                      ? climate.targetTemperatureLow
                      : climate.targetTemperatureHigh
                    )?.toFixed(1)}
                  </span>
                </span>
                <div className="flex justify-between">
                  <RoundAction
                    icon="minus"
                    size="medium"
                    label={t('entity.sheet.climate.lower', 'Lower')}
                    disabled={disabled}
                    onClick={() => {
                      nudgeRange(end, -1);
                    }}
                  />
                  <RoundAction
                    icon="plus"
                    size="medium"
                    label={t('entity.sheet.climate.higher', 'Higher')}
                    disabled={disabled}
                    onClick={() => {
                      nudgeRange(end, 1);
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <span className="-mt-1 text-center text-ui-sm text-foreground-muted">
            {[nowLine, humidityLine].filter(Boolean).join(' · ')}
          </span>
        </>
      ) : (
        <div className="-mt-1.5 flex items-center justify-between gap-3">
          <RoundAction
            icon="minus"
            label={t('entity.sheet.climate.lower', 'Lower')}
            disabled={disabled || isOff}
            onClick={() => {
              nudge(-1);
            }}
          />
          <div className="flex flex-col items-center gap-0.75 text-center">
            <span className="text-title">{nowLine}</span>
            <span className="text-caption text-foreground-subtle">
              {now === null ? since : humidityLine}
            </span>
          </div>
          <RoundAction
            icon="plus"
            label={t('entity.sheet.climate.higher', 'Higher')}
            disabled={disabled || isOff}
            onClick={() => {
              nudge(1);
            }}
          />
        </div>
      )}

      <div
        role="radiogroup"
        aria-label={t('entity.sheet.climate.modeTitle', 'Mode')}
        className={cn(
          'grid gap-2',
          // Up to five on one row; six or seven on two.
          modes.length <= 5
            ? ['grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4', 'grid-cols-5'][
                modes.length - 1
              ]
            : modes.length === 6
              ? 'grid-cols-3'
              : 'grid-cols-4',
        )}
      >
        {modes.map((each) => {
          const look = MODES[each];
          const isChosen = each === mode;
          const lookTone = each === 'auto' && params.hasTargetRange ? 'success' : look.tone;

          return (
            <button
              key={each}
              type="button"
              role="radio"
              aria-checked={isChosen}
              disabled={disabled}
              onClick={() => {
                send({ command: 'set_mode', mode: each });
              }}
              className={cn(
                'flex h-15 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-inner border p-0',
                'disabled:cursor-not-allowed',
                isChosen
                  ? MODE_CHOSEN[lookTone]
                  : 'border-border bg-surface-raised/60 text-foreground-muted',
              )}
            >
              <AppIcon
                id={each === 'auto' && params.hasTargetRange ? 'sun-snow' : look.icon}
                size={18}
              />
              <span
                className={cn(
                  'text-caption',
                  isChosen ? 'font-medium text-foreground' : 'text-foreground-muted',
                )}
              >
                {each === 'auto' && params.hasTargetRange
                  ? t('entity.sheet.climate.modeHeatCool', 'Heat/Cool')
                  : text(look.word)}
              </span>
            </button>
          );
        })}
      </div>

      {params.hasTargetHumidity ? (
        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-ui">
            <span>{t('entity.sheet.climate.targetHumidity', 'Target humidity')}</span>
            <span className="font-mono text-mono-caption text-foreground-muted">
              {climate.humidity === undefined
                ? t('entity.sheet.climate.percentValue', '{{value}} %', {
                    value: Math.round(humidityTarget.shown),
                  })
                : t('entity.sheet.climate.humidityNow', '{{value}} % · now {{now}} %', {
                    value: Math.round(humidityTarget.shown),
                    now: Math.round(climate.humidity),
                  })}
            </span>
          </div>
          <ThinSlider
            label={t('entity.sheet.climate.targetHumidity', 'Target humidity')}
            value={Math.round(
              ((humidityTarget.shown - params.minHumidity) /
                Math.max(1, params.maxHumidity - params.minHumidity)) *
                100,
            )}
            fill="bg-primary"
            disabled={disabled}
            onChange={(next) => {
              humidityTarget.hold(
                params.minHumidity + (next / 100) * (params.maxHumidity - params.minHumidity),
              );
            }}
            onCommit={(next) => {
              const humidity = Math.round(
                params.minHumidity + (next / 100) * (params.maxHumidity - params.minHumidity),
              );

              humidityTarget.sent(humidity);
              send({ command: 'set_humidity', humidity });
            }}
          />
        </div>
      ) : null}

      {params.presets.length === 0 ? null : (
        <div className="flex flex-col gap-2.5">
          <BlockHead title={t('entity.sheet.climate.preset', 'Preset')} />
          <OptionList
            title={t('entity.sheet.climate.preset', 'Preset')}
            options={params.presets.map((value) => ({ value }))}
            value={climate.preset ?? null}
            tone={tone === 'muted' ? 'heat' : tone}
            disabled={disabled}
            onPick={(preset) => {
              send({ command: 'set_preset', preset });
            }}
          />
        </div>
      )}

      {fanModes.length === 0 ? null : (
        <div className="flex flex-col gap-2.5">
          <BlockHead title={t('entity.sheet.climate.fan', 'Fan')} />
          {isFanBar ? (
            <div className="flex gap-2">
              {hasAutoFan ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={climate.fanMode?.toLowerCase() === 'auto'}
                  disabled={disabled}
                  onClick={() => {
                    send({
                      command: 'set_fan_mode',
                      fanMode: fanModes.find((name) => name.toLowerCase() === 'auto') ?? 'auto',
                    });
                  }}
                  className={cn(
                    'inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-tile border px-3.5 text-caption font-medium',
                    climate.fanMode?.toLowerCase() === 'auto'
                      ? 'border-cyan/50 bg-cyan/12 text-cyan'
                      : 'border-border-strong bg-surface-raised text-foreground-muted',
                  )}
                >
                  <AppIcon id="refresh-cw" size={14} />
                  {t('entity.sheet.climate.auto', 'Auto')}
                </button>
              ) : null}
              <LevelSteps
                title={t('entity.sheet.climate.fan', 'Fan')}
                levels={fanLevels.map((value) => ({ value, label: value }))}
                value={climate.fanMode ?? null}
                tone="cyan"
                disabled={disabled}
                onPick={(fanMode) => {
                  send({ command: 'set_fan_mode', fanMode });
                }}
              />
            </div>
          ) : (
            <OptionList
              title={t('entity.sheet.climate.fan', 'Fan')}
              options={fanModes.map((value) => ({ value }))}
              value={climate.fanMode ?? null}
              tone="cyan"
              disabled={disabled}
              onPick={(fanMode) => {
                send({ command: 'set_fan_mode', fanMode });
              }}
            />
          )}
        </div>
      )}

      {(
        [
          ['swingModes', 'swingMode', 'set_swing', t('entity.sheet.climate.swing', 'Swing')],
          [
            'swingHorizontalModes',
            'swingHorizontalMode',
            'set_swing_horizontal',
            t('entity.sheet.climate.swingSide', 'Side to side'),
          ],
        ] as const
      ).map(([list, field, command, title]) =>
        params[list].length === 0 ? null : (
          <div key={list} className="flex flex-col gap-2.5">
            <BlockHead title={title} />
            <OptionList
              title={title}
              options={params[list].map((value) => ({ value }))}
              value={climate[field] ?? null}
              tone="cyan"
              hasIcons={false}
              isTinted
              disabled={disabled}
              onPick={(swingMode) => {
                send({ command, swingMode });
              }}
            />
          </div>
        ),
      )}
    </div>
  );
}
