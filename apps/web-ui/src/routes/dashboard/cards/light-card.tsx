/**
 * A light: whether it is on, how bright, and the white or the colour it is making.
 *
 * A lit card takes the light's own colour at its edge - a lamp's warmth while it makes a white,
 * the colour itself while it makes one - and an off light keeps the same silhouette, grey. The
 * tile is the switch and the brightness in figures; the tall card adds the presets and the
 * brightness as a bar to slide; the square card puts the figures beside the bars, white or colour
 * under the brightness.
 *
 * What the light cannot do is not drawn, and what is left moves up (`K-Capabilities`): a light
 * that only switches is a switch, with the round power button and its day on the tall card; one
 * that only dims has no presets and no second bar; one without colour has no presets.
 */
import { useTranslation } from 'react-i18next';

import type { CapabilityState } from '@nebulahome/contracts';

import { translate } from '@/i18n/messages';
import {
  hasCapability,
  hsColor,
  hueGradient,
  kelvinToMireds,
  miredsToKelvin,
  paramsOf,
  powerCommand,
  warmthGradient,
} from '@/library/entity-control';
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
  Swatches,
  type Swatch,
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

/** How far one step of the white bar moves, in kelvin. */
const STEP_KELVIN = 50;

/** A lamp's own warmth: what a light making a white is lit in. */
const LAMP = 'var(--color-lamp)';

/** A preset: a white, by its kelvin, or a colour, by its hue and saturation. */
type Preset =
  | { readonly id: string; readonly color: string; readonly kelvin: number }
  | {
      readonly id: string;
      readonly color: string;
      readonly hue: number;
      readonly saturation: number;
    };

/** The presets a light with colour offers: two whites, then four colours. */
const PRESETS: readonly Preset[] = [
  { id: 'warm', color: '#ffd9a0', kelvin: 2700 },
  { id: 'daylight', color: '#fff4e0', kelvin: 4000 },
  { id: 'coral', color: '#ff8a6b', hue: 12, saturation: 58 },
  { id: 'indigo', color: '#7c86ff', hue: 235, saturation: 51 },
  { id: 'cyan', color: '#4fd0ee', hue: 191, saturation: 66 },
  { id: 'green', color: '#52cd86', hue: 145, saturation: 60 },
];

/**
 * What a preset is called, for a screen reader and its tooltip.
 *
 * @param id - The preset.
 * @returns Its name.
 */
function presetName(id: string): string {
  switch (id) {
    case 'warm':
      return translate('dashboard.cards.lightCard.presetWarm', 'Warm white');
    case 'daylight':
      return translate('dashboard.cards.lightCard.presetDaylight', 'Daylight');
    case 'coral':
      return translate('dashboard.cards.lightCard.presetCoral', 'Coral');
    case 'indigo':
      return translate('dashboard.cards.lightCard.presetIndigo', 'Indigo');
    case 'cyan':
      return translate('dashboard.cards.lightCard.presetCyan', 'Cyan');
    default:
      return translate('dashboard.cards.lightCard.presetGreen', 'Green');
  }
}

/**
 * A hue's name in a word, for the caption of a light making a colour.
 *
 * @param hue - The hue, 0 to 360.
 * @returns "Indigo", "Coral"…
 */
function hueName(hue: number): string {
  const names: readonly (readonly [number, string])[] = [
    [15, translate('dashboard.cards.lightCard.hueRed', 'Red')],
    [40, translate('dashboard.cards.lightCard.hueOrange', 'Orange')],
    [70, translate('dashboard.cards.lightCard.hueYellow', 'Yellow')],
    [160, translate('dashboard.cards.lightCard.hueGreen', 'Green')],
    [200, translate('dashboard.cards.lightCard.hueCyan', 'Cyan')],
    [225, translate('dashboard.cards.lightCard.hueBlue', 'Blue')],
    [255, translate('dashboard.cards.lightCard.hueIndigo', 'Indigo')],
    [290, translate('dashboard.cards.lightCard.hueViolet', 'Violet')],
    [340, translate('dashboard.cards.lightCard.huePink', 'Pink')],
  ];

  return (
    names.find(([upTo]) => hue < upTo)?.[1] ?? translate('dashboard.cards.lightCard.hueRed', 'Red')
  );
}

/**
 * A white's warmth in a word.
 *
 * @param kelvin - The white.
 * @returns "Warm", "Neutral" or "Cool".
 */
function warmthName(kelvin: number): string {
  if (kelvin < 3300) {
    return translate('dashboard.cards.lightCard.warm', 'Warm');
  }

  return kelvin < 5000
    ? translate('dashboard.cards.lightCard.neutral', 'Neutral')
    : translate('dashboard.cards.lightCard.cool', 'Cool');
}

/** What a light is making, as the card shows it. */
type Making =
  | { readonly kind: 'white'; readonly kelvin: number }
  | { readonly kind: 'colour'; readonly hue: number; readonly saturation: number }
  | { readonly kind: 'plain' };

/**
 * What a light is making: a colour when it makes one, else its white, else nothing to name.
 *
 * @param state - Its state, as the card shows it.
 * @returns What it makes.
 */
function makingOf(state: CapabilityState): Making {
  const { color_hs: colour, color_temp: white } = state;

  if (colour !== undefined && colour.saturation > 0 && colour.isActive !== false) {
    return { kind: 'colour', hue: colour.hue, saturation: colour.saturation };
  }

  return white === undefined
    ? { kind: 'plain' }
    : { kind: 'white', kelvin: miredsToKelvin(white.mireds) };
}

/**
 * Renders a light card at its size.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function LightCard(props: { readonly model: EntityCardModel }) {
  const { t } = useTranslation();

  const { model } = props;
  const { entity, state, reportedAt, title, command, hidden } = model;
  const key = sizeKey(model.size);
  const hasLevel = hasCapability(entity, 'level');
  const whites = paramsOf(entity, 'color_temp');
  // What the light declares, not what it last said: a light in white mode reports no colour.
  const hasColour = hasCapability(entity, 'color_hs');
  const level = usePendingValue(state.level?.level ?? 0, reportedAt);
  const kelvin = usePendingValue(
    state.color_temp === undefined ? 0 : miredsToKelvin(state.color_temp.mireds),
    reportedAt,
  );
  const hue = usePendingValue(state.color_hs?.hue ?? 0, reportedAt);
  // Only a light that only switches draws its day: the tall card has room for nothing else.
  const day = useStateChanges(
    entity.entityId,
    '24h',
    !hasLevel && key === '1x2' && model.canReadHistory,
  );

  const isOn = state.on_off?.isOn ?? (state.level?.level ?? 0) > 0;
  const making = makingOf({
    ...state,
    ...(state.color_temp === undefined || kelvin.shown === 0
      ? {}
      : { color_temp: { mireds: kelvinToMireds(kelvin.shown) } }),
  });
  const glow = !isOn
    ? undefined
    : making.kind === 'colour'
      ? hsColor(making.hue, making.saturation)
      : LAMP;
  const percent = Math.round(level.shown);
  const isDim = model.isOffline || !isOn;
  const hasValue = state.on_off !== undefined || state.level !== undefined;

  /**
   * The line beside the brightness: the white, the colour, or how long it has been on or off.
   *
   * @param order - How the white is written: "2700 K · warm" on a tile, "Warm · 2700 K" on a card,
   *   "Warm white · 2700 K" on a square.
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
        ? t('dashboard.cards.lightCard.off', 'Off')
        : t('dashboard.cards.lightCard.offSince', 'Off since {{time}}', {
            time: cardTime(model.changedAt),
          });
    }

    if (making.kind === 'colour') {
      return `${hueName(making.hue)} · ${String(Math.round(making.hue))}°`;
    }

    if (making.kind === 'white') {
      const k = `${String(Math.round(making.kelvin / 10) * 10)} K`;
      const word = warmthName(making.kelvin);

      return order === 'tile'
        ? `${k} · ${word.toLowerCase()}`
        : order === 'card'
          ? `${word} · ${k}`
          : t('dashboard.cards.lightCard.whiteNamed', '{{warmth}} white · {{kelvin}}', {
              warmth: word,
              kelvin: k,
            });
    }

    return model.changedAt === null ? '' : forHowLong(model.changedAt);
  };

  const sending = isOn
    ? t('dashboard.cards.lightCard.turningOff', 'Turning off…')
    : t('dashboard.cards.lightCard.turningOn', 'Turning on…');
  const tail = state.on_off === undefined ? undefined : <CardSwitch model={model} />;
  const head = <CardHead model={model} isActive={isOn} tail={tail} />;
  /**
   * The light's figure: its brightness, or On and Off for one that does not dim, or a dash
   * before it has said anything.
   *
   * @param size - How large, as the card's size wants it.
   * @returns The figure.
   */
  const figure = (size: 26 | 36 | 40) =>
    !hasValue ? (
      <BigValue value="—" size={22} className="text-foreground-subtle" />
    ) : isOn && hasLevel ? (
      <BigValue
        value={String(percent)}
        unit="%"
        size={size}
        className={model.isOffline ? 'text-foreground-subtle' : undefined}
      />
    ) : (
      <BigValue
        value={
          isOn ? t('dashboard.cards.lightCard.on', 'On') : t('dashboard.cards.lightCard.off', 'Off')
        }
        size={size === 26 ? 22 : 30}
        className={isDim ? 'text-foreground-subtle' : undefined}
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

  const canDim = canUse(model, 'level');
  const brightness =
    hasLevel && model.canControl && !hidden.has('brightness') ? (
      <BarSlider
        label={t('dashboard.cards.lightCard.brightness', 'Brightness')}
        icon="sun"
        value={isOn ? percent : 0}
        display={key === '2x2' ? `${String(isOn ? percent : 0)}%` : undefined}
        look={{ fill: glow ?? LAMP }}
        disabled={!canDim}
        onChange={level.hold}
        onCommit={(next) => {
          level.sent(next);
          command.send('level', { command: 'set_level', level: next });
        }}
      />
    ) : null;
  const warmest = whites === null ? 0 : miredsToKelvin(whites.maxMireds);
  const coolest = whites === null ? 0 : miredsToKelvin(whites.minMireds);
  const white = Math.min(coolest, Math.max(warmest, kelvin.shown === 0 ? warmest : kelvin.shown));
  const whiteBar =
    whites !== null && model.canControl && !hidden.has('white') ? (
      <BarSlider
        label={t('dashboard.cards.lightCard.white', 'White')}
        value={white}
        min={warmest}
        max={coolest}
        step={STEP_KELVIN}
        display={kelvin.shown === 0 ? '—' : `${String(white)} K`}
        look={{ gradient: warmthGradient(warmest, coolest) }}
        disabled={!canUse(model, 'color_temp')}
        onChange={kelvin.hold}
        onCommit={(next) => {
          kelvin.sent(next);
          command.send('color_temp', {
            command: 'set_color_temp',
            mireds: Math.min(whites.maxMireds, Math.max(whites.minMireds, kelvinToMireds(next))),
          });
        }}
      />
    ) : null;
  const colourBar =
    hasColour && model.canControl ? (
      <BarSlider
        label={t('dashboard.cards.lightCard.colour', 'Colour')}
        value={Math.round(hue.shown)}
        max={360}
        look={{ gradient: hueGradient() }}
        disabled={!canUse(model, 'color_hs')}
        onChange={hue.hold}
        onCommit={(next) => {
          hue.sent(next);
          command.send('color_hs', {
            command: 'set_color',
            hue: next,
            saturation: Math.max(40, state.color_hs?.saturation ?? 100),
          });
        }}
      />
    ) : null;

  /**
   * Makes the light a preset: its white, or its colour.
   *
   * @param id - The preset.
   */
  const choose = (id: string): void => {
    const preset = PRESETS.find((each) => each.id === id);

    if (preset === undefined) {
      return;
    }

    if ('kelvin' in preset && whites !== null) {
      kelvin.sent(preset.kelvin);
      command.send('color_temp', {
        command: 'set_color_temp',
        mireds: Math.min(
          whites.maxMireds,
          Math.max(whites.minMireds, kelvinToMireds(preset.kelvin)),
        ),
      });

      return;
    }

    const colour =
      'hue' in preset ? preset : { hue: 35, saturation: preset.kelvin < 3300 ? 35 : 8 };

    hue.sent(colour.hue);
    command.send('color_hs', {
      command: 'set_color',
      hue: colour.hue,
      saturation: colour.saturation,
    });
  };
  const swatches: Swatch[] = PRESETS.map((preset) => ({
    id: preset.id,
    label: presetName(preset.id),
    color: preset.color,
    isChosen:
      isOn &&
      ('kelvin' in preset
        ? making.kind === 'white' && Math.abs(making.kelvin - preset.kelvin) < 400
        : making.kind === 'colour' && Math.abs(making.hue - preset.hue) < 12),
  }));
  const presets =
    hasColour && model.canControl && !hidden.has('presets') ? (
      <Swatches
        swatches={swatches}
        size={key === '2x2' ? 20 : 18}
        disabled={!canUse(model, 'color_hs')}
        onChoose={choose}
      />
    ) : null;

  // Something that only switches: the round button and its day.
  if (!hasLevel) {
    const today = day === undefined ? undefined : onOffDay(day, entity, !model.isOffline);

    return (
      <CardFrame label={title} glow={glow}>
        {head}
        <div className="mt-3.5 flex min-w-0 items-center justify-between gap-2.5">
          <div className="flex min-w-0 flex-col gap-1.5">
            {figure(36)}
            <CommandNote command={command} sending={sending}>
              <Caption>{caption('card')}</Caption>
            </CommandNote>
          </div>
          {model.canControl ? (
            <PowerButton
              isOn={isOn}
              color={LAMP}
              label={
                isOn
                  ? t('dashboard.cards.lightCard.turnOff', 'Turn off')
                  : t('dashboard.cards.lightCard.turnOn', 'Turn on')
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
        ) : today === undefined || hidden.has('day') ? null : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2.5">
              <Caption>{t('dashboard.cards.lightCard.today', 'Today')}</Caption>
              <Caption className="text-foreground-muted">
                {t('dashboard.cards.lightCard.onFor', 'On {{time}}', {
                  time: hoursAndMinutes(today.onMs),
                })}
              </Caption>
            </div>
            <DayBlocks
              hours={today.hours}
              color={LAMP}
              label={t('dashboard.cards.lightCard.lastDay', 'The last 24 hours')}
            />
          </div>
        )}
      </CardFrame>
    );
  }

  const colourDot =
    making.kind === 'colour' && isOn ? (
      <span
        aria-hidden="true"
        className="size-9 shrink-0 rounded-full transition-[background,box-shadow] duration-300"
        /* eslint-disable-next-line react/forbid-dom-props -- the colour the light makes. */
        style={{
          background: glow,
          boxShadow: `0 0 24px color-mix(in srgb, ${glow ?? LAMP} 60%, transparent)`,
        }}
      />
    ) : null;
  // A light making a colour slides its hue; one making a white slides its white.
  const second = making.kind === 'colour' ? colourBar : whiteBar;

  if (key === '2x2') {
    return (
      <CardFrame label={title} glow={glow}>
        {head}
        <div className="mt-4 flex min-h-0 grow gap-5">
          <div className="flex w-[190px] shrink-0 flex-col gap-1.5">
            {figure(40)}
            <CommandNote command={command} sending={sending}>
              <Caption>{caption('square')}</Caption>
            </CommandNote>
            <div className="mt-auto">{presets}</div>
          </div>
          <div className="flex min-w-0 grow flex-col justify-end gap-2.5">
            {command.hasFailed ? (
              <NoAnswer command={command} />
            ) : (
              <>
                {brightness}
                {second}
              </>
            )}
          </div>
        </div>
      </CardFrame>
    );
  }

  return (
    <CardFrame label={title} glow={glow}>
      {head}
      <div
        className={
          colourDot === null
            ? 'mt-4 flex min-w-0 items-baseline justify-between gap-2.5'
            : 'mt-4 flex min-w-0 items-center justify-between gap-2.5'
        }
      >
        {colourDot === null ? (
          <>
            {figure(36)}
            <CommandNote command={command} sending={sending}>
              <Caption>{caption('card')}</Caption>
            </CommandNote>
          </>
        ) : (
          <>
            <div className="flex min-w-0 flex-col gap-1.5">
              {figure(36)}
              <CommandNote command={command} sending={sending}>
                <Caption>{caption('card')}</Caption>
              </CommandNote>
            </div>
            {colourDot}
          </>
        )}
      </div>
      {presets === null || making.kind === 'colour' ? null : (
        <div className="mt-3.5">{presets}</div>
      )}
      <div className="grow" />
      {command.hasFailed ? (
        <NoAnswer command={command} />
      ) : (
        <div className="flex flex-col gap-2.5">
          {making.kind === 'colour' ? colourBar : brightness}
          {/* Without colour, the white has room under the brightness; with it, the presets do. */}
          {hasColour || making.kind === 'colour' ? null : whiteBar}
        </div>
      )}
    </CardFrame>
  );
}
