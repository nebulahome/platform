/**
 * Choosing a light's colour: the wheel, a row of common colours, and - where the browser can -
 * the dropper that takes a colour from anywhere on the screen.
 *
 * Shared by every place a colour is chosen - a light's own page, its dashboard card, a scene -
 * so the three work the same way. The dropper's colour is read as a hue and a saturation, its
 * brightness left out: brightness is the light's own setting.
 */
import { useTranslation } from 'react-i18next';

import { AppIcon, ColorWheel, IconButton, type WheelColour } from '@nebulahome/ui';

import { defineMessage, text } from '@/i18n/messages';
import { useEyeDropper } from '@/lib/use-eye-dropper';
import { hexToHs, hsColor } from '@/library/entity-control';

/** The colours offered in a press. */
const PRESETS = [
  { name: defineMessage('colours.red', 'Red'), hue: 0 },
  { name: defineMessage('colours.orange', 'Orange'), hue: 30 },
  { name: defineMessage('colours.yellow', 'Yellow'), hue: 55 },
  { name: defineMessage('colours.green', 'Green'), hue: 120 },
  { name: defineMessage('colours.cyan', 'Cyan'), hue: 185 },
  { name: defineMessage('colours.blue', 'Blue'), hue: 230 },
  { name: defineMessage('colours.purple', 'Purple'), hue: 275 },
  { name: defineMessage('colours.pink', 'Pink'), hue: 320 },
] as const;

/** What the picker needs. */
export type ColourPickerProps = {
  /** The colour shown now: what the knob points at. */
  readonly value: WheelColour;

  /** Called as the knob moves, to show the colour before it is sent. */
  readonly onChange: (value: WheelColour) => void;

  /** Called with a colour chosen: the knob let go, a preset, a key, the dropper. */
  readonly onCommit: (value: WheelColour) => void;

  /** Whether nothing can be chosen. */
  readonly disabled?: boolean;

  /** The wheel's size, in pixels. */
  readonly size?: number;
};

/**
 * Renders the picker.
 *
 * @param props - See {@link ColourPickerProps}.
 * @returns The picker.
 */
export function ColourPicker(props: ColourPickerProps) {
  const { t } = useTranslation();
  const { value, onChange, onCommit, disabled = false, size } = props;
  const dropper = useEyeDropper();

  /** Takes a colour from the screen, and chooses it. */
  const pickFromScreen = async (): Promise<void> => {
    const picked = await dropper.pick();
    const colour = picked === null ? null : hexToHs(picked);

    if (colour !== null) {
      onChange(colour);
      onCommit(colour);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <ColorWheel
        label={t('colours.label', 'Colour')}
        value={value}
        onChange={onChange}
        onCommit={onCommit}
        disabled={disabled}
        {...(size === undefined ? {} : { size })}
      />

      <div className="flex w-full flex-wrap items-center justify-center gap-2">
        <div
          role="group"
          aria-label={t('colours.common', 'Common colours')}
          className="flex flex-wrap gap-2"
        >
          {PRESETS.map((preset) => (
            <button
              key={preset.hue}
              type="button"
              aria-label={text(preset.name)}
              title={text(preset.name)}
              disabled={disabled}
              className="press-scale size-7 rounded-full ring-1 ring-border-strong transition-shadow hover:ring-2 hover:ring-foreground-muted focus-visible:ring-3 focus-visible:ring-primary/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              /* eslint-disable-next-line react/forbid-dom-props -- each swatch is its own colour
                 (RULES.md 15.3). */
              style={{ backgroundColor: hsColor(preset.hue, 100) }}
              onClick={() => {
                const colour = { hue: preset.hue, saturation: 100 };

                onChange(colour);
                onCommit(colour);
              }}
            />
          ))}
        </div>

        {dropper.isSupported ? (
          <IconButton
            label={t('colours.pick', 'Pick a colour from the screen')}
            variant="raised"
            size="small"
            disabled={disabled}
            onClick={() => {
              void pickFromScreen();
            }}
          >
            <AppIcon id="pipette" size={14} />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}
