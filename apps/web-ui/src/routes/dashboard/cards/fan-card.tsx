/**
 * A fan: whether it turns, how fast, the preset it runs, its swing and its direction (`K-New`, Fan).
 *
 * Drawn as a light is: a fan that turns takes cyan at its edge. The tile is the switch and the
 * speed in figures; the tall card adds the presets and the speed as a bar to slide, or its speeds
 * as a row of choices when it has a few; the square puts the figures beside them, with Swing and
 * Reverse as round buttons under the figures.
 *
 * What the fan cannot do is not drawn, and what is left moves up: one that only switches is a
 * switch, with the round power button and its day on the tall card, and no square.
 */
import { useTranslation } from 'react-i18next';

import { AppIcon, cn, type UiIconId } from '@nebulahome/ui';

import { fanOnlySwitches } from '@/dashboard/card-sizes';
import { translate } from '@/i18n/messages';
import { hasCapability, paramsOf, powerCommand } from '@/library/entity-control';
import {
  BarSlider,
  BigValue,
  Caption,
  CardHead,
  CardSwitch,
  CommandNote,
  DayBlocks,
  forHowLong,
  NoAnswer,
  PowerButton,
} from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import {
  canUse,
  cardTime,
  sizeKey,
  type EntityCardModel,
} from '@/routes/dashboard/cards/entity-model';
import { hoursAndMinutes, onOffDay } from '@/routes/dashboard/cards/on-off-day';
import { useStateChanges } from '@/routes/dashboard/cards/use-card-history';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** What a fan that turns is lit in. */
const CYAN = 'var(--color-cyan)';

/** From this many speeds on, the speed is a percentage on a bar; under it, a row of choices. */
const PERCENT_SPEEDS = 10;

/**
 * A speed's name: Low, Medium, High for a fan of two or three, its number for more.
 *
 * @param step - The speed, from 1.
 * @param count - How many the fan has.
 * @returns "Medium", "Speed 4".
 */
function speedName(step: number, count: number): string {
  const names =
    count === 2
      ? [
          translate('dashboard.cards.fanCard.low', 'Low'),
          translate('dashboard.cards.fanCard.high', 'High'),
        ]
      : count === 3
        ? [
            translate('dashboard.cards.fanCard.low', 'Low'),
            translate('dashboard.cards.fanCard.medium', 'Medium'),
            translate('dashboard.cards.fanCard.high', 'High'),
          ]
        : [];

  return (
    names[step - 1] ?? translate('dashboard.cards.fanCard.speedNumber', 'Speed {{n}}', { n: step })
  );
}

/** One choice of a row of them. */
type Choice = { readonly value: string; readonly label: string };

/**
 * Renders a row of choices in a pill, the chosen one raised: a fan's presets, or its speeds.
 *
 * @param props - The choices.
 * @param props.label - What they choose, for a screen reader.
 * @param props.choices - See {@link Choice}.
 * @param props.chosen - The one the fan is on, or null.
 * @param props.disabled - Whether they can be chosen.
 * @param props.onChoose - When one is chosen.
 * @returns The row.
 */
function ChoiceRow(props: {
  readonly label: string;
  readonly choices: readonly Choice[];
  readonly chosen: string | null;
  readonly disabled: boolean;
  readonly onChoose: (value: string) => void;
}) {
  const { label, choices, chosen, disabled, onChoose } = props;

  // shortcut: every choice in one row, cramped past four or five; a dropdown when fans need more.
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'flex shrink-0 gap-1 rounded-pill border border-border-strong bg-surface p-1 transition-opacity duration-200',
        disabled && 'opacity-40',
      )}
    >
      {choices.map((choice) => {
        const isChosen = choice.value === chosen;

        return (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={isChosen}
            disabled={disabled}
            className={cn(
              'flex h-7 min-w-0 flex-1 items-center justify-center truncate rounded-pill px-1.5 text-ui-sm whitespace-nowrap',
              'transition-colors duration-200 disabled:cursor-default',
              isChosen
                ? 'bg-surface-high font-medium text-foreground'
                : 'text-foreground-muted hover:enabled:text-foreground',
            )}
            onClick={() => {
              if (!isChosen) {
                onChoose(choice.value);
              }
            }}
          >
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Renders a 34 px round button that turns something on and off: Swing, Reverse.
 *
 * @param props - The button.
 * @param props.label - What it does.
 * @param props.icon - Its glyph.
 * @param props.isOn - Whether what it turns is on: it is then ringed in the accent.
 * @param props.disabled - Whether it can be pressed.
 * @param props.onPress - When pressed.
 * @returns The button.
 */
function ToggleButton(props: {
  readonly label: string;
  readonly icon: UiIconId;
  readonly isOn: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const { label, icon, isOn, disabled, onPress } = props;

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isOn}
      title={label}
      disabled={disabled}
      className={cn(
        'press-scale inline-flex size-8.5 shrink-0 items-center justify-center rounded-pill border text-foreground',
        'transition-colors duration-200 disabled:cursor-default disabled:opacity-40',
        isOn
          ? 'border-primary/60 bg-primary/12'
          : 'border-border-strong bg-surface-raised hover:enabled:bg-surface-high',
      )}
      onClick={onPress}
    >
      <AppIcon id={icon} size={15} />
    </button>
  );
}

/**
 * Renders a fan card at its size.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function FanCard(props: { readonly model: EntityCardModel }) {
  const { t } = useTranslation();

  const { model } = props;
  const { entity, state, reportedAt, title, command, hidden } = model;
  const key = sizeKey(model.size);
  const params = paramsOf(entity, 'fan');
  const count = params?.speedCount ?? 0;
  const presets = params?.presets ?? [];
  const onlySwitches = fanOnlySwitches(entity);
  const hasOnOff = hasCapability(entity, 'on_off');
  const percentage = usePendingValue(state.fan?.percentage ?? 0, reportedAt);
  const preset = usePendingValue(state.fan?.preset ?? null, reportedAt);
  // Only a fan that only switches draws its day: the tall card has room for nothing else.
  const day = useStateChanges(
    entity.entityId,
    '24h',
    onlySwitches && key === '1x2' && model.canReadHistory && !hidden.has('day'),
  );

  const isOn = state.on_off?.isOn ?? (state.fan?.percentage ?? 0) > 0;
  const hasValue = state.on_off !== undefined || state.fan?.percentage !== undefined;
  const shown = Math.round(percentage.shown);
  const step = count > 0 ? Math.round((shown / 100) * count) : 0;
  const isPercent = count >= PERCENT_SPEEDS;
  const isOscillating = state.fan?.isOscillating === true;
  const isReverse = state.fan?.direction === 'reverse';
  const showsPresets = presets.length > 0 && model.canControl && !hidden.has('presets');
  const glow = isOn ? CYAN : undefined;
  // The boards draw a fan in cyan, as the entity sheet does; the library's family is the heat's.
  const look: EntityCardModel = { ...model, kind: { ...model.kind, tone: 'sensor' } };

  /**
   * The line beside the speed: its preset and swing, or how long it has been on or off.
   *
   * @param order - What a size says: preset and swing on a tile, the swing on a tall card (its
   *   presets are in sight), preset and direction on a square (its swing is a button).
   * @returns The line.
   */
  const caption = (order: 'tile' | 'card' | 'square'): string => {
    if (model.isOffline) {
      return model.changedAt === null
        ? t('dashboard.cards.kit.unreachable', 'Not reachable')
        : t('dashboard.cards.kit.lastSeen', 'last seen {{time}}', {
            time: cardTime(model.changedAt),
          });
    }

    if (!hasValue) {
      return t('dashboard.cards.kit.waitingForDevice', 'Waiting for the device');
    }

    if (!isOn) {
      return model.changedAt === null
        ? ''
        : t('dashboard.cards.fanCard.since', 'since {{time}}', {
            time: cardTime(model.changedAt),
          });
    }

    // A fan with no speeds shows its preset as the figure: the line does not say it twice.
    const named =
      count > 0 && preset.shown !== null && (order !== 'card' || !showsPresets)
        ? [preset.shown]
        : [];
    const swing =
      order !== 'square' && isOscillating ? [t('dashboard.cards.fanCard.swingOn', 'swing on')] : [];
    const direction =
      order === 'square' && params?.canReverse === true
        ? [
            isReverse
              ? t('dashboard.cards.fanCard.reverse', 'reverse')
              : t('dashboard.cards.fanCard.forward', 'forward'),
          ]
        : [];
    const parts = [...named, ...swing, ...direction];

    return parts.length > 0
      ? parts.join(' · ')
      : model.changedAt === null
        ? ''
        : forHowLong(model.changedAt);
  };

  /**
   * The fan's figure: its speed in percent, its speed's name, its preset, or On and Off.
   *
   * @param size - How large a percentage is written; a word is written a step smaller.
   * @returns The figure.
   */
  const figure = (size: 26 | 36 | 40) => {
    const wordSize = size === 26 ? 22 : 30;
    const dim = model.isOffline ? 'text-foreground-subtle' : undefined;

    if (!hasValue) {
      return <BigValue value="—" size={22} className="text-foreground-subtle" />;
    }

    if (!isOn) {
      return (
        <BigValue
          value={t('dashboard.cards.fanCard.off', 'Off')}
          size={wordSize}
          className="text-foreground-subtle"
        />
      );
    }

    if (isPercent) {
      return <BigValue value={String(shown)} unit="%" size={size} className={dim} />;
    }

    return (
      <BigValue
        value={
          count > 0
            ? speedName(Math.max(1, step), count)
            : (preset.shown ?? t('dashboard.cards.fanCard.on', 'On'))
        }
        size={wordSize}
        className={dim}
      />
    );
  };

  const sending = isOn
    ? t('dashboard.cards.fanCard.turningOff', 'Turning off…')
    : t('dashboard.cards.fanCard.turningOn', 'Turning on…');
  const head = (
    <CardHead
      model={look}
      isActive={isOn}
      tail={hasOnOff ? <CardSwitch model={model} /> : undefined}
    />
  );

  if (key === '1x1') {
    return (
      <CardFrame label={title} glow={glow}>
        {head}
        <div className="grow" />
        {command.hasFailed ? (
          <NoAnswer command={command} />
        ) : (
          <div className="flex min-w-0 items-end justify-between gap-2.5">
            {figure(26)}
            <CommandNote command={command} sending={sending}>
              <Caption>{caption('tile')}</Caption>
            </CommandNote>
          </div>
        )}
      </CardFrame>
    );
  }

  // Something that only switches: the round button and its day.
  if (onlySwitches) {
    const today = day === undefined ? undefined : onOffDay(day, entity, !model.isOffline);

    return (
      <CardFrame label={title} glow={glow}>
        {/* The power button is the switch here; the head keeps the toggle only to show the eye. */}
        <CardHead
          model={look}
          isActive={isOn}
          tail={model.canControl || !hasOnOff ? undefined : <CardSwitch model={model} />}
        />
        <div className="mt-3.5 flex min-w-0 items-center justify-between gap-2.5">
          <div className="flex min-w-0 flex-col gap-1.5">
            {figure(36)}
            <CommandNote command={command} sending={sending}>
              <Caption>{caption('card')}</Caption>
            </CommandNote>
          </div>
          {model.canControl && hasOnOff ? (
            <PowerButton
              isOn={isOn}
              color={CYAN}
              label={
                isOn
                  ? t('dashboard.cards.fanCard.turnOff', 'Turn off')
                  : t('dashboard.cards.fanCard.turnOn', 'Turn on')
              }
              disabled={!canUse(model, 'on_off')}
              onPress={() => {
                command.send('on_off', powerCommand(!isOn));
              }}
            />
          ) : null}
        </div>
        <div className="grow" />
        {command.hasFailed ? (
          <NoAnswer command={command} />
        ) : today === undefined ? null : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2.5">
              <Caption>{t('dashboard.cards.fanCard.today', 'Today')}</Caption>
              <Caption className="text-foreground-muted">
                {t('dashboard.cards.fanCard.onFor', 'On {{time}}', {
                  time: hoursAndMinutes(today.onMs),
                })}
              </Caption>
            </div>
            <DayBlocks
              hours={today.hours}
              color={CYAN}
              label={t('dashboard.cards.fanCard.lastDay', 'The last 24 hours')}
            />
          </div>
        )}
      </CardFrame>
    );
  }

  const canSet = canUse(model, 'fan');

  /**
   * Sets the speed, in percent: none switches the fan off.
   *
   * @param next - The speed.
   */
  const setSpeed = (next: number): void => {
    if (next <= 0 && hasOnOff) {
      command.send('on_off', powerCommand(false));

      return;
    }

    percentage.sent(next);
    command.send('fan', { command: 'set_percentage', percentage: next });
  };

  const presetRow = showsPresets ? (
    <ChoiceRow
      label={t('dashboard.cards.fanCard.preset', 'Preset')}
      choices={presets.map((name) => ({ value: name, label: name }))}
      chosen={isOn ? preset.shown : null}
      disabled={!canSet}
      onChoose={(next) => {
        preset.sent(next);
        command.send('fan', { command: 'set_preset', preset: next });
      }}
    />
  ) : null;
  const speed = !model.canControl ? null : isPercent ? (
    <BarSlider
      label={t('dashboard.cards.fanCard.speed', 'Speed')}
      icon="fan"
      value={isOn ? shown : 0}
      step={Math.max(1, Math.round(100 / count))}
      display={key === '2x2' ? `${String(isOn ? shown : 0)}%` : undefined}
      look={{ fill: CYAN }}
      disabled={!canSet}
      onChange={percentage.hold}
      onCommit={setSpeed}
    />
  ) : count > 0 ? (
    <ChoiceRow
      label={t('dashboard.cards.fanCard.speed', 'Speed')}
      choices={[...Array.from({ length: count }).keys()].map((index) => ({
        value: String(index + 1),
        label: speedName(index + 1, count),
      }))}
      chosen={isOn && step > 0 ? String(step) : null}
      disabled={!canSet}
      onChoose={(next) => {
        setSpeed(Math.round((Number(next) * 100) / count));
      }}
    />
  ) : null;
  const controls = command.hasFailed ? (
    <NoAnswer command={command} />
  ) : (
    <>
      {presetRow}
      {speed}
    </>
  );

  if (key === '2x2') {
    const canSwing = params?.canOscillate === true && model.canControl;
    const canReverse = params?.canReverse === true && model.canControl;

    return (
      <CardFrame label={title} glow={glow}>
        {head}
        <div className="mt-4 flex min-h-0 grow gap-5">
          <div className="flex w-[190px] shrink-0 flex-col gap-1.5">
            {figure(40)}
            <CommandNote command={command} sending={sending}>
              <Caption>{caption('square')}</Caption>
            </CommandNote>
            {canSwing || canReverse ? (
              <div className="mt-auto flex gap-1.5">
                {canSwing ? (
                  <ToggleButton
                    label={t('dashboard.cards.fanCard.swing', 'Swing')}
                    icon="repeat"
                    isOn={isOscillating}
                    disabled={!canSet}
                    onPress={() => {
                      command.send('fan', {
                        command: 'set_oscillating',
                        isOscillating: !isOscillating,
                      });
                    }}
                  />
                ) : null}
                {canReverse ? (
                  <ToggleButton
                    label={t('dashboard.cards.fanCard.reverseDirection', 'Reverse direction')}
                    icon="refresh-cw"
                    isOn={isReverse}
                    disabled={!canSet}
                    onPress={() => {
                      command.send('fan', {
                        command: 'set_direction',
                        direction: isReverse ? 'forward' : 'reverse',
                      });
                    }}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex min-w-0 grow flex-col justify-end gap-2.5">{controls}</div>
        </div>
      </CardFrame>
    );
  }

  return (
    <CardFrame label={title} glow={glow}>
      {head}
      {isPercent ? (
        <div className="mt-4 flex min-w-0 items-baseline justify-between gap-2.5">
          {figure(36)}
          <CommandNote command={command} sending={sending}>
            <Caption>{caption('card')}</Caption>
          </CommandNote>
        </div>
      ) : (
        <div className="mt-4 flex min-w-0 flex-col gap-1.5">
          {figure(36)}
          <CommandNote command={command} sending={sending}>
            <Caption>{caption('card')}</Caption>
          </CommandNote>
        </div>
      )}
      <div className="grow" />
      <div className="flex flex-col gap-2">{controls}</div>
    </CardFrame>
  );
}
