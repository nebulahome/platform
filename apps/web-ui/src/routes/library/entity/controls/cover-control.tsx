/**
 * A blind, a shutter, a garage door: open, stop, close, and where it stands.
 *
 * The three buttons are always there, because stopping a cover half-way is the thing people do
 * most after starting one. The position slider appears only for a cover that said it can be sent
 * to a position, and the tilt only for one that tilts; a cover that is moving says so in words
 * beside the title, since the position alone does not tell "open at 40%" from "on its way up".
 */
import { AppIcon, Button, Slider } from '@nebula-home/ui';

import { paramsOf } from '@/library/entity-control';
import {
  ControlBlock,
  isBusy,
  type ControlProps,
} from '@/routes/library/entity/controls/control-block';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** The three movements, with their glyphs. */
const MOVES = [
  { command: 'open', label: 'Open', icon: 'arrow-up-to-line' },
  { command: 'stop', label: 'Stop', icon: 'square' },
  { command: 'close', label: 'Close', icon: 'arrow-down-to-line' },
] as const;

/**
 * Says where a cover is, in words.
 *
 * @param position - 0 closed, 100 open.
 * @param motion - Whether it is moving, and which way.
 * @returns "Closed", "Open 40%", "Opening".
 */
function whereItIs(position: number, motion: 'opening' | 'closing' | 'stopped'): string {
  if (motion === 'opening') {
    return 'Opening';
  }

  if (motion === 'closing') {
    return 'Closing';
  }

  if (position === 0) {
    return 'Closed';
  }

  return position === 100 ? 'Open' : `Open ${String(Math.round(position))}%`;
}

/**
 * Renders the cover control.
 *
 * @param props - See {@link ControlProps}.
 * @returns The block.
 */
export function CoverControl(props: ControlProps) {
  const { entity, state, reportedAt, commander, disabled } = props;
  const params = paramsOf(entity, 'cover') ?? { hasPosition: true, hasTilt: false };
  const cover = state.cover ?? { position: 0, motion: 'stopped' as const };
  const position = usePendingValue(cover.position, reportedAt);
  const tilt = usePendingValue(cover.tilt ?? 0, reportedAt);
  const busy = isBusy(props, 'cover');

  return (
    <ControlBlock title="Cover" value={whereItIs(cover.position, cover.motion)}>
      <div className="grid grid-cols-3 gap-2">
        {MOVES.map((move) => (
          <Button
            key={move.command}
            variant="ghost"
            disabled={disabled || busy}
            onClick={() => {
              commander.send('cover', { command: move.command });
            }}
          >
            <AppIcon id={move.icon} size={15} />
            {move.label}
          </Button>
        ))}
      </div>
      {params.hasPosition ? (
        <Slider
          label="Position"
          value={Math.round(position.shown)}
          min={0}
          max={100}
          display={`${String(Math.round(position.shown))}%`}
          disabled={disabled}
          onChange={position.hold}
          onCommit={(next) => {
            position.sent(next);
            commander.send('cover', { command: 'set_position', position: next });
          }}
        />
      ) : null}
      {params.hasTilt ? (
        <Slider
          label="Tilt"
          value={Math.round(tilt.shown)}
          min={0}
          max={100}
          display={`${String(Math.round(tilt.shown))}%`}
          disabled={disabled}
          onChange={tilt.hold}
          onCommit={(next) => {
            tilt.sent(next);
            commander.send('cover', { command: 'set_tilt', tilt: next });
          }}
        />
      ) : null}
    </ControlBlock>
  );
}
