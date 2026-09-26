/**
 * A light card's colour: a swatch of the colour it is making that opens the wheel.
 *
 * On a card, beside the white slider rather than in place of it: a light that does both keeps
 * both within a press, and the wheel is too large to live on a square card. The wheel opens in a
 * dialog, and each colour chosen there is sent as it is chosen, so the lamp follows the finger.
 */
import { useState } from 'react';

import type { CapabilityState } from '@nebula-home/contracts';
import { Modal, type WheelColour } from '@nebula-home/ui';

import { ColourPicker } from '@/components/colour-picker';
import { hsColor } from '@/library/entity-control';
import type { EntityCommander } from '@/routes/library/entity/use-entity-command';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** What the button needs. */
export type LightColourButtonProps = {
  /** The light's name, for the dialog's title. */
  readonly name: string;

  /** Its state now. */
  readonly state: CapabilityState;

  /** When that state arrived. */
  readonly reportedAt: number | null;

  /** Sends its commands. */
  readonly commander: EntityCommander;

  /** Whether nothing can be sent. */
  readonly disabled: boolean;
};

/**
 * Renders the swatch and its dialog.
 *
 * @param props - See {@link LightColourButtonProps}.
 * @returns The button.
 */
export function LightColourButton(props: LightColourButtonProps) {
  const { name, state, reportedAt, commander, disabled } = props;
  const [isOpen, setOpen] = useState(false);
  const colour = usePendingValue<WheelColour>(
    state.color_hs ?? { hue: 0, saturation: 0 },
    reportedAt,
  );

  return (
    <>
      <button
        type="button"
        aria-label={`Choose the colour of ${name}`}
        title="Colour"
        disabled={disabled}
        className="press-scale size-7 shrink-0 rounded-full ring-1 ring-border-strong transition-shadow hover:ring-2 hover:ring-foreground-muted focus-visible:ring-3 focus-visible:ring-primary/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        /* eslint-disable-next-line react/forbid-dom-props -- the swatch is the light's colour
           (RULES.md 15.3). */
        style={{
          background:
            state.color_hs === undefined
              ? 'conic-gradient(from 90deg, hsl(0 100% 60%), hsl(120 100% 60%), hsl(240 100% 60%), hsl(360 100% 60%))'
              : hsColor(colour.shown.hue, colour.shown.saturation),
        }}
        onClick={() => {
          setOpen(true);
        }}
      />
      <Modal
        isOpen={isOpen}
        onClose={() => {
          setOpen(false);
        }}
        size="small"
        title={`Colour of ${name}`}
      >
        <ColourPicker
          value={colour.shown}
          disabled={disabled}
          onChange={colour.hold}
          onCommit={(next) => {
            colour.sent(next);
            commander.send('color_hs', {
              command: 'set_color',
              hue: next.hue,
              saturation: next.saturation,
            });
          }}
        />
      </Modal>
    </>
  );
}
