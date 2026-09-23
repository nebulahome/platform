/**
 * The switch beside an entity's name, for the one thing most often done to it: on or off.
 *
 * It commands at once and shows the state it asked for until the device reports - see
 * {@link usePendingValue} - and a refusal is said in its tooltip and to a screen reader, then it
 * falls back to what the device last said.
 */
import { Switch } from '@nebula-home/ui';

import { powerCommand } from '@/library/entity-control';
import { useEntityCommand } from '@/routes/library/entity/use-entity-command';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** What the switch needs. */
export type QuickPowerSwitchProps = {
  /** The entity, by its address. */
  readonly entityId: string;

  /** What it is called, for the switch's label. */
  readonly name: string;

  /** Whether the device last said it is on. */
  readonly isOn: boolean;

  /** When the device last reported, in milliseconds since the epoch. */
  readonly reportedAt: number | null;

  /** Whether it cannot be switched: unreachable, or refused to this person. */
  readonly disabled?: boolean;

  /** How large. */
  readonly size?: 'small' | 'medium';
};

/**
 * Renders the switch.
 *
 * @param props - See {@link QuickPowerSwitchProps}.
 * @returns The switch.
 */
export function QuickPowerSwitch(props: QuickPowerSwitchProps) {
  const { entityId, name, isOn, reportedAt, disabled = false, size = 'small' } = props;
  const commander = useEntityCommand(entityId);
  const power = usePendingValue(isOn, reportedAt);
  // A refused command leaves the device where it was, so the switch goes back to saying so.
  const shown = commander.problem === null ? power.shown : isOn;

  return (
    <span className="relative z-10 inline-flex items-center" title={commander.problem ?? undefined}>
      <Switch
        label={name}
        size={size}
        isOn={shown}
        disabled={disabled}
        onChange={(next) => {
          power.sent(next);
          commander.send('on_off', powerCommand(next));
        }}
      />
      {commander.problem === null ? null : (
        <span role="alert" className="sr-only">
          {commander.problem}
        </span>
      )}
    </span>
  );
}
