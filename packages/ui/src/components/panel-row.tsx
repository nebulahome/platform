/**
 * One row inside a {@link Panel}.
 *
 * A title, an optional line saying what it does or what it costs, and a control on the right.
 * Anything that opens - a form, a list of recovery codes, a secret shown once - goes in
 * `children` and spans the whole width, because those are never a control on a right-hand edge.
 */
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';

/** What one row needs. */
export type PanelRowProps = {
  /** What the setting is. */
  readonly title: ReactNode;

  /** A line under it saying what it does, or what it costs. */
  readonly note?: ReactNode;

  /** The control, on the right. */
  readonly control?: ReactNode;

  /**
   * Content below the title and the control, spanning the whole width.
   *
   * For the rows that open into something: a form, a list of recovery codes, a secret.
   */
  readonly children?: ReactNode;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders one row.
 *
 * @param props - See {@link PanelRowProps}.
 * @returns The row.
 */
export function PanelRow(props: PanelRowProps) {
  const { title, note, control, children, className } = props;

  return (
    <div className={cn('border-b border-border-soft px-4 py-3.5 last:border-b-0', className)}>
      <div className="flex items-center gap-4">
        <div className="flex min-w-0 grow flex-col gap-0.5">
          <span className="text-title font-medium text-foreground">{title}</span>
          {note === undefined ? null : (
            <span className="text-caption text-foreground-subtle">{note}</span>
          )}
        </div>

        {control}
      </div>

      {children === undefined ? null : <div className="mt-3.5">{children}</div>}
    </div>
  );
}
