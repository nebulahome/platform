/**
 * A light's colour, as a hue and how much of it.
 *
 * Two sliders, because that is what the device takes: the hue across the whole wheel, and the
 * saturation from white to that hue at its fullest, its groove repainted as the hue moves. A
 * swatch beside the title shows the result, and a row of colours sets a common one in a press.
 */
import { Slider } from '@nebula-home/ui';

import { hsColor, hueGradient, saturationGradient } from '@/library/entity-control';
import { ControlBlock, type ControlProps } from '@/routes/library/entity/controls/control-block';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** The colours offered in a press. */
const PRESETS = [
  { name: 'Red', hue: 0 },
  { name: 'Orange', hue: 30 },
  { name: 'Yellow', hue: 55 },
  { name: 'Green', hue: 120 },
  { name: 'Cyan', hue: 185 },
  { name: 'Blue', hue: 230 },
  { name: 'Purple', hue: 275 },
  { name: 'Pink', hue: 320 },
] as const;

/** A colour as the device takes it. */
type Colour = { readonly hue: number; readonly saturation: number };

/**
 * Renders the colour control.
 *
 * @param props - See {@link ControlProps}.
 * @returns The block.
 */
export function ColorControl(props: ControlProps) {
  const { state, reportedAt, commander, disabled } = props;
  const colour = usePendingValue<Colour>(state.color_hs ?? { hue: 0, saturation: 0 }, reportedAt);
  const { hue, saturation } = colour.shown;

  /**
   * Sets the colour.
   *
   * @param next - The hue and the saturation.
   */
  const send = (next: Colour): void => {
    colour.sent(next);
    commander.send('color_hs', {
      command: 'set_color',
      hue: next.hue,
      saturation: next.saturation,
    });
  };

  return (
    <ControlBlock
      title="Colour"
      action={
        <span
          aria-hidden="true"
          className="size-7 rounded-chip ring-1 ring-border-strong"
          /* eslint-disable-next-line react/forbid-dom-props -- the swatch is the chosen colour,
             which the palette does not hold (RULES.md 15.3). */
          style={{ backgroundColor: hsColor(hue, saturation) }}
        />
      }
    >
      <Slider
        label="Hue"
        value={Math.round(hue)}
        min={0}
        max={360}
        display={`${String(Math.round(hue))}°`}
        gradient={hueGradient()}
        disabled={disabled}
        onChange={(next) => {
          colour.hold({ hue: next, saturation });
        }}
        onCommit={(next) => {
          send({ hue: next, saturation });
        }}
      />
      <Slider
        label="Saturation"
        value={Math.round(saturation)}
        min={0}
        max={100}
        display={`${String(Math.round(saturation))}%`}
        gradient={saturationGradient(hue)}
        disabled={disabled}
        onChange={(next) => {
          colour.hold({ hue, saturation: next });
        }}
        onCommit={(next) => {
          send({ hue, saturation: next });
        }}
      />
      <div role="group" aria-label="Common colours" className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            aria-label={preset.name}
            title={preset.name}
            disabled={disabled}
            className="press-scale size-7 rounded-full ring-1 ring-border-strong transition-shadow hover:ring-2 hover:ring-foreground-muted focus-visible:ring-3 focus-visible:ring-primary/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            /* eslint-disable-next-line react/forbid-dom-props -- each swatch is its own colour
               (RULES.md 15.3). */
            style={{ backgroundColor: hsColor(preset.hue, 100) }}
            onClick={() => {
              send({ hue: preset.hue, saturation: 100 });
            }}
          />
        ))}
      </div>
    </ControlBlock>
  );
}
