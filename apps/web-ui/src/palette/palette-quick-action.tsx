/**
 * Turning the active entity on or off from the command palette (docs: command palette, 8). Drawn
 * only on the active row, so there is one `useEntityCommand` however long the list: it joins
 * presses into one, toasts a failure and reads the state again.
 *
 * The row shows the live reading, never a guess: the press is felt on the button, and the state
 * changes when the entity reports it. With no answer after a moment, the key becomes a spinner.
 */
import { useEffect, type Ref } from 'react';

import type { EntityView } from '@nebulahome/contracts';

import { powerCommand } from '@/library/entity-control';
import { PaletteActionButton } from '@/palette/palette-action-button';
import { useAfter } from '@/palette/use-after';
import { usePowerHint } from '@/palette/use-power-hint';
import { useEntityCommand } from '@/routes/library/entity/use-entity-command';

/** How long a command may go unanswered before the spinner shows. */
const SLOW_MS = 250;

/** What the quick action needs. */
export type PaletteQuickActionProps = {
  readonly entity: EntityView;

  /** The button, for Tab to press. */
  readonly buttonRef: Ref<HTMLButtonElement>;

  /** Called when a command failed, for the row to shake. */
  readonly onFailed: () => void;
};

/**
 * Renders the Turn on / Turn off button of the active entity.
 *
 * @param props - See {@link PaletteQuickActionProps}.
 * @returns The button.
 */
export function PaletteQuickAction(props: PaletteQuickActionProps) {
  const { entity, buttonRef, onFailed } = props;
  const { isOn, hint } = usePowerHint(entity);
  const commander = useEntityCommand(entity.entityId);
  const isWaiting = useAfter(commander.busy.has('on_off'), SLOW_MS);

  // The hook toasts why; the row shakes once to say which.
  useEffect(() => {
    if (commander.problem !== null) {
      onFailed();
    }
  }, [commander.problem, onFailed]);

  return (
    <PaletteActionButton
      label={hint}
      isWaiting={isWaiting}
      buttonRef={buttonRef}
      onPress={() => {
        commander.send('on_off', powerCommand(!isOn));
      }}
    />
  );
}
