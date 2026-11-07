/**
 * A lamp, as the canvas draws it (`N-Entity-Modal-Lights`, `N-Entity-Light-Colour`,
 * `N-Entity-Light-More`). On and off is always there; everything else is added by what the lamp
 * declares:
 *
 * - only on and off: the round power target;
 * - a level: the big percentage, its switch, the wide bar, and 25 / 50 / 75 / 100 when the level
 *   is all there is;
 * - a colour temperature: the warm-to-cool bar within the lamp's own range;
 * - a colour: twelve swatches, the last one any colour; White | Colour between them when the lamp
 *   has both;
 * - a white channel beside the colour: its own thin slider;
 * - effects: chips by the list rule, "None" first.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, ColorWheel, cn } from '@nebulahome/ui';

import { defineMessage, text, translate } from '@/i18n/messages';
import {
  hasCapability,
  hexToHs,
  hsColor,
  kelvinToMireds,
  miredsToKelvin,
  paramsOf,
} from '@/library/entity-control';
import { isBusy } from '@/routes/library/entity/controls/control-block';
import { OnOffBody } from '@/routes/library/entity/sheet/bodies/switch-body';
import { OptionList } from '@/routes/library/entity/sheet/parts/option-list';
import {
  BlockHead,
  LevelBar,
  QuickPicks,
  ThinSlider,
  useSinceLine,
} from '@/routes/library/entity/sheet/parts/sheet-controls';
import { BigSwitch, ValueHead } from '@/routes/library/entity/sheet/parts/sheet-parts';
import type { SheetBodyProps } from '@/routes/library/entity/sheet/sheet-types';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** The swatches, as the canvas draws them: eleven colours and any colour. */
const SWATCHES = [
  ['rose', defineMessage('entity.sheet.light.rose', 'Rose'), '#ff5c9d'],
  ['coral', defineMessage('entity.sheet.light.coral', 'Coral'), '#ff8a4c'],
  ['amber', defineMessage('entity.sheet.light.amber', 'Amber'), '#ffc247'],
  ['green', defineMessage('entity.sheet.light.green', 'Green'), '#52cd86'],
  ['cyan', defineMessage('entity.sheet.light.cyan', 'Cyan'), '#4fd0ee'],
  ['indigo', defineMessage('entity.sheet.light.indigo', 'Indigo'), '#7c86ff'],
  ['violet', defineMessage('entity.sheet.light.violet', 'Violet'), '#a78bfa'],
  ['red', defineMessage('entity.sheet.light.red', 'Red'), '#f75d59'],
  ['blush', defineMessage('entity.sheet.light.blush', 'Blush'), '#ffd1e3'],
  ['ice', defineMessage('entity.sheet.light.ice', 'Ice'), '#b3f0ff'],
  ['lavender', defineMessage('entity.sheet.light.lavender', 'Lavender'), '#e2e5ff'],
] as const;

/**
 * The swatch a colour is, when it is one of them.
 *
 * @param hue - The colour's hue.
 * @param saturation - Its saturation.
 * @returns The swatch, or undefined for a colour of its own.
 */
function swatchOf(hue: number, saturation: number): (typeof SWATCHES)[number] | undefined {
  return SWATCHES.find(([, , hex]) => {
    const hs = hexToHs(hex);

    return (
      hs !== null &&
      Math.abs(((hs.hue - hue + 540) % 360) - 180) < 6 &&
      Math.abs(hs.saturation - saturation) < 6
    );
  });
}

/** The colour-temperature bar's stops, warm to cool, as its gradient draws them. */
const WHITES = [
  [255, 159, 67],
  [255, 241, 220],
  [201, 220, 255],
] as const;

/**
 * The colour of the bar at a point, so its knob takes the white it stands on.
 *
 * @param at - Where along the bar, from 0 (warm) to 1 (cool).
 * @returns The colour, `rgb(…)`.
 */
function whiteAt(at: number): string {
  const [from, to] = at < 0.5 ? [WHITES[0], WHITES[1]] : [WHITES[1], WHITES[2]];
  const part = at < 0.5 ? at * 2 : (at - 0.5) * 2;
  const channels = from.map((channel, index) =>
    Math.round(channel + ((to[index] ?? channel) - channel) * part),
  );

  return `rgb(${channels.join(' ')})`;
}

/**
 * Says how warm a white is.
 *
 * @param kelvin - Its temperature.
 * @returns "Warm white", "Neutral white" or "Cool white".
 */
function whiteWord(kelvin: number): string {
  if (kelvin < 3300) {
    return translate('entity.sheet.light.warmWhite', 'Warm white');
  }

  return kelvin < 4800
    ? translate('entity.sheet.light.neutralWhite', 'Neutral white')
    : translate('entity.sheet.light.coolWhite', 'Cool white');
}

/**
 * The body of a lamp.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
export function LightBody(props: SheetBodyProps) {
  const { t } = useTranslation();
  const { entity, state, commander, disabled, reportedAt } = props;
  const since = useSinceLine(entity);
  const hasLevel = hasCapability(entity, 'level');
  const temp = paramsOf(entity, 'color_temp');
  const hs = paramsOf(entity, 'color_hs');
  const effects = paramsOf(entity, 'effect');
  const isOn = state.on_off?.isOn === true;
  const level = usePendingValue(state.level?.level ?? 0, reportedAt, commander.busy.has('level'));
  const mireds = usePendingValue(
    state.color_temp?.mireds ?? temp?.maxMireds ?? 370,
    reportedAt,
    commander.busy.has('color_temp'),
  );
  const white = usePendingValue(
    state.color_hs?.white ?? 0,
    reportedAt,
    commander.busy.has('color_hs'),
  );
  const picked = usePendingValue(
    { hue: state.color_hs?.hue ?? 0, saturation: state.color_hs?.saturation ?? 0 },
    reportedAt,
    commander.busy.has('color_hs'),
  );
  const [isPicking, setIsPicking] = useState(false);

  if (!hasLevel && temp === null && hs === null) {
    return <OnOffBody {...props} tone="lamp" />;
  }

  const { hue, saturation } = picked.shown;
  // Which of white and colour the lamp shows now, when it has both: what it says, or the colour
  // when it says nothing.
  const showsColour =
    hs !== null &&
    (temp === null || state.color_hs?.isActive === true || state.color_temp?.isActive === false);
  const colour = showsColour ? hsColor(hue, saturation) : undefined;
  const swatch = showsColour ? swatchOf(hue, saturation) : undefined;
  const kelvin = miredsToKelvin(Math.round(mireds.shown));
  const minKelvin = temp === null ? 2200 : miredsToKelvin(temp.maxMireds);
  const maxKelvin = temp === null ? 6500 : miredsToKelvin(temp.minMireds);
  // How far along the bar the temperature is, from warm (0) to cool (1).
  const warmth = Math.min(
    1,
    Math.max(0, (kelvin - minKelvin) / Math.max(1, maxKelvin - minKelvin)),
  );
  const isOnlyLevel = temp === null && hs === null && effects === null;
  const isSending = (['on_off', 'level', 'color_temp', 'color_hs', 'effect'] as const).some(
    (capability) => isBusy(props, capability),
  );
  const line = !isOn
    ? since
    : showsColour
      ? [
          swatch === undefined ? t('entity.sheet.light.colour', 'Colour') : text(swatch[1]),
          hs.hasWhiteChannel && (state.color_hs?.white ?? 0) > 0
            ? t('entity.sheet.light.whiteAt', 'white at {{value}}%', {
                value: Math.round(white.shown),
              })
            : null,
        ]
          .filter(Boolean)
          .join(', ')
      : temp !== null
        ? whiteWord(kelvin)
        : since;

  /**
   * Picks a colour, from a swatch or the picker.
   *
   * @param next - Its hue and saturation.
   * @param next.hue - The hue.
   * @param next.saturation - The saturation.
   */
  const setColour = (next: { hue: number; saturation: number }): void => {
    picked.sent(next);
    commander.send('color_hs', { command: 'set_color', ...next });
  };

  return (
    <div className="flex grow flex-col justify-center gap-5">
      <ValueHead
        value={
          !isOn
            ? t('common.off', 'Off')
            : hasLevel
              ? t('entity.sheet.percent', '{{value}}%', { value: Math.round(level.shown) })
              : t('common.on', 'On')
        }
        line={line}
        trail={
          <BigSwitch
            label={entity.name}
            isOn={isOn}
            isSending={isSending}
            tone="lamp"
            disabled={disabled}
            onChange={(next) => {
              commander.send('on_off', { command: next ? 'turn_on' : 'turn_off' });
            }}
          />
        }
      />

      {hasLevel ? (
        <LevelBar
          label={t('entity.sheet.light.brightness', 'Brightness')}
          value={Math.round(level.shown)}
          isOn={isOn}
          tone="lamp"
          {...(colour === undefined ? {} : { colour })}
          disabled={disabled}
          onChange={level.hold}
          onCommit={(next) => {
            level.sent(next);
            commander.send('level', { command: 'set_level', level: next });
          }}
        />
      ) : null}

      {isOnlyLevel ? (
        <QuickPicks
          values={[25, 50, 75, 100]}
          value={isOn ? Math.round(level.shown) : null}
          tone="lamp"
          disabled={disabled}
          onPick={(next) => {
            level.sent(next);
            commander.send('level', { command: 'set_level', level: next });
          }}
        />
      ) : null}

      {temp !== null && hs !== null ? (
        <OptionList
          title={t('entity.sheet.light.mode', 'Mode')}
          options={[
            { value: 'white', label: t('entity.sheet.light.white', 'White') },
            { value: 'colour', label: t('entity.sheet.light.colour', 'Colour') },
          ]}
          value={showsColour ? 'colour' : 'white'}
          tone="lamp"
          disabled={disabled}
          onPick={(next) => {
            if (next === 'colour') {
              setColour({ hue, saturation: Math.max(saturation, 60) });
            } else {
              commander.send('color_temp', {
                command: 'set_color_temp',
                mireds: Math.round(mireds.shown),
              });
            }
          }}
        />
      ) : null}

      {temp !== null && !showsColour ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-ui">
              {t('entity.sheet.light.colourTemperature', 'Colour temperature')}
            </span>
            <span className="font-mono text-mono-caption text-foreground-muted">
              {t('entity.sheet.light.kelvin', '{{kelvin}} K', { kelvin })}
            </span>
          </div>
          <div className="entity-slider group relative h-12">
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-[16px] bg-linear-to-r from-[#ff9f43] via-[#fff1dc] to-[#c9dcff] shadow-[inset_0_1px_0_rgb(255_255_255/0.35),inset_0_0_0_1px_rgb(0_0_0/0.18)] transition-[filter] duration-200 group-hover:brightness-105"
            />
            {(['left-1/4', 'left-1/2', 'left-3/4'] as const).map((place) => (
              <span
                key={place}
                aria-hidden="true"
                className={cn('absolute top-1/2 h-3 w-px -translate-y-1/2 bg-black/12', place)}
              />
            ))}
            {/* An upright bar in the white it stands on: it grows under the pointer and while held. */}
            <span
              aria-hidden="true"
              className={cn(
                'entity-track pointer-events-none absolute top-1/2 h-[calc(100%+6px)] w-3.5 -translate-1/2 rounded-pill border-[3px] border-white',
                'shadow-[0_0_0_1px_rgb(0_0_0/0.22),0_6px_16px_rgb(0_0_0/0.4)]',
                'group-hover:h-[calc(100%+12px)] group-has-[input:active]:h-[calc(100%+16px)] group-has-[input:active]:w-4.5',
              )}
              // eslint-disable-next-line react/forbid-dom-props -- the bar sits at the lamp's temperature, in its colour
              style={{
                left: `calc(9px + (100% - 18px) * ${String(warmth)})`,
                background: whiteAt(warmth),
              }}
            />
            <input
              type="range"
              min={minKelvin}
              max={maxKelvin}
              step={50}
              value={kelvin}
              disabled={disabled}
              aria-label={t('entity.sheet.light.colourTemperature', 'Colour temperature')}
              onChange={(event) => {
                mireds.hold(kelvinToMireds(Number(event.target.value)));
              }}
              onPointerUp={(event) => {
                const next = kelvinToMireds(Number(event.currentTarget.value));

                mireds.sent(next);
                commander.send('color_temp', { command: 'set_color_temp', mireds: next });
              }}
              className="absolute inset-0 m-0 size-full cursor-grab opacity-0 active:cursor-grabbing"
            />
          </div>
          <div className="flex justify-between font-mono text-[10px] text-foreground-subtle">
            <span>{t('entity.sheet.light.warm', 'Warm')}</span>
            <span>{t('entity.sheet.light.neutral', 'Neutral')}</span>
            <span>{t('entity.sheet.light.cool', 'Cool')}</span>
          </div>
        </div>
      ) : null}

      {showsColour && isPicking ? (
        // Any colour: the wheel in place of the swatches, the lamp following the knob as it moves.
        <div className="entity-slide flex flex-col items-center gap-3.5 rounded-panel border border-border bg-well p-4">
          <div className="flex w-full items-center justify-between gap-3">
            <span className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="size-4 rounded-full shadow-[inset_0_0_0_1px_rgb(255_255_255/0.16)] transition-colors duration-200"
                // eslint-disable-next-line react/forbid-dom-props -- the colour being picked
                style={{ background: hsColor(hue, saturation) }}
              />
              <span className="text-ui">
                {t('entity.sheet.light.anyColour', 'Pick any colour')}
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                setIsPicking(false);
              }}
              className="press h-8 cursor-pointer rounded-pill border border-border-strong bg-surface-raised px-3.5 text-ui-sm font-medium text-foreground transition-colors duration-200 hover:border-foreground-subtle"
            >
              {t('entity.sheet.light.done', 'Done')}
            </button>
          </div>
          <ColorWheel
            label={t('entity.sheet.light.anyColour', 'Pick any colour')}
            value={{ hue, saturation }}
            size={232}
            disabled={disabled}
            onChange={picked.hold}
            onCommit={setColour}
          />
        </div>
      ) : showsColour ? (
        <div className="grid grid-cols-6 justify-items-center gap-x-2 gap-y-3">
          {SWATCHES.map(([key, name, hex]) => {
            const isChosen = swatch?.[0] === key;

            return (
              <button
                key={key}
                type="button"
                aria-label={text(name)}
                aria-pressed={isChosen}
                disabled={disabled}
                onClick={() => {
                  const next = hexToHs(hex);

                  if (next !== null) {
                    setColour(next);
                  }
                }}
                className={cn(
                  'press-scale size-11 cursor-pointer rounded-full p-0 transition-shadow duration-300',
                  'hover:shadow-[0_0_0_3px_var(--color-surface),0_0_0_5px_var(--color-border-strong)]',
                  isChosen
                    ? 'entity-pop shadow-[0_0_0_3px_var(--color-surface),0_0_0_5px_var(--color-foreground)]'
                    : 'shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]',
                )}
                // eslint-disable-next-line react/forbid-dom-props -- a swatch is its colour
                style={{ background: hex }}
              />
            );
          })}
          <button
            type="button"
            aria-label={t('entity.sheet.light.anyColour', 'Pick any colour')}
            aria-pressed={swatch === undefined}
            disabled={disabled}
            onClick={() => {
              setIsPicking(true);
            }}
            className={cn(
              'press-scale flex size-11 cursor-pointer items-center justify-center rounded-full p-0 text-canvas transition-shadow duration-300',
              'bg-[conic-gradient(#f75d59,#ffc247,#52cd86,#4fd0ee,#7c86ff,#a78bfa,#ff5c9d,#f75d59)]',
              swatch === undefined
                ? 'shadow-[0_0_0_3px_var(--color-surface),0_0_0_5px_var(--color-foreground)]'
                : 'hover:shadow-[0_0_0_3px_var(--color-surface),0_0_0_5px_var(--color-border-strong)]',
            )}
          >
            <AppIcon id="plus" size={18} />
          </button>
        </div>
      ) : null}

      {showsColour && hs.hasWhiteChannel ? (
        <div className="flex flex-col gap-2.5">
          <BlockHead
            title={t('entity.sheet.light.whiteChannel', 'White channel')}
            aside={t('entity.sheet.percent', '{{value}}%', { value: Math.round(white.shown) })}
          />
          <ThinSlider
            label={t('entity.sheet.light.whiteChannel', 'White channel')}
            value={Math.round(white.shown)}
            disabled={disabled}
            onChange={white.hold}
            onCommit={(next) => {
              white.sent(next);
              commander.send('color_hs', { command: 'set_white', white: next });
            }}
          />
        </div>
      ) : null}

      {effects === null ? null : (
        <div className="flex flex-col gap-2.5">
          <BlockHead
            title={t('entity.sheet.light.effect', 'Effect')}
            aside={t('entity.sheet.light.fromTheLight', '{{count}} from the light', {
              count: effects.effects.length,
            })}
          />
          <OptionList
            title={t('entity.sheet.light.effect', 'Effect')}
            options={[
              { value: '', label: t('entity.sheet.light.none', 'None') },
              ...effects.effects.map((value) => ({ value })),
            ]}
            value={state.effect?.effect ?? ''}
            tone="lamp"
            hasIcons={false}
            disabled={disabled}
            onPick={(next) => {
              commander.send('effect', {
                command: 'set_effect',
                effect: next === '' ? null : next,
              });
            }}
          />
        </div>
      )}
    </div>
  );
}
