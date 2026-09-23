/**
 * The AND / OR pill between two flat cards.
 *
 * A Segmented rather than a pair of buttons: two options, always visible, one tab stop. Default
 * for a new gap is whatever the section chose when the card was added (OR for triggers, AND for
 * If).
 */
import { Segmented } from '@nebula-home/ui';

import type { BooleanJoin } from '@/library/automation-draft';

/** What the pill needs. */
export type BooleanJoinPillProps = {
  /** The current join. */
  readonly value: BooleanJoin;

  /** Called when the person flips it. */
  readonly onChange: (join: BooleanJoin) => void;
};

/**
 * Renders the join pill.
 *
 * @param props - See {@link BooleanJoinPillProps}.
 * @returns The control.
 */
export function BooleanJoinPill(props: BooleanJoinPillProps) {
  const { value, onChange } = props;

  return (
    <div className="flex justify-center py-0.5">
      <Segmented
        label="Combine with"
        size="compact"
        options={[
          { value: 'and', label: 'AND' },
          { value: 'or', label: 'OR' },
        ]}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}
