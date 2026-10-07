/**
 * One block of a page under its heading: "Devices", "Usage", "About". The heading is 15px at
 * weight 500 with an optional line under it; what acts on the block - a range, an Add - sits on
 * the right of the heading. The block itself follows 12px below.
 *
 * Pages stack these 32px apart, in one column: a detail page reads top to bottom.
 */
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';

/** What a section needs. */
export type SectionProps = {
  /** Its heading. */
  readonly title: ReactNode;

  /** A line under the heading. */
  readonly note?: ReactNode;

  /** On the right of the heading: what acts on the block. */
  readonly actions?: ReactNode;

  /** The block. */
  readonly children: ReactNode;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders a block under its heading.
 *
 * @param props - See {@link SectionProps}.
 * @returns The section.
 */
export function Section(props: SectionProps) {
  const { title, note, actions, children, className } = props;

  return (
    <section className={cn('flex flex-col gap-3', className)}>
      <div className="flex min-h-7.5 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-title font-medium text-foreground">{title}</h2>
          {note === undefined ? null : <p className="text-ui-sm text-foreground-subtle">{note}</p>}
        </div>
        {actions === undefined ? null : (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {children}
    </section>
  );
}
