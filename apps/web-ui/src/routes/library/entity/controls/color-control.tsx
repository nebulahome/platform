/**
 * A light's colour, as a hue and how much of it.
 *
 * A wheel, because that is where a colour is found by looking: the hue around it, the saturation
 * out from the white middle. A swatch beside the title shows the result and the figures say it
 * exactly; a row of colours sets a common one in a press, and where the browser can, the dropper
 * takes one from anywhere on the screen.
 */
import { useTranslation } from 'react-i18next';

import { ColourPicker } from '@/components/colour-picker';
import { hsColor } from '@/library/entity-control';
import {
  ControlBlock,
  type ControlProps,
  type LightColour,
} from '@/routes/library/entity/controls/control-block';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/**
 * Renders the colour control.
 *
 * @param props - See {@link ControlProps}.
 * @returns The block.
 */
export function ColorControl(props: ControlProps) {
  const { t } = useTranslation();

  const { state, reportedAt, commander, disabled } = props;
  const own = usePendingValue<LightColour>(state.color_hs ?? { hue: 0, saturation: 0 }, reportedAt);
  // The panel's, when there is one: the white block turns it white.
  const colour = props.colour ?? own;
  const { hue, saturation } = colour.shown;

  /**
   * Sets the colour.
   *
   * @param next - The hue and the saturation.
   */
  const send = (next: LightColour): void => {
    colour.sent(next);
    commander.send('color_hs', {
      command: 'set_color',
      hue: next.hue,
      saturation: next.saturation,
    });
  };

  return (
    <ControlBlock
      title={t('entity.controls.colorControl.colour', 'Colour')}
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
