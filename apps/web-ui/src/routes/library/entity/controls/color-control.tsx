/**
 * A light's colour, as a hue and how much of it.
 *
 * A wheel, because that is where a colour is found by looking: the hue around it, the saturation
 * out from the white middle. A swatch beside the title shows the result and the figures say it
 * exactly; a row of colours sets a common one in a press, and where the browser can, the dropper
 * takes one from anywhere on the screen.
 */
import { ColourPicker } from '@/components/colour-picker';
import { hsColor } from '@/library/entity-control';
import { ControlBlock, type ControlProps } from '@/routes/library/entity/controls/control-block';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

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
      value={`${String(Math.round(hue))}° · ${String(Math.round(saturation))}%`}
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
      <ColourPicker
        value={colour.shown}
        disabled={disabled}
        onChange={(next) => {
          colour.hold(next);
        }}
        onCommit={send}
      />
    </ControlBlock>
  );
}
