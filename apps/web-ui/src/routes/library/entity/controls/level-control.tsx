/**
 * A level from 0 to 100: a light's brightness, or any other dimmer's level.
 *
 * The slider sends when it is let go. A device that can fade offers the fade too - a moment's
 * transition rather than a jump - and remembers the choice for as long as the page is open.
 */
import { useState } from 'react';

import { Segmented, Slider } from '@nebulahome/ui';

import { paramsOf } from '@/library/entity-control';
import { capabilityLabel } from '@/library/entity-kind';
import { ControlBlock, type ControlProps } from '@/routes/library/entity/controls/control-block';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** The fades offered, in milliseconds. */
const FADES = [
  { value: '0', label: 'Instant' },
  { value: '1000', label: '1 s' },
  { value: '3000', label: '3 s' },
] as const;

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
  const [fade, setFade] = useState<(typeof FADES)[number]['value']>('0');
  const canFade = paramsOf(entity, 'level')?.hasTransition === true;
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
          commander.send('level', {
            command: 'set_level',
            level: next,
            ...(canFade && fade !== '0' ? { transitionMs: Number(fade) } : {}),
          });
        }}
      />
      {canFade ? (
        <Segmented
          label="Fade"
          size="compact"
          className="self-start"
          options={FADES}
          value={fade}
          onChange={setFade}
        />
      ) : null}
    </ControlBlock>
  );
}
