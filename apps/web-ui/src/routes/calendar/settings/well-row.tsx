/**
 * A setting in its own well, its words at the left and its control at the right, as the entity's
 * Enabled is drawn: a calendar's Day off, its source while it has none.
 */
import type { ReactNode } from 'react';

/** What a row of a well needs. */
export type WellRowProps = {
  readonly title: string;
  readonly line: string;

  /** At the right: a switch, a button. */
  readonly children: ReactNode;
};

/**
 * A setting in its own well, its words at the left and its control at the right, as the entity's
 * Enabled is drawn.
 *
 * @param props - See {@link WellRowProps}.
 * @returns The row.
 */
export function WellRow(props: WellRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-inner border border-border bg-well px-4 py-3.5">
      <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.75">
        <span className="text-ui">{props.title}</span>
        <span className="text-caption leading-[1.45] text-foreground-subtle">{props.line}</span>
      </div>
      {props.children}
    </div>
  );
}
