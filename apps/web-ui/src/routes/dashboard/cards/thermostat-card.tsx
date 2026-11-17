/**
 * A thermostat: the room's temperature, what the thermostat is doing, and the target to move.
 *
 * The tall card is the room's temperature in large figures, the humidity beside "Now", and the
 * target under it as a stepper. The square card draws the target on a dial of ticks lit up to it,
 * with the head, the mode to choose, the stepper and how long it worked today on its right. A
 * heating thermostat takes the heat's colour at its edge, a cooling one the cool's.
 *
 * What it cannot do is not drawn, and what is left moves up (`K-Capabilities`): a thermostat with
 * one mode has no mode switch, only a line naming it; one whose target cannot be set reads its
 * target and mode as two rows of text; one without humidity drops it.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { JsonObject, StateHistoryPoint, THERMOSTAT_MODES } from '@nebulahome/contracts';
import { AppIcon, cn, IconButton, Pill, Segmented } from '@nebulahome/ui';

import { numberFormat } from '@/i18n/formatters';
import { defineMessage, text, type Message } from '@/i18n/messages';
import { paramsOf } from '@/library/entity-control';
import {
  BigValue,
  Caption,
  CardHead,
  CommandNote,
  NoAnswer,
} from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import {
  canUse,
  cardTime,
  sizeKey,
  type EntityCardModel,
} from '@/routes/dashboard/cards/entity-model';
import { hoursAndMinutes, onOffDay } from '@/routes/dashboard/cards/on-off-day';
import { useStateChanges, type CardHistory } from '@/routes/dashboard/cards/use-card-history';
import { climateLookOf } from '@/routes/library/entity/sheet/bodies/climate-body';
import { TONE_CHOSEN, TONE_SVG, type SheetTone } from '@/routes/library/entity/sheet/tones';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** One thermostat mode. */
type Mode = (typeof THERMOSTAT_MODES)[number];

/** Each mode in a word, as the entity dialog says it. */
const MODE_WORDS: Readonly<Record<Mode, Message>> = {
  off: defineMessage('entity.sheet.climate.modeOff', 'Off'),
  heat: defineMessage('entity.sheet.climate.modeHeat', 'Heat'),
  cool: defineMessage('entity.sheet.climate.modeCool', 'Cool'),
  auto: defineMessage('entity.sheet.climate.modeAuto', 'Auto'),
  fan_only: defineMessage('entity.sheet.climate.modeFan', 'Fan'),
  dry: defineMessage('entity.sheet.climate.modeDry', 'Dry'),
};

/** How many ticks the dial has, from the lowest target to the highest. */
const TICKS = 41;

/**
 * How a temperature is written.
 *
 * @returns The formatter, in the reader's language.
 */
const temperature = (): Intl.NumberFormat =>
  numberFormat({ minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * A thermostat's state as on or off - working, or not - so its day reads as a switch's does. A
 * state with no thermostat in it (a sample's day, written as switching) is kept as it is.
 *
 * @param state - As the history holds it.
 * @returns The state as on or off.
 */
function asOnOff(state: JsonObject | null): JsonObject | null {
  const thermostat = state?.['thermostat'];

  if (typeof thermostat !== 'object' || thermostat === null || Array.isArray(thermostat)) {
    return state;
  }

  const action = thermostat['action'];

  return { on_off: { isOn: action !== 'idle' && action !== 'off' } };
}

/**
 * How long a thermostat worked - heated, cooled, dried or ran its fan - over its last day.
 *
 * @param history - Its changes over the day.
 * @param entity - The entity, for its state before the first change.
 * @param entity.state - That state.
 * @param isAvailable - Whether it can be reached now.
 * @returns The time, in milliseconds.
 */
function workedMs(
  history: CardHistory<StateHistoryPoint>,
  entity: { readonly state: JsonObject | null },
  isAvailable: boolean,
): number {
  const points = history.points.map((point) => ({
    ...point,
    state: asOnOff(point.state) ?? {},
    previousState: asOnOff(point.previousState),
  }));

  return onOffDay({ window: history.window, points }, { state: asOnOff(entity.state) }, isAvailable)
    .onMs;
}

/**
 * Renders the dial: 41 ticks round 270°, lit up to the target, a dot at it, and what is written
 * in the middle.
 *
 * @param props - The dial.
 * @param props.share - Where the target is, from 0 at the lowest to 1 at the highest.
 * @param props.tone - The colour of the lit ticks; null for none lit, a thermostat that is off.
 * @param props.children - What the middle says.
 * @returns The dial.
 */
function Dial(props: {
  readonly share: number;
  readonly tone: SheetTone | null;
  readonly children: ReactNode;
}) {
  const { share, tone, children } = props;
  const lit = Math.round(share * (TICKS - 1));

  /**
   * A point on a circle round the dial's centre.
   *
   * @param degrees - The angle, clockwise from the right.
   * @param radius - How far out.
   * @returns The point, to one decimal.
   */
  const at = (degrees: number, radius: number) => ({
    x: (94 + radius * Math.cos((degrees * Math.PI) / 180)).toFixed(1),
    y: (94 + radius * Math.sin((degrees * Math.PI) / 180)).toFixed(1),
  });
  const knob = at(135 + share * 270, 91);

  return (
    <div className="relative size-47 shrink-0">
      <svg viewBox="0 0 188 188" className="size-full" aria-hidden="true">
        {[...Array.from({ length: TICKS }).keys()].map((index) => {
          const degrees = 135 + (index * 270) / (TICKS - 1);
          const outer = at(degrees, 85);
          // Every fifth tick is long.
          const inner = at(degrees, index % 5 === 0 ? 77 : 81);

          return (
            <line
              key={index}
              x1={outer.x}
              y1={outer.y}
              x2={inner.x}
              y2={inner.y}
              strokeWidth="2"
              strokeLinecap="round"
              className={cn(
                'transition-colors duration-200',
                tone !== null && index <= lit ? TONE_SVG[tone].stroke : 'stroke-border-strong',
              )}
            />
          );
        })}
        {tone === null ? null : (
          <circle cx={knob.x} cy={knob.y} r="3" className="fill-foreground" />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
        {children}
      </div>
    </div>
  );
}

/**
 * Renders the target as a stepper: lower, the target, raise.
 *
 * @param props - The stepper.
 * @param props.value - The target, written.
 * @param props.disabled - Whether it can be moved.
 * @param props.onStep - When a button is pressed, with its direction.
 * @returns The stepper.
 */
function Stepper(props: {
  readonly value: string;
  readonly disabled: boolean;
  readonly onStep: (direction: -1 | 1) => void;
}) {
  const { t } = useTranslation();

  const { value, disabled, onStep } = props;
  const button = 'size-7 text-foreground';

  return (
    <div
      className={cn(
        'flex h-9 shrink-0 items-center justify-between gap-2 rounded-tile bg-surface-raised px-1 transition-opacity duration-200',
        disabled && 'opacity-40',
      )}
    >
      <IconButton
        variant="raised"
        label={t('dashboard.cards.thermostatCard.lowerTheTarget', 'Lower the target')}
        className={button}
        disabled={disabled}
        onClick={() => {
          onStep(-1);
        }}
      >
        <AppIcon id="minus" size={14} />
      </IconButton>
      <span className="text-[22px] font-medium tracking-[-0.02em] tabular-nums">{value}</span>
      <IconButton
        variant="raised"
        label={t('dashboard.cards.thermostatCard.raiseTheTarget', 'Raise the target')}
        className={button}
        disabled={disabled}
        onClick={() => {
          onStep(1);
        }}
      >
        <AppIcon id="plus" size={14} />
      </IconButton>
    </div>
  );
}

/**
 * Renders one row of text with a line above it: a target or a mode read, not set.
 *
 * @param props - The row.
 * @param props.label - What it is.
 * @param props.children - Its value.
 * @returns The row.
 */
function ReadRow(props: { readonly label: string; readonly children: ReactNode }) {
  const { label, children } = props;

  return (
    <div className="flex min-w-0 items-center justify-between gap-2.5 border-t border-border py-1.25">
      <Caption className="text-foreground-muted">{label}</Caption>
      {children}
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
  const { t } = useTranslation();

  const { model } = props;
  const { entity, state, title, command, hidden } = model;
  const key = sizeKey(model.size);
  const thermostat = state.thermostat;
  const params = paramsOf(entity, 'thermostat');
  const reported = thermostat?.targetTemperature ?? null;
  const target = usePendingValue(reported, model.reportedAt);
  const mode = usePendingValue<Mode | null>(thermostat?.mode ?? null, model.reportedAt);
  const history = useStateChanges(
    entity.entityId,
    '24h',
    key === '2x2' && model.canReadHistory && !hidden.has('day'),
  );

  const min = params?.minTemperature ?? 5;
  const max = params?.maxTemperature ?? 35;
  const step = params?.temperatureStep ?? 0.5;
  const unit = entity.unitOfMeasurement ?? '°C';
  const modes = params?.supportedModes ?? [];
  // A target that cannot move - a range of one value - only reads (`K-Capabilities`).
  const isReadOnly = !model.canControl || params === null || max <= min;
  // A command left unanswered puts the target back where the device has it.
  const shown = command.hasFailed ? reported : target.shown;
  const now = thermostat?.currentTemperature;
  const humidity =
    thermostat?.humidity === undefined || hidden.has('humidity') ? null : thermostat.humidity;
  const look = thermostat === undefined ? null : climateLookOf(thermostat);
  const tone: SheetTone = look?.tone ?? 'muted';
  const isOff = thermostat?.mode === 'off';
  const isWorking =
    thermostat !== undefined &&
    !isOff &&
    thermostat.action !== 'idle' &&
    thermostat.action !== 'off';
  const glow =
    isWorking && !model.isOffline && tone !== 'muted' ? `var(--color-${tone})` : undefined;
  const lastSeen =
    model.changedAt === null
      ? t('dashboard.cards.kit.unreachable', 'Not reachable')
      : t('dashboard.cards.kit.lastSeen', 'last seen {{time}}', {
          time: cardTime(model.changedAt),
        });

  /**
   * Writes a temperature, or a dash before there is one.
   *
   * @param value - The temperature.
   * @param after - What follows it: "°", " °C".
   * @returns The temperature, written.
   */
  const degrees = (value: number | null | undefined, after: string): string =>
    value === null || value === undefined ? '—' : `${temperature().format(value)}${after}`;

  /**
   * Moves the target one step.
   *
   * @param direction - Down or up.
   */
  const nudge = (direction: -1 | 1): void => {
    const from = shown ?? (min + max) / 2;
    const next = Math.min(max, Math.max(min, Math.round((from + direction * step) / step) * step));

    target.sent(next);
    command.send('thermostat', { command: 'set_target', temperature: next });
  };

  const pill =
    look === null ? undefined : (
      <Pill
        className={cn(
          tone === 'muted' ? 'bg-surface-raised text-foreground-muted' : TONE_CHOSEN[tone],
          'border-border-strong *:bg-current',
        )}
      >
        {text(look.word)}
      </Pill>
    );
  // A cooling thermostat's chip is cool: the cyan the sensors are drawn in.
  const head = (
    <CardHead
      model={tone === 'cyan' ? { ...model, kind: { ...model.kind, tone: 'sensor' } } : model}
      isActive={thermostat === undefined ? null : !isOff}
      tail={pill}
    />
  );
  const sending = t('dashboard.cards.thermostatCard.setting', 'Setting…');
  const targetWord = t('dashboard.cards.thermostatCard.target', 'Target');
  /**
   * The target as a stepper.
   *
   * @param after - What follows the figure: "°" on the tall card, " °C" on the square one.
   * @returns The stepper.
   */
  const stepper = (after: string) => (
    <Stepper value={degrees(shown, after)} disabled={!canUse(model, 'thermostat')} onStep={nudge} />
  );
  const modeWord = mode.shown === null ? '—' : text(MODE_WORDS[mode.shown]);
  const readRows = (
    <div>
      <ReadRow label={targetWord}>
        <Caption className="text-foreground">{degrees(reported, '°')}</Caption>
      </ReadRow>
      <ReadRow label={t('dashboard.cards.thermostatCard.mode', 'Mode')}>
        {model.canControl ? (
          <Caption>
            {t('dashboard.cards.thermostatCard.setOnDevice', '{{mode}} · set on the device', {
              mode: modeWord,
            })}
          </Caption>
        ) : (
          pill
        )}
      </ReadRow>
    </div>
  );

  if (key !== '2x2') {
    return (
      <CardFrame label={title} glow={glow}>
        {head}
        <div className="mt-3.5 flex flex-col gap-1.5">
          <BigValue
            value={degrees(now, '')}
            unit={now === undefined ? undefined : unit}
            size={now === undefined ? 22 : 36}
            className={model.isOffline || now === undefined ? 'text-foreground-subtle' : undefined}
          />
          {model.isOffline ? (
            <Caption>{lastSeen}</Caption>
          ) : thermostat === undefined ? (
            <Caption>{t('dashboard.cards.kit.waitingForDevice', 'Waiting for the device')}</Caption>
          ) : (
            <span className="flex gap-3">
              <Caption>{t('dashboard.cards.thermostatCard.now', 'Now')}</Caption>
              {humidity === null ? null : (
                <Caption className="inline-flex items-center gap-1.25 text-foreground-subtle">
                  <AppIcon id="droplet" size={12} />
                  {`${String(Math.round(humidity))}%`}
                </Caption>
              )}
            </span>
          )}
        </div>
        <div className="grow" />
        {isReadOnly ? (
          readRows
        ) : (
          <div className="flex flex-col gap-1.5">
            {command.hasFailed ? (
              <span className="inline-flex min-w-0 animate-rise items-center gap-1.5 text-caption text-danger">
                <AppIcon id="triangle-alert" size={12} />
                <span className="truncate">
                  {t('dashboard.cards.kit.whatDidNotAnswer', '{{what}} · did not answer', {
                    what: t('dashboard.cards.thermostatCard.targetNotSet', 'Target not set'),
                  })}
                </span>
              </span>
            ) : (
              <CommandNote command={command} sending={sending}>
                <Caption>{targetWord}</Caption>
              </CommandNote>
            )}
            {stepper('°')}
          </div>
        )}
      </CardFrame>
    );
  }

  const share =
    shown === null || max <= min ? 0 : Math.min(1, Math.max(0, (shown - min) / (max - min)));
  const worked = history === undefined ? null : workedMs(history, entity, !model.isOffline);
  const modeSwitch = hidden.has('modes') ? null : modes.length > 1 ? (
    <Segmented
      label={t('dashboard.cards.thermostatCard.mode', 'Mode')}
      options={modes.map((value) => ({ value, label: text(MODE_WORDS[value]) }))}
      value={mode.shown ?? modes[0] ?? 'off'}
      disabled={!canUse(model, 'thermostat')}
      isFilled
      onChange={(next) => {
        mode.sent(next);
        command.send('thermostat', { command: 'set_mode', mode: next });
      }}
    />
  ) : modes.length === 1 ? (
    <div className="flex min-w-0 items-center justify-between gap-2.5">
      <Caption>{targetWord}</Caption>
      <Caption>
        {t('dashboard.cards.thermostatCard.modeOnly', '{{mode}} only', { mode: modeWord })}
      </Caption>
    </div>
  ) : null;

  return (
    <CardFrame label={title} glow={glow}>
      <div className="flex min-h-0 grow items-center gap-5.5">
        <div className="-my-1 -ml-1">
          <Dial
            share={share}
            tone={thermostat === undefined || isOff || model.isOffline ? null : tone}
          >
            <CommandNote command={command} sending={sending}>
              <span className="text-caption text-foreground-subtle">{targetWord}</span>
            </CommandNote>
            <BigValue
              value={isOff ? text(MODE_WORDS.off) : degrees(shown, '')}
              unit={isOff || shown === null ? undefined : '°'}
              size={40}
              className={model.isOffline || shown === null ? 'text-foreground-subtle' : undefined}
            />
            <span className="text-caption text-foreground-muted tabular-nums">
              {model.isOffline
                ? lastSeen
                : t('dashboard.cards.thermostatCard.nowValue', 'Now {{value}}', {
                    value: degrees(now, '°'),
                  })}
            </span>
          </Dial>
        </div>
        <div className="flex min-w-0 grow flex-col gap-2.5">
          {head}
          {isReadOnly ? (
            readRows
          ) : (
            <div className="flex flex-col gap-2.5">
              {modeSwitch}
              {stepper(` ${unit}`)}
            </div>
          )}
          {command.hasFailed ? (
            <NoAnswer command={command} />
          ) : humidity === null && worked === null ? null : (
            <div className="flex justify-between gap-2.5">
              {humidity === null ? (
                <span />
              ) : (
                <Caption className="inline-flex items-center gap-1.25 text-foreground-subtle">
                  <AppIcon id="droplet" size={12} />
                  {t('dashboard.cards.thermostatCard.humidityHumidity', 'Humidity {{humidity}}%', {
                    humidity: String(Math.round(humidity)),
                  })}
                </Caption>
              )}
              {worked === null ? null : (
                <Caption className="inline-flex items-center gap-1.25 text-foreground-subtle">
                  <AppIcon id="flame" size={12} />
                  {t('dashboard.cards.thermostatCard.onToday', 'On {{time}} today', {
                    time: hoursAndMinutes(worked),
                  })}
                </Caption>
              )}
            </div>
          )}
        </div>
      </div>
    </CardFrame>
  );
}
