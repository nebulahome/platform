/**
 * A light's white, from warm to cool.
 *
 * In kelvin, which is what a box and a person say, although the device speaks mireds; the slider
 * spans exactly the range this lamp declared and its groove is painted in the whites the lamp can
 * make. Three presets - warm, neutral, daylight - sit under it, each held inside the lamp's range
 * and dropped when two of them land on the same white. On a lamp that also makes colours,
 * choosing a white leaves the colour: the colour block turns white with it.
 */
import { useTranslation } from 'react-i18next';

import { Button, Slider } from '@nebulahome/ui';

import { defineMessage, text } from '@/i18n/messages';
import {
  hasCapability,
  kelvinColor,
  kelvinToMireds,
  miredsToKelvin,
  paramsOf,
  warmthGradient,
} from '@/library/entity-control';
import { ControlBlock, type ControlProps } from '@/routes/library/entity/controls/control-block';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** The whites offered as presets. */
const PRESETS = [
  { label: defineMessage('entity.controls.colorTempControl.warm', 'Warm'), kelvin: 2700 },
  { label: defineMessage('entity.controls.colorTempControl.neutral', 'Neutral'), kelvin: 4000 },
  { label: defineMessage('entity.controls.colorTempControl.daylight', 'Daylight'), kelvin: 6500 },
] as const;

/** How far one step of the slider moves, in kelvin. */
const STEP_KELVIN = 50;

/**
 * Renders the colour temperature control.
 *
 * @param props - See {@link ControlProps}.
 * @returns The block, or a note when the lamp declared no range.
 */
export function ColorTempControl(props: ControlProps) {
  const { t } = useTranslation();

  const { entity, state, reportedAt, commander, disabled, colour } = props;
  const params = paramsOf(entity, 'color_temp');
  const reportedKelvin =
    state.color_temp === undefined ? null : miredsToKelvin(state.color_temp.mireds);
  const kelvin = usePendingValue(reportedKelvin ?? 0, reportedAt);

  if (params === null) {
    return (
      <ControlBlock
        title={t('entity.controls.colorTempControl.colourTemperature', 'Colour temperature')}
      >
        <p className="text-caption text-foreground-subtle">
          {t(
            'entity.controls.colorTempControl.thisLightHasNot',
            'This light has not said which whites it can make, so it cannot be set from here.',
          )}
        </p>
      </ControlBlock>
    );
  }

  // Mireds run the other way: the most mireds is the warmest white.
  const warmest = miredsToKelvin(params.maxMireds);
  const coolest = miredsToKelvin(params.minMireds);
  const shown = Math.min(coolest, Math.max(warmest, kelvin.shown === 0 ? warmest : kelvin.shown));
  const presets = [
    ...new Map(
      PRESETS.map((preset) => {
        const held = Math.min(coolest, Math.max(warmest, preset.kelvin));

        return [held, { ...preset, kelvin: held }] as const;
      }),
    ).values(),
  ];

  /**
   * Sets the white.
   *
   * @param next - The temperature, in kelvin.
   */
  const send = (next: number): void => {
    const mireds = Math.min(params.maxMireds, Math.max(params.minMireds, kelvinToMireds(next)));

    kelvin.sent(next);
    commander.send('color_temp', { command: 'set_color_temp', mireds });

    // A lamp that also makes colours leaves them for this white: its colour shows white at once.
    if (colour !== undefined && hasCapability(entity, 'color_hs')) {
      colour.sent({ hue: colour.shown.hue, saturation: 0 });
    }
  };

  const reads = reportedKelvin === null && kelvin.shown === 0 ? '—' : `${String(shown)} K`;

  return (
    <ControlBlock
      title={t('entity.controls.colorTempControl.colourTemperature', 'Colour temperature')}
      value={reads}
    >
      <Slider
        label={t('entity.controls.colorTempControl.colourTemperature', 'Colour temperature')}
        isLabelHidden
        value={shown}
        min={warmest}
        max={coolest}
        step={STEP_KELVIN}
        display={reads}
        gradient={warmthGradient(warmest, coolest)}
        disabled={disabled}
        onChange={kelvin.hold}
        onCommit={send}
      />
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <Button
            key={preset.kelvin}
            variant="ghost"
            size="compact"
            disabled={disabled}
            aria-label={t(
              'entity.controls.colorTempControl.labelKelvinK',
              '{{label}}, {{kelvin}} K',
              { label: text(preset.label), kelvin: String(preset.kelvin) },
            )}
            onClick={() => {
              send(preset.kelvin);
            }}
          >
            <span
              aria-hidden="true"
              className="size-3 rounded-full ring-1 ring-border-strong"
              /* eslint-disable-next-line react/forbid-dom-props -- the dot is this white, which
                 the palette does not hold (RULES.md 15.3). */
              style={{ backgroundColor: kelvinColor(preset.kelvin) }}
            />
            {text(preset.label)}
          </Button>
        ))}
      </div>
    </ControlBlock>
  );
}
