/**
 * A level from 0 to 100: a light's brightness, or any other dimmer's level.
 *
 * The slider sends when it is let go.
 */
import { Slider } from '@nebulahome/ui';

import { capabilityLabel } from '@/library/entity-kind';
import { ControlBlock, type ControlProps } from '@/routes/library/entity/controls/control-block';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/**
 * Renders the level control.
 *
 * @param props - See {@link ControlProps}.
 * @returns The block.
 */
export function LevelControl(props: ControlProps) {
  const { entity, state, reportedAt, commander, disabled } = props;
  const label = capabilityLabel('level', entity.domain);
  const level = usePendingValue(state.level?.level ?? 0, reportedAt);
  const shown = Math.round(level.shown);

  return (
    <ControlBlock title={label} value={`${String(shown)}%`}>
      <Slider
        label={label}
        isLabelHidden
        value={shown}
        min={0}
        max={100}
        display={`${String(shown)}%`}
        fill={entity.domain === 'light' ? 'warm' : 'accent'}
        disabled={disabled}
        onChange={level.hold}
        onCommit={(next) => {
          level.sent(next);
          commander.send('level', { command: 'set_level', level: next });
        }}
      />
    </ControlBlock>
  );
}
